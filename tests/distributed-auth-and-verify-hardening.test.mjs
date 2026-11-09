/**
 * Distributed Store Admin Authentication Lockout & PayU Verification Cooldown
 * Hardening Tests (Tasks 1 & 2).
 *
 * Covers:
 *   Store Admin:
 *     1. Five failed password attempts trigger the 15-minute lockout (429).
 *     2. Ten TOTP failures trigger the independent 15-minute lockout (429), and
 *        password failures / TOTP failures are counted independently.
 *     3. Successful authentication resets/clears prior failure state across instances.
 *     4. Lockout is preserved across simulated independent serverless instances
 *        (each request runs in a fresh module evaluation with empty in-memory Maps).
 *     5. Concurrent failed attempts are serialized and cannot exceed the threshold.
 *     6. Lockout expires after 15 minutes.
 *   PayU Verification:
 *     7. First verification request succeeds.
 *     8. Second request within 15 seconds is suppressed (429 + Retry-After) across instances.
 *     9. Request after 15 seconds is allowed.
 *    10. Two concurrent requests produce only one PayU API call.
 *    11. Separate orders have independent cooldowns.
 *    12. Already-paid orders do not call PayU again.
 *    13. PayU pending status remains pending.
 *    14. PayU failure / cooldown rejection does not corrupt order state.
 *    15. Expired verification claims (crashed/timed-out function) recover after 15s.
 *    16. Customer ownership and Store Admin authorization remain intact.
 *    17. Opt-in live PostgreSQL concurrency test (`RUN_DISTRIBUTED_DB_CONCURRENCY=1`)
 *        against an isolated temporary schema (`DROP SCHEMA ... CASCADE` in `finally`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { createJiti } from 'jiti';
import { newTotpSecret, generateTotp } from '../src/lib/platform/totp.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/**
 * Load a fresh, isolated module instance (simulating a separate Vercel
 * serverless cold start with its own in-memory Maps).
 */
function loadFreshModule(relPath) {
  return createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
  }).import(path.join(root, relPath));
}

/**
 * Shared PostgreSQL-semantics simulator for offline multi-instance and
 * concurrency tests. Enforces transaction serialization (`pg_advisory_xact_lock`
 * and `FOR UPDATE` row locks) and stores `store_admin_audit`, `store_admins`,
 * `store_admin_sessions`, `orders`, and `payment_events` across independent
 * serverless module instances.
 */
function createSharedDatabaseHarness({
  admins = [],
  orders = [],
} = {}) {
  const adminMap = new Map(admins.map((a) => [a.email.toLowerCase(), { ...a }]));
  const orderMap = new Map(orders.map((o) => [o.txnid, { ...o }]));
  const auditRows = [];
  const paymentEventRows = [];
  const sessionRows = [];
  let nextId = 1;

  // Mutex queue simulating PostgreSQL pg_advisory_xact_lock / FOR UPDATE serialization
  let lockChain = Promise.resolve();

  function parseIso(val) {
    return val instanceof Date ? val.getTime() : Date.parse(String(val));
  }

  function makeTagFn(isTx = false) {
    const fn = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();

      if (q.startsWith('select now()')) {
        return [{ now: new Date().toISOString() }];
      }

      if (q.startsWith('select pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: '' }];
      }

      if (q.includes('from store_admins') && q.includes('where email =')) {
        const email = String(values[0]).toLowerCase();
        const found = adminMap.get(email);
        return found ? [{ ...found }] : [];
      }

      if (q.includes('from store_admins') && q.includes('for update')) {
        const id = String(values[0]);
        const hash = String(values[1]);
        const found = [...adminMap.values()].find(
          (a) => a.id === id && a.is_active && !a.removed_at && a.password_hash === hash,
        );
        return found ? [{ id: found.id }] : [];
      }

      if (q.startsWith('update store_admins set totp_last_step')) {
        const step = Number(values[0]);
        const id = String(values[1]);
        const minStep = Number(values[2]);
        const found = [...adminMap.values()].find((a) => a.id === id);
        if (found && (found.totp_last_step == null || found.totp_last_step < minStep)) {
          found.totp_last_step = step;
          return [{ id: found.id }];
        }
        return [];
      }

      if (q.startsWith('insert into store_admin_sessions')) {
        sessionRows.push({ token_hash: values[0], admin_id: values[1] });
        return [];
      }

      if (q.startsWith('update store_admins set last_login_at')) {
        return [];
      }

      if (q.startsWith('delete from store_admin_sessions')) {
        return [];
      }

      if (q.startsWith('insert into store_admin_audit')) {
        const createdAtMs = values[8] ? parseIso(values[8]) : Date.now();
        auditRows.push({
          id: nextId++,
          actor_id: values[0],
          actor_email: values[1],
          action: values[2],
          entity: values[3],
          entity_id: values[4],
           status: values[5],
          reason: values[6],
          ip_hash: values[7],
          created_at: new Date(createdAtMs),
        });
        return [];
      }

      if (q.includes('from store_admin_audit') && q.includes('where action =')) {
        const nowMs = parseIso(values[0]);
        const action = values[1];
        const entity = values[2];
        const emailHash = values[3];
        const ipHash = values[4];
        const cutoffMs = nowMs - 15 * 60 * 1000;

        return auditRows
          .filter((r) => {
            const ts = r.created_at.getTime();
            const matchTarget =
              r.entity_id === emailHash || (ipHash && r.ip_hash === ipHash);
            return (
              r.action === action &&
              r.entity === entity &&
              matchTarget &&
              ts > cutoffMs &&
              ts <= nowMs
            );
          })
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id - a.id)
          .slice(0, 100)
          .map((r) => ({
            entity_id: r.entity_id,
            ip_hash: r.ip_hash,
            status: r.status,
            reason: r.reason,
            retry_after_sec: Math.ceil(
              (r.created_at.getTime() + 15 * 60 * 1000 - nowMs) / 1000,
            ),
          }));
      }

      if (q.includes('from orders') && q.includes('for update')) {
        const txnid = String(values[0]);
        const ord = orderMap.get(txnid);
        return ord ? [{ ...ord }] : [];
      }

      if (q.includes('from payment_events') && q.includes('count(*)::int as cnt')) {
        // Per-actor window check (10 / 60s)
        const windowSecs = Number(values[0]);
        const nowMs = values[1] ? parseIso(values[1]) : Date.now();
        const fallbackWindow = Number(values[2]);
        const source = String(values[3]);
        const reason = String(values[4]);
        const actorTag = String(values[5]);
        const cutoffMs = nowMs - windowSecs * 1000;

        const matching = paymentEventRows.filter((r) => {
          const ts = r.created_at.getTime();
          return (
            r.source === source &&
            r.reason === reason &&
            r.payu_status === actorTag &&
            ts > cutoffMs &&
            ts <= nowMs
          );
        });
        const minTs = matching.length
          ? Math.min(...matching.map((r) => r.created_at.getTime()))
          : nowMs;
        const retryAfterSec = matching.length
          ? Math.ceil((minTs + windowSecs * 1000 - nowMs) / 1000)
          : fallbackWindow;
        return [{ cnt: matching.length, retry_after_sec: retryAfterSec }];
      }

      if (q.includes('from payment_events') && q.includes('where order_id =')) {
        // Per-order 15s cooldown & lease check
        const cooldownSecs = Number(values[0]);
        const nowMs = values[1] ? parseIso(values[1]) : Date.now();
        const orderId = String(values[2]);
        const source = String(values[3]);
        const cutoffMs = nowMs - cooldownSecs * 1000;

        const matching = paymentEventRows
          .filter((r) => {
            const ts = r.created_at.getTime();
            return (
              r.order_id === orderId &&
              r.source === source &&
              ts > cutoffMs &&
              ts <= nowMs
            );
          })
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id - a.id);

        if (!matching.length) return [];
        const newest = matching[0];
        return [
          {
            retry_after_sec: Math.ceil(
              (newest.created_at.getTime() + cooldownSecs * 1000 - nowMs) / 1000,
            ),
          },
        ];
      }

      if (q.startsWith('insert into payment_events')) {
        const createdAtMs = values[5] ? parseIso(values[5]) : Date.now();
        paymentEventRows.push({
          id: nextId++,
          order_id: String(values[0]),
          txnid: String(values[1]),
          source: String(values[2]),
          payu_status: String(values[3]),
          outcome: 'unchanged',
          reason: String(values[4]),
          created_at: new Date(createdAtMs),
        });
        return [];
      }

      void isTx;
      return [];
    };

    fn.json = (v) => v;
    fn.begin = async (cb) => {
      let release;
      const prev = lockChain;
      lockChain = new Promise((r) => {
        release = r;
      });
      await prev;
      try {
        const txFn = makeTagFn(true);
        return await cb(txFn);
      } finally {
        release();
      }
    };
    return fn;
  }

  return {
    sql: makeTagFn(false),
    auditRows,
    paymentEventRows,
    orderMap,
    adminMap,
  };
}

/* =========================================================================
   TASK 1 TESTS — Store Admin Distributed Authentication Lockout
   ========================================================================= */

test('Store Admin: 5 failed password attempts trigger 15-minute lockout across independent serverless instances and expire after 15 minutes', async () => {
  const passwordHash = await bcrypt.hash('CorrectHorseBatteryStaple1!', 4);
  const db = createSharedDatabaseHarness({
    admins: [
      {
        id: 'sa_1',
        email: 'owner@gadzio.test',
        name: 'Owner',
        password_hash: passwordHash,
        role: 'store_owner',
        is_active: true,
        must_change_password: false,
        totp_enabled: false,
        totp_secret: null,
        recovery_hash: null,
      },
    ],
  });

  const t0 = Date.parse('2026-11-10T10:00:00.000Z');

  // Simulate 5 failed attempts, each arriving on a brand-new serverless instance
  for (let i = 1; i <= 5; i += 1) {
    const instance = await loadFreshModule('src/lib/store-admin/auth.ts');
    instance.clearInMemoryAuthAttempts();
    const res = await instance.login('owner@gadzio.test', `wrong-pass-${i}`, undefined, {
      sql: db.sql,
      ip: `203.0.113.${i}`, // rotating IPs still lock the account on the 5th email failure
      now: t0 + i * 1000,
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 401, `attempt ${i} should return 401`);
  }

  // 6th attempt on a fresh serverless instance — even with the CORRECT password — must be locked (429)
  const instance6 = await loadFreshModule('src/lib/store-admin/auth.ts');
  instance6.clearInMemoryAuthAttempts();
  const locked = await instance6.login('owner@gadzio.test', 'CorrectHorseBatteryStaple1!', undefined, {
    sql: db.sql,
    ip: '203.0.113.99',
    now: t0 + 10_000,
  });
  assert.equal(locked.ok, false);
  assert.equal(locked.status, 429);
  assert.match(locked.error, /Too many failed attempts/);
  assert.ok(locked.retryAfterSec > 0 && locked.retryAfterSec <= 900);

  // After 15 minutes + 2 seconds, lockout expires and login succeeds
  const instanceAfterExpiry = await loadFreshModule('src/lib/store-admin/auth.ts');
  instanceAfterExpiry.clearInMemoryAuthAttempts();
  const unlocked = await instanceAfterExpiry.login(
    'owner@gadzio.test',
    'CorrectHorseBatteryStaple1!',
    undefined,
    {
      sql: db.sql,
      ip: '203.0.113.99',
      now: t0 + 15 * 60 * 1000 + 6000,
    },
  );
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.adminId, 'sa_1');
});

test('Store Admin: TOTP failures (10/15m) and password failures (5/15m) are counted independently, and successful login resets failure state', async () => {
  const passwordHash = await bcrypt.hash('CorrectPassword123!', 4);
  const totpSecret = newTotpSecret();
  const db = createSharedDatabaseHarness({
    admins: [
      {
        id: 'sa_totp',
        email: 'totp-admin@gadzio.test',
        name: 'TOTP Admin',
        password_hash: passwordHash,
        role: 'store_admin',
        is_active: true,
        must_change_password: false,
        totp_enabled: true,
        totp_secret: totpSecret,
        recovery_hash: null,
      },
    ],
  });

  const t0 = Date.parse('2026-11-10T11:00:00.000Z');
  const authMod = await loadFreshModule('src/lib/store-admin/auth.ts');

  // 1. Make 4 wrong password attempts (1 short of the 5-failure password lockout)
  for (let i = 1; i <= 4; i += 1) {
    authMod.clearInMemoryAuthAttempts();
    const res = await authMod.login('totp-admin@gadzio.test', 'wrong-password', '000000', {
      sql: db.sql,
      ip: '198.51.100.10',
      now: t0 + i * 1000,
    });
    assert.equal(res.status, 401);
  }

  // 2. Now make 9 wrong TOTP attempts with the CORRECT password.
  //    Because TOTP failures are independent from password failures, the 4 prior
  //    password failures must NOT cause the 1st TOTP failure to lock the account,
  //    and 9 TOTP failures must NOT trigger the 5-failure password lockout!
  for (let i = 1; i <= 9; i += 1) {
    authMod.clearInMemoryAuthAttempts();
    const res = await authMod.login('totp-admin@gadzio.test', 'CorrectPassword123!', '000000', {
      sql: db.sql,
      ip: '198.51.100.10',
      now: t0 + 10_000 + i * 1000,
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 401, `TOTP attempt ${i} should still be 401, not 429`);
    assert.equal(res.codeRequired, true);
  }

  // 3. Before hitting the 10th TOTP failure, sign in with the VALID password + VALID TOTP code:
  //    this must succeed and reset both the 4 password failures and 9 TOTP failures!
  const validTotp = generateTotp(totpSecret);
  authMod.clearInMemoryAuthAttempts();
  const success = await authMod.login('totp-admin@gadzio.test', 'CorrectPassword123!', validTotp, {
    sql: db.sql,
    ip: '198.51.100.10',
    now: t0 + 25_000,
  });
  assert.equal(success.ok, true);

  // 4. Now make 10 consecutive wrong TOTP attempts after the reset:
  //    attempts 1..10 return 401, and attempt 11 returns 429 (TOTP locked)!
  for (let i = 1; i <= 10; i += 1) {
    authMod.clearInMemoryAuthAttempts();
    const res = await authMod.login('totp-admin@gadzio.test', 'CorrectPassword123!', '000000', {
      sql: db.sql,
      ip: '198.51.100.10',
      now: t0 + 30_000 + i * 1000,
    });
    assert.equal(res.status, 401, `post-reset TOTP failure ${i} must be 401`);
  }

  authMod.clearInMemoryAuthAttempts();
  const totpLocked = await authMod.login('totp-admin@gadzio.test', 'CorrectPassword123!', '000000', {
    sql: db.sql,
    ip: '198.51.100.10',
    now: t0 + 45_000,
  });
  assert.equal(totpLocked.ok, false);
  assert.equal(totpLocked.status, 429);
  assert.equal(totpLocked.codeRequired, true);
  assert.match(totpLocked.error, /Too many incorrect verification codes/);
});

test('Store Admin: 10 simultaneous concurrent wrong-password requests cannot exceed the 5-failure threshold', async () => {
  const passwordHash = await bcrypt.hash('StrongPass123!', 4);
  const db = createSharedDatabaseHarness({
    admins: [
      {
        id: 'sa_conc',
        email: 'concurrent@gadzio.test',
        name: 'Concurrent',
        password_hash: passwordHash,
        role: 'store_admin',
        is_active: true,
        must_change_password: false,
        totp_enabled: false,
        totp_secret: null,
        recovery_hash: null,
      },
    ],
  });

  const t0 = Date.parse('2026-11-10T12:00:00.000Z');
  const instances = await Promise.all(
    Array.from({ length: 10 }, () => loadFreshModule('src/lib/store-admin/auth.ts')),
  );

  const results = await Promise.all(
    instances.map((inst, idx) =>
      inst.login('concurrent@gadzio.test', `wrong-${idx}`, undefined, {
        sql: db.sql,
        ip: '192.0.2.55',
        now: t0,
      }),
    ),
  );

  const count401 = results.filter((r) => r.status === 401).length;
  const count429 = results.filter((r) => r.status === 429).length;
  assert.equal(count401, 5, 'exactly 5 concurrent attempts may evaluate before lockout');
  assert.equal(count429, 5, 'remaining 5 concurrent attempts must be rejected with 429');
});

/* =========================================================================
   TASK 2 TESTS — Distributed PayU Verification Cooldown & Lease Recovery
   ========================================================================= */

test('PayU Verification: 1st succeeds, 2nd within 15s is suppressed across instances, after 15s is allowed, and separate orders are independent', async () => {
  const db = createSharedDatabaseHarness({
    orders: [
      { id: 'ord_1', txnid: 'GDZ_V_1', user_id: 'cust_1', status: 'PENDING' },
      { id: 'ord_2', txnid: 'GDZ_V_2', user_id: 'cust_1', status: 'PENDING' },
    ],
  });

  const gatewayCalls = [];
  const makeDeps = (nowMs) => ({
    sql: db.sql,
    now: nowMs,
    getOrderByTxnid: async (txnid) => db.orderMap.get(txnid) ?? null,
    verifyExistingOrderWithPayU: async (txnid, source) => {
      gatewayCalls.push({ txnid, source, nowMs });
      return {
        ok: true,
        rejected: false,
        retryable: false,
        status: 'PENDING',
        txnid,
        order: db.orderMap.get(txnid),
        redirectUrl: null,
      };
    },
    checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
    writeAudit: async () => true,
  });

  const req = new Request('http://localhost:3000/api/account/orders/GDZ_V_1/verify', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000' },
  });
  const t0 = Date.parse('2026-11-10T13:00:00.000Z');

  // Instance 1: First verification request on GDZ_V_1 succeeds and remains PENDING
  const inst1 = await loadFreshModule('src/lib/account/payment-verification.ts');
  const r1 = await inst1.checkCustomerPayment('cust_1', 'GDZ_V_1', req, makeDeps(t0));
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, 'PENDING');
  assert.equal(gatewayCalls.length, 1);

  // Instance 2 (5 seconds later, fresh serverless instance): suppressed with 429
  const inst2 = await loadFreshModule('src/lib/account/payment-verification.ts');
  const r2 = await inst2.checkCustomerPayment('cust_1', 'GDZ_V_1', req, makeDeps(t0 + 5_000));
  assert.equal(r2.status, 429);
  assert.equal(r2.retryAfter, 10);
  assert.equal(gatewayCalls.length, 1, 'suppressed request must not call PayU');
  assert.equal(db.orderMap.get('GDZ_V_1').status, 'PENDING', 'cooldown rejection must not corrupt order state');

  // Separate order GDZ_V_2 at t0 + 5s has an independent cooldown and succeeds immediately
  const rOtherOrder = await inst2.checkCustomerPayment('cust_1', 'GDZ_V_2', req, makeDeps(t0 + 5_000));
  assert.equal(rOtherOrder.status, 200);
  assert.equal(gatewayCalls.length, 2);

  // Instance 3 (16 seconds after t0, after 15s cooldown expires): GDZ_V_1 is allowed again
  const inst3 = await loadFreshModule('src/lib/account/payment-verification.ts');
  const r3 = await inst3.checkCustomerPayment('cust_1', 'GDZ_V_1', req, makeDeps(t0 + 16_000));
  assert.equal(r3.status, 200);
  assert.equal(gatewayCalls.length, 3);
});

test('PayU Verification: two concurrent requests on the same order produce only ONE PayU API call', async () => {
  const db = createSharedDatabaseHarness({
    orders: [{ id: 'ord_race', txnid: 'GDZ_RACE_1', user_id: 'cust_1', status: 'PROCESSING' }],
  });

  let payuCalls = 0;
  const t0 = Date.parse('2026-11-10T14:00:00.000Z');
  const req = new Request('http://localhost:3000/api/account/orders/GDZ_RACE_1/verify', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000' },
  });

  const [instA, instB] = await Promise.all([
    loadFreshModule('src/lib/account/payment-verification.ts'),
    loadFreshModule('src/lib/account/payment-verification.ts'),
  ]);

  const makeDeps = () => ({
    sql: db.sql,
    now: t0,
    getOrderByTxnid: async (txnid) => db.orderMap.get(txnid) ?? null,
    verifyExistingOrderWithPayU: async (txnid) => {
      payuCalls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return {
        ok: true,
        rejected: false,
        retryable: false,
        status: 'PAID',
        txnid,
        order: { ...db.orderMap.get(txnid), status: 'PAID' },
        redirectUrl: null,
      };
    },
    checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
    writeAudit: async () => true,
  });

  const [resA, resB] = await Promise.all([
    instA.checkCustomerPayment('cust_1', 'GDZ_RACE_1', req, makeDeps()),
    instB.checkCustomerPayment('cust_1', 'GDZ_RACE_1', req, makeDeps()),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 429], 'one request must succeed (200) and the concurrent duplicate must be suppressed (429)');
  assert.equal(payuCalls, 1, 'concurrent requests must produce only ONE outbound PayU API call');
});

test('PayU Verification: already-paid orders never call PayU, foreign customers get 404, and crashed claims recover after 15s lease', async () => {
  const db = createSharedDatabaseHarness({
    orders: [
      { id: 'ord_paid', txnid: 'GDZ_PAID_1', user_id: 'cust_1', status: 'PAID' },
      { id: 'ord_crash', txnid: 'GDZ_CRASH_1', user_id: 'cust_1', status: 'PROCESSING' },
    ],
  });

  const mod = await loadFreshModule('src/lib/account/payment-verification.ts');
  const req = new Request('http://localhost:3000/api/account/orders/GDZ_PAID_1/verify', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000' },
  });
  const t0 = Date.parse('2026-11-10T15:00:00.000Z');
  let payuCalls = 0;

  // 1. Foreign customer attempting to verify cust_1's order gets 404 before any claim
  const foreignRes = await mod.checkCustomerPayment('cust_2', 'GDZ_CRASH_1', req, {
    sql: db.sql,
    now: t0,
    getOrderByTxnid: async () => null,
    verifyExistingOrderWithPayU: async () => {
      payuCalls += 1;
      throw new Error('must not be called');
    },
    checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
    writeAudit: async () => true,
  });
  assert.equal(foreignRes.status, 404);
  assert.equal(payuCalls, 0);

  // 2. Already-paid order returns 200 PAID without calling PayU (both customer and store admin)
  const paidCustomerRes = await mod.checkCustomerPayment('cust_1', 'GDZ_PAID_1', req, {
    sql: db.sql,
    now: t0,
    getOrderByTxnid: async () => db.orderMap.get('GDZ_PAID_1'),
    verifyExistingOrderWithPayU: async () => {
      payuCalls += 1;
      throw new Error('must not be called for PAID order');
    },
    checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
    writeAudit: async () => true,
  });
  assert.equal(paidCustomerRes.status, 200);
  assert.equal(paidCustomerRes.body.status, 'PAID');
  assert.equal(payuCalls, 0);

  const paidAdminRes = await mod.checkAdminPayment(
    { adminId: 'sa_1', email: 'owner@gadzio.test' },
    'GDZ_PAID_1',
    req,
    {
      sql: db.sql,
      now: t0,
      getOrderByTxnid: async () => db.orderMap.get('GDZ_PAID_1'),
      verifyExistingOrderWithPayU: async () => {
        payuCalls += 1;
        throw new Error('must not be called for PAID order');
      },
      checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
      writeAudit: async () => true,
    },
  );
  assert.equal(paidAdminRes.status, 200);
  assert.equal(paidAdminRes.body.status, 'PAID');
  assert.equal(payuCalls, 0);

  // 3. Simulate a serverless function that claimed the lease at t0 and then crashed
  //    mid-flight while calling PayU:
  await assert.rejects(
    mod.checkCustomerPayment('cust_1', 'GDZ_CRASH_1', req, {
      sql: db.sql,
      now: t0,
      getOrderByTxnid: async () => db.orderMap.get('GDZ_CRASH_1'),
      verifyExistingOrderWithPayU: async () => {
        payuCalls += 1;
        throw new Error('SIMULATED_LAMBDA_TIMEOUT');
      },
      checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
      writeAudit: async () => true,
    }),
    /SIMULATED_LAMBDA_TIMEOUT/,
  );
  assert.equal(payuCalls, 1);

  // Within the 15s lease window (t0 + 4s), a retry is held off (429)
  const duringLease = await mod.checkCustomerPayment('cust_1', 'GDZ_CRASH_1', req, {
    sql: db.sql,
    now: t0 + 4_000,
    getOrderByTxnid: async () => db.orderMap.get('GDZ_CRASH_1'),
    verifyExistingOrderWithPayU: async () => {
      payuCalls += 1;
      throw new Error('should be suppressed during active lease');
    },
    checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
    writeAudit: async () => true,
  });
  assert.equal(duringLease.status, 429);

  // After the 15s bounded lease expires (t0 + 16s), the claim automatically recovers!
  const recovered = await mod.checkCustomerPayment('cust_1', 'GDZ_CRASH_1', req, {
    sql: db.sql,
    now: t0 + 16_000,
    getOrderByTxnid: async () => db.orderMap.get('GDZ_CRASH_1'),
    verifyExistingOrderWithPayU: async (txnid) => {
      payuCalls += 1;
      return {
        ok: true,
        rejected: false,
        retryable: false,
        status: 'PAID',
        txnid,
        order: { ...db.orderMap.get(txnid), status: 'PAID' },
        redirectUrl: null,
      };
    },
    checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
    writeAudit: async () => true,
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.status, 'PAID');
  assert.equal(payuCalls, 2);
});

/* =========================================================================
   OPT-IN LIVE POSTGRESQL CONCURRENCY TEST (`RUN_DISTRIBUTED_DB_CONCURRENCY=1`)
   ========================================================================= */

const runLivePg =
  process.env.RUN_DISTRIBUTED_DB_CONCURRENCY === '1' &&
  Boolean(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);

test(
  'live PostgreSQL concurrency: multi-connection advisory locks and FOR UPDATE row locks serialize auth lockouts and PayU claims',
  {
    skip: !runLivePg
      ? 'opt-in only: set RUN_DISTRIBUTED_DB_CONCURRENCY=1 with DATABASE_MIGRATION_URL'
      : false,
  },
  async () => {
    const connUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
    const schema = `test_dist_hardening_${randomBytes(6).toString('hex')}`;
    const adminSql = postgres(connUrl, {
      max: 1,
      connect_timeout: 15,
      ssl: 'require',
      prepare: false,
      onnotice: () => {},
    });

    const poolSql = postgres(connUrl, {
      max: 6,
      connect_timeout: 15,
      ssl: 'require',
      prepare: false,
      connection: { search_path: schema },
      onnotice: () => {},
    });

    try {
      await adminSql.unsafe(`create schema ${schema}`);
      await adminSql.unsafe(`
        create table ${schema}.store_admins (
          id text primary key,
          email text not null unique,
          password_hash text not null,
          name text not null default '',
          role text not null default 'store_admin',
          totp_secret text,
          totp_enabled boolean not null default false,
          totp_last_step integer,
          recovery_hash text,
          is_active boolean not null default true,
          must_change_password boolean not null default false,
          removed_at timestamptz,
          last_login_at timestamptz,
          created_at timestamptz not null default now()
        );
        create table ${schema}.store_admin_sessions (
          token_hash text primary key,
          admin_id text not null references ${schema}.store_admins(id) on delete cascade,
          expires_at timestamptz not null,
          created_at timestamptz not null default now()
        );
        create table ${schema}.store_admin_audit (
          id bigserial primary key,
          actor_id text,
          actor_email text not null default '',
          action text not null,
          entity text not null,
          entity_id text not null default '',
          before jsonb,
          after jsonb,
          request_id text,
          route text not null default '',
          status text not null default 'ok',
          reason text not null default '',
          ip_hash text,
          user_agent_hash text,
          created_at timestamptz not null default now()
        );
        create table ${schema}.orders (
          id text primary key,
          txnid text not null unique,
          user_id text,
          status text not null default 'PENDING',
          created_at timestamptz not null default now()
        );
        create table ${schema}.payment_events (
          id bigserial primary key,
          order_id text not null references ${schema}.orders(id) on delete cascade,
          txnid text not null,
          source text not null,
          payu_status text not null default '',
          outcome text not null,
          reason text not null default '',
          created_at timestamptz not null default now()
        );
      `);

      const pwHash = await bcrypt.hash('RealPgPassword123!', 4);
      await poolSql`
        insert into store_admins (id, email, password_hash, name, role, is_active)
        values ('sa_pg_1', 'pg-admin@gadzio.test', ${pwHash}, 'PG Admin', 'store_owner', true)
      `;
      await poolSql`
        insert into orders (id, txnid, user_id, status)
        values ('ord_pg_1', 'GDZ_PG_1', 'usr_pg_1', 'PENDING')
      `;

      // 1. Live PG concurrent Store Admin password failures (8 concurrent requests)
      const authMod = await loadFreshModule('src/lib/store-admin/auth.ts');
      const loginResults = await Promise.all(
        Array.from({ length: 8 }, (_, idx) =>
          authMod.login('pg-admin@gadzio.test', `bad-${idx}`, undefined, {
            sql: poolSql,
            ip: '198.51.100.77',
          }),
        ),
      );
      assert.equal(loginResults.filter((r) => r.status === 401).length, 5);
      assert.equal(loginResults.filter((r) => r.status === 429).length, 3);

      // 2. Live PG concurrent PayU verification claims (6 concurrent requests on GDZ_PG_1)
      const verifyMod = await loadFreshModule('src/lib/account/payment-verification.ts');
      const claimResults = await Promise.all(
        Array.from({ length: 6 }, () =>
          verifyMod.claimPaymentVerificationInDb(poolSql, {
            txnid: 'GDZ_PG_1',
            source: 'customer',
            actorId: 'usr_pg_1',
          }),
        ),
      );
      assert.equal(
        claimResults.filter((c) => c.kind === 'claimed').length,
        1,
        'only 1 concurrent request may claim the verification lease in PostgreSQL',
      );
      assert.equal(
        claimResults.filter((c) => c.kind === 'rate_limited').length,
        5,
        'the other 5 concurrent requests must be rate-limited by the 15s cooldown',
      );
    } finally {
      await poolSql.end({ timeout: 2 }).catch(() => {});
      await adminSql.unsafe(`drop schema if exists ${schema} cascade`).catch(() => {});
      await adminSql.end({ timeout: 2 }).catch(() => {});
    }
  },
);

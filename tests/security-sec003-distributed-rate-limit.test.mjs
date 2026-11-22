import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createJiti } from 'jiti';

const root = process.cwd();

/**
 * Shared PostgreSQL `auth_rate_limits` simulator supporting:
 * - advisory-lock serialized multi-statement transactions (READ COMMITTED semantics)
 * - multiple independent module instances sharing one store
 * - configurable clock `now` & bounded cleanup (`pruneExpiredRateLimitsUsing`)
 */
function createDistributedAuthHarness({ users = [] } = {}) {
  const rows = [];
  let nextId = 1;
  const userMap = new Map(users.map((u) => [u.email.toLowerCase(), { ...u }]));
  const sessions = [];
  const loginEvents = [];
  let txChain = Promise.resolve();

  function createSql() {
    const sql = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();

      if (q.includes('pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: '' }];
      }

      if (q.includes('from auth_rate_limits') && q.includes('count(*)')) {
        const [scope, bucketKey, cutoff] = values;
        const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : Date.parse(String(cutoff));
        const matching = rows.filter(
          (r) => r.scope === scope && r.bucket_key === bucketKey && r.created_at.getTime() > cutoffMs,
        );
        const oldest = matching.length
          ? new Date(Math.min(...matching.map((r) => r.created_at.getTime())))
          : null;
        return [{ hits: matching.length, oldest }];
      }

      if (q.includes('insert into auth_rate_limits')) {
        const [nowVal, scopes, hashes] = values;
        const createdAt = nowVal instanceof Date ? nowVal : new Date(nowVal);
        for (let i = 0; i < scopes.length; i += 1) {
          rows.push({
            id: nextId++,
            scope: scopes[i],
            bucket_key: hashes[i],
            created_at: createdAt,
          });
        }
        return [];
      }

      if (q.includes('delete from auth_rate_limits') && q.includes('limit')) {
        const [cutoff, limit] = values;
        const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : Date.parse(String(cutoff));
        const toDelete = rows
          .filter((r) => r.created_at.getTime() < cutoffMs)
          .slice(0, Number(limit))
          .map((r) => r.id);
        for (const id of toDelete) {
          const idx = rows.findIndex((r) => r.id === id);
          if (idx !== -1) rows.splice(idx, 1);
        }
        return toDelete.map((id) => ({ id }));
      }

      if (q.includes('delete from auth_rate_limits') && q.includes('where scope =')) {
        const [scope, hash] = values;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].scope === scope && rows[i].bucket_key === hash) {
            rows.splice(i, 1);
          }
        }
        return [];
      }

      if (q.includes('from users where email =')) {
        const found = userMap.get(String(values[0]).toLowerCase());
        return found ? [found] : [];
      }

      if (q.startsWith('insert into user_sessions')) {
        sessions.push({ token_hash: values[0], user_id: values[1] });
        return [];
      }

      if (q.startsWith('update users set last_login_at')) return [];
      if (q.startsWith('delete from user_sessions')) return [];
      if (q.startsWith('insert into user_login_events')) {
        loginEvents.push({ user_id: values[0], outcome: values[1] });
        return [];
      }

      throw new Error(`Unexpected SQL in SEC-003 harness: ${q}`);
    };

    sql.begin = async (fn) => {
      const prev = txChain;
      let release;
      txChain = new Promise((r) => {
        release = r;
      });
      await prev;
      try {
        return await fn(sql);
      } finally {
        release();
      }
    };

    return sql;
  }

  return { rows, sessions, loginEvents, createSql };
}

test('SEC-003: process-local fallback respects per-entry windowMs and bounds entries at MAX_RATE_LIMIT_STORE_ENTRIES', async () => {
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
  const limiter = await jiti.import(path.join(root, 'src/lib/payu/rate-limit.ts'));
  limiter.clearRateLimitStoreForTests();

  const t0 = 1_700_000_000_000;
  // Long-window entry (60 minutes)
  assert.equal(limiter.checkRateLimit('long-window-key', { limit: 1, windowMs: 3_600_000, now: t0 }).allowed, true);
  // 2 minutes later, another caller triggers purge using a 1-second window.
  // Bug before SEC-003: purgeExpired(1000) wiped out the 60-minute entry!
  assert.equal(limiter.checkRateLimit('short-window-key', { limit: 1, windowMs: 1_000, now: t0 + 120_000 }).allowed, true);
  assert.equal(
    limiter.checkRateLimit('long-window-key', { limit: 1, windowMs: 3_600_000, now: t0 + 120_001 }).allowed,
    false,
    'longer-window rate limits must survive purges triggered by shorter-window keys',
  );
  limiter.clearRateLimitStoreForTests();
});

test('SEC-003: distributed rate limit enforces atomic cross-instance caps, concurrency serialization, window expiry, and cleanup', async () => {
  const harness = createDistributedAuthHarness();

  async function bootLimiterInstance() {
    const sql = harness.createSql();
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
      virtualModules: { '@/lib/platform/db': { getSql: () => sql } },
    });
    return jiti.import(path.join(root, 'src/lib/platform/distributed-rate-limit.ts'));
  }

  const instA = await bootLimiterInstance();
  const instB = await bootLimiterInstance();
  const baseNow = new Date('2026-11-22T12:00:00Z');

  // 1. Cross-instance split: 3 on A + 2 on B = 5 limit; 6th on B is blocked (429).
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      (await instA.checkDistributedRateLimit(
        { scope: 'account_password_user', key: 'user_1', limit: 5, windowMs: 900_000 },
        { now: baseNow },
      )).allowed,
      true,
    );
  }
  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await instB.checkDistributedRateLimit(
        { scope: 'account_password_user', key: 'user_1', limit: 5, windowMs: 900_000 },
        { now: baseNow },
      )).allowed,
      true,
    );
  }
  const sixth = await instB.checkDistributedRateLimit(
    { scope: 'account_password_user', key: 'user_1', limit: 5, windowMs: 900_000 },
    { now: baseNow },
  );
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.backend, 'postgres');
  assert.ok(sixth.retryAfterSec >= 899);

  // Raw identifiers are never stored in auth_rate_limits
  assert.equal(
    harness.rows.some((r) => r.bucket_key.includes('user_1')),
    false,
    'bucket_key must be SHA-256 hashed',
  );

  // 2. Concurrent burst across A and B against cap of 3 cannot overshoot
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, idx) =>
      (idx % 2 === 0 ? instA : instB).checkDistributedRateLimit(
        { scope: 'concurrent_test', key: 'ip:1.2.3.4', limit: 3, windowMs: 60_000 },
        { now: baseNow },
      ),
    ),
  );
  assert.equal(burst.filter((r) => r.allowed).length, 3, 'concurrent burst must permit exact cap');
  assert.equal(burst.filter((r) => !r.allowed).length, 7);

  // 3. Window expiration allows legitimate access again
  const afterWindow = new Date(baseNow.getTime() + 60_001);
  assert.equal(
    (await instA.checkDistributedRateLimit(
      { scope: 'concurrent_test', key: 'ip:1.2.3.4', limit: 3, windowMs: 60_000 },
      { now: afterWindow },
    )).allowed,
    true,
  );

  // 4. Bounded expired record cleanup removes old rows while keeping fresh ones
  const twoHoursLater = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000 + 5_000);
  const pruned = await instA.pruneExpiredRateLimitsUsing(harness.createSql(), {
    retentionMs: 2 * 60 * 60 * 1000,
    batchSize: 500,
    now: twoHoursLater,
  });
  assert.equal(pruned, 8, 'only the 8 rows older than 2 hours should be pruned');
  assert.equal(harness.rows.length, 1, 'newer un-expired row after window must be retained');
});

test('SEC-003: customer signIn 8-failure lockout works across separate serverless instances, resists XFF spoofing, and lets valid user recover after expiry', async () => {
  const passwordHash = await bcrypt.hash('CorrectHorseBattery!1', 4);
  const harness = createDistributedAuthHarness({
    users: [{ id: 'u1', email: 'buyer@example.test', password_hash: passwordHash, first_name: 'Asha', last_name: 'Rao', is_blocked: false }],
  });

  async function bootAuth() {
    const sql = harness.createSql();
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
      virtualModules: {
        '@/lib/platform/db': { getSql: () => sql },
        'next/headers': { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() },
      },
    });
    const mod = await jiti.import(path.join(root, 'src/lib/user-auth.ts'));
    return { mod, sql };
  }

  const inst1 = await bootAuth();
  const inst2 = await bootAuth();
  const clientIp = await createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } }).import(
    path.join(root, 'src/lib/platform/client-ip.ts'),
  );

  const t0 = new Date('2026-11-22T12:00:00Z');
  // Attacker sends spoofed leftmost X-Forwarded-For on each request through Vercel proxy;
  // true rightmost IP stays 203.0.113.77 across all 8 attempts split across inst1 & inst2.
  for (let i = 0; i < 8; i += 1) {
    const h = new Headers({
      'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.77`,
    });
    const realIp = clientIp.clientIpFromHeaders(h, { TRUST_PROXY: '1' });
    assert.equal(realIp, '203.0.113.77');
    const auth = i % 2 === 0 ? inst1 : inst2;
    const res = await auth.mod.signIn('buyer@example.test', 'wrong-pass', {
      sql: auth.sql,
      ip: realIp,
      device: 'test',
      now: t0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'Invalid email or password.');
  }

  // 9th attempt (even with correct password, on fresh instance inst2, from another IP) is locked for 10m!
  const locked = await inst2.mod.signIn('buyer@example.test', 'CorrectHorseBattery!1', {
    sql: inst2.sql,
    ip: '198.51.100.200',
    device: 'test',
    now: new Date(t0.getTime() + 30_000),
  });
  assert.equal(locked.ok, false);
  assert.match(locked.error, /Too many failed attempts/);
  assert.ok(locked.retryAfterSec > 0);

  // Legitimate user recovers after 10-minute window expires and signs in cleanly
  const recovered = await inst2.mod.signIn('buyer@example.test', 'CorrectHorseBattery!1', {
    sql: inst2.sql,
    ip: '203.0.113.77',
    device: 'test',
    now: new Date(t0.getTime() + 10 * 60 * 1000 + 1_000),
  });
  assert.equal(recovered.ok, true);
  assert.ok(recovered.token);
});

test('SEC-003: order PII reveal enforces distributed actor and IP rate limit and audits denials', async () => {
  const harness = createDistributedAuthHarness();
  const audits = [];
  let failNow = false;

  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => harness.createSql() },
      '@/lib/platform/api-guard': { assertSameOrigin: () => null },
      '@/lib/store-admin/auth': {
        requireStoreRole: async () => ({
          ok: true,
          session: { adminId: 'owner_1', email: 'owner@example.test', role: 'store_owner' },
        }),
      },
      '@/lib/store-admin/audit': {
        writeAudit: async (entry) => {
          audits.push(entry);
        },
      },
      '@/lib/store-admin/orders': {
        isOrderRevealField: (v) => v === 'email',
        revealOrderField: async () => {
          if (failNow) throw new Error('should not reveal when rate limited');
          return { ok: true, value: 'buyer@example.test' };
        },
      },
    },
  });

  const route = await jiti.import(path.join(root, 'src/app/api/store-admin/orders/[txnid]/reveal/route.ts'));
  for (let i = 0; i < 20; i += 1) {
    const res = await route.POST(
      new Request('https://shop.example/api/store-admin/orders/GDZ1/reveal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: 'email', reason: 'Investigating duplicate payment callback' }),
      }),
      { params: Promise.resolve({ txnid: 'GDZ1' }) },
    );
    assert.equal(res.status, 200);
  }

  failNow = true;
  const blocked = await route.POST(
    new Request('https://shop.example/api/store-admin/orders/GDZ1/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'email', reason: 'Investigating duplicate payment callback' }),
    }),
    { params: Promise.resolve({ txnid: 'GDZ1' }) },
  );
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
  assert.equal(audits.at(-1)?.status, 'denied');
  assert.equal(audits.at(-1)?.reason, 'rate_limited');
});

test('SEC-003: memory fallback normalizes whitespace, deduplicates buckets, and skips blank keys identically to Postgres', async () => {
  const rateLimitMod = await createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
  }).import(path.join(root, 'src/lib/payu/rate-limit.ts'));

  async function loadFallbackLimiter(sqlImpl) {
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
      virtualModules: {
        '@/lib/payu/rate-limit': rateLimitMod,
        '@/lib/platform/db': { getSql: () => sqlImpl },
      },
    });
    return jiti.import(path.join(root, 'src/lib/platform/distributed-rate-limit.ts'));
  }

  const failingSql = {
    begin: async () => {
      throw new Error('simulated pool outage');
    },
  };

  const nullSqlLimiter = await loadFallbackLimiter(null);
  const throwingSqlLimiter = await loadFallbackLimiter(failingSql);
  const baseNow = new Date('2026-11-22T12:00:00Z');

  rateLimitMod.clearRateLimitStoreForTests();
  try {
    // 1. Whitespace-padded keys share the same normalized bucket across null and failing-SQL fallbacks
    const first = await nullSqlLimiter.checkDistributedRateLimits(
      [{ scope: 'mem_norm_test', key: ' 203.0.113.9 ', limit: 2, windowMs: 60_000 }],
      { sql: null, now: baseNow },
    );
    assert.equal(first.allowed, true);
    assert.equal(first.backend, 'memory');
    assert.equal(first.remaining, 1);

    const second = await throwingSqlLimiter.checkDistributedRateLimits(
      [{ scope: 'mem_norm_test', key: '203.0.113.9', limit: 2, windowMs: 60_000 }],
      { now: baseNow },
    );
    assert.equal(second.allowed, true);
    assert.equal(second.backend, 'memory');
    assert.equal(second.remaining, 0);

    const third = await nullSqlLimiter.checkDistributedRateLimits(
      [{ scope: 'mem_norm_test', key: '203.0.113.9', limit: 2, windowMs: 60_000 }],
      { sql: null, now: baseNow },
    );
    assert.equal(third.allowed, false);
    assert.equal(third.backend, 'memory');
    assert.equal(third.blockedScope, 'mem_norm_test');

    // 2. Duplicate buckets within one call are deduplicated rather than double-charged
    const dedup = await throwingSqlLimiter.checkDistributedRateLimits(
      [
        { scope: 'mem_dedup_test', key: 'actor_1', limit: 2, windowMs: 60_000 },
        { scope: 'mem_dedup_test', key: ' actor_1 ', limit: 2, windowMs: 60_000 },
      ],
      { now: baseNow },
    );
    assert.equal(dedup.allowed, true);
    assert.equal(dedup.remaining, 1);

    const dedupSecond = await throwingSqlLimiter.checkDistributedRateLimits(
      [{ scope: 'mem_dedup_test', key: 'actor_1', limit: 2, windowMs: 60_000 }],
      { now: baseNow },
    );
    assert.equal(dedupSecond.allowed, true);
    assert.equal(dedupSecond.remaining, 0);

    // 3. Blank/whitespace-only keys are skipped cleanly (both alone and alongside a valid bucket)
    for (let i = 0; i < 4; i += 1) {
      const blankOnly = await throwingSqlLimiter.checkDistributedRateLimits(
        [{ scope: 'mem_blank_test', key: '   ', limit: 1, windowMs: 60_000 }],
        { now: baseNow },
      );
      assert.equal(blankOnly.allowed, true);

      const mixed = await throwingSqlLimiter.checkDistributedRateLimits(
        [
          { scope: 'mem_mixed_valid', key: 'user_ok', limit: 5, windowMs: 60_000 },
          { scope: 'mem_blank_test', key: '   ', limit: 1, windowMs: 60_000 },
        ],
        { now: baseNow },
      );
      assert.equal(mixed.allowed, true);
      assert.equal(mixed.backend, 'memory');
    }
  } finally {
    rateLimitMod.clearRateLimitStoreForTests();
  }
});

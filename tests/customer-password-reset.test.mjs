import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import bcrypt from 'bcryptjs';
import { createJiti } from 'jiti';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  processForgotPasswordWork,
  prunePasswordResetArtifacts,
  requestPasswordReset,
  resetCustomerPassword,
} = await jiti.import(path.join(root, 'src/lib/auth/password-reset.ts'));

const { isStorefrontPath, isBlockedPurchaseApi, shouldBlockPath } =
  await jiti.import(path.join(root, 'src/lib/storefront/maintenance.ts'));

const { buildNeedsAttentionItems } = await jiti.import(
  path.join(root, 'src/lib/store-admin/needs-attention.ts'),
);

const { clientIpFromHeaders } = await jiti.import(
  path.join(root, 'src/lib/platform/client-ip.ts'),
);

const validationMod = await jiti.import(
  path.join(root, 'src/lib/auth/validation.ts'),
);

const { PUBLIC_PASSWORD_RESET_ROUTES } = await import(
  pathToFileURL(path.join(root, 'scripts/check-account-routes.mjs')).href
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function defaultSettings(overrides = {}) {
  return {
    trade_name: 'Gadzio',
    support_email: 'support@gadzio.test',
    mail_driver: 'smtp',
    mail_status: 'on',
    mail_host: 'smtp.gadzio.test',
    mail_port: '587',
    mail_encryption: 'tls',
    mail_username: 'mailer',
    mail_from_email: 'no-reply@gadzio.test',
    mail_from_name: 'Gadzio',
    sms_status: 'off',
    sms_gateway: 'none',
    sms_sender_id: '',
    sms_dlt_template_id: '',
    ...overrides,
  };
}

function createPasswordResetHarness({ users = [], sessions = [] } = {}) {
  let clockMs = Date.UTC(2026, 10, 12, 12, 0, 0);
  let nextTokenId = 1;
  let nextRateId = 1;
  let nextFailureId = 1;
  let lockChain = Promise.resolve();
  let failNextTokenInsert = false;

  const userRows = users.map((u) => ({ ...u }));
  const sessionRows = sessions.map((s) => ({ ...s }));
  const tokenRows = [];
  const rateLimitRows = [];
  const mailFailureRows = [];
  const outboxRows = [];

  function makeTagFn() {
    const fn = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();

      if (q.includes('select set_config(') || q.includes('pg_advisory_xact_lock')) {
        return [];
      }

      // Rate limit: forgot_ip count
      if (q.includes("where scope = 'forgot_ip'") && q.includes('from auth_rate_limits')) {
        const bucketKey = values[0];
        const cutoff = clockMs - 3600_000;
        const matching = rateLimitRows.filter(
          (r) =>
            r.scope === 'forgot_ip' &&
            r.bucket_key === bucketKey &&
            r.created_at.getTime() > cutoff &&
            r.created_at.getTime() <= clockMs,
        );
        const minCreated = matching.reduce(
          (min, r) => Math.min(min, r.created_at.getTime()),
          Infinity,
        );
        const retryAfter = Number.isFinite(minCreated)
          ? Math.ceil((minCreated + 3600_000 - clockMs) / 1000)
          : 3600;
        return [{ cnt: matching.length, retry_after_sec: retryAfter }];
      }

      // Rate limit: forgot_email count
      if (q.includes("where scope = 'forgot_email'") && q.includes('from auth_rate_limits')) {
        const bucketKey = values[0];
        const cutoff = clockMs - 3600_000;
        const matching = rateLimitRows.filter(
          (r) =>
            r.scope === 'forgot_email' &&
            r.bucket_key === bucketKey &&
            r.created_at.getTime() > cutoff &&
            r.created_at.getTime() <= clockMs,
        );
        return [{ cnt: matching.length }];
      }

      // Rate limit: reset_ip count
      if (q.includes("where scope = 'reset_ip'") && q.includes('from auth_rate_limits')) {
        const bucketKey = values[0];
        const cutoff = clockMs - 3600_000;
        const matching = rateLimitRows.filter(
          (r) =>
            r.scope === 'reset_ip' &&
            r.bucket_key === bucketKey &&
            r.created_at.getTime() > cutoff &&
            r.created_at.getTime() <= clockMs,
        );
        const minCreated = matching.reduce(
          (min, r) => Math.min(min, r.created_at.getTime()),
          Infinity,
        );
        const retryAfter = Number.isFinite(minCreated)
          ? Math.ceil((minCreated + 3600_000 - clockMs) / 1000)
          : 3600;
        return [{ cnt: matching.length, retry_after_sec: retryAfter }];
      }

      // Rate limit insert
      if (q.startsWith('insert into auth_rate_limits')) {
        const scopeMatch = q.match(/values \('([^']+)'/);
        const scope = scopeMatch ? scopeMatch[1] : 'unknown';
        const bucketKey = values[0];
        rateLimitRows.push({
          id: nextRateId++,
          scope,
          bucket_key: bucketKey,
          created_at: new Date(clockMs),
        });
        return [];
      }

      // Lookup user by email
      if (q.includes('from users where email =')) {
        const email = values[0];
        return userRows.filter((u) => u.email === email).slice(0, 1);
      }

      // Invalidate older unused tokens
      if (
        q.startsWith('update password_reset_tokens set invalidated_at = now() where user_id = ? and used_at is null')
      ) {
        const userId = values[0];
        for (const row of tokenRows) {
          if (row.user_id === userId && !row.used_at && !row.invalidated_at) {
            row.invalidated_at = new Date(clockMs);
          }
        }
        return [];
      }

      // Insert new token
      if (q.startsWith('insert into password_reset_tokens')) {
        if (failNextTokenInsert) {
          failNextTokenInsert = false;
          throw new Error('simulated_db_tx_failure');
        }
        const [userId, tokenHash, ipHash] = values;
        tokenRows.push({
          id: nextTokenId++,
          user_id: userId,
          token_hash: tokenHash,
          expires_at: new Date(clockMs + 30 * 60 * 1000),
          used_at: null,
          invalidated_at: null,
          created_at: new Date(clockMs),
          request_ip_hash: ipHash ?? null,
        });
        return [];
      }

      // Record mail failure
      if (q.startsWith('insert into password_reset_mail_failures')) {
        mailFailureRows.push({
          id: nextFailureId++,
          reason: values[0],
          created_at: new Date(clockMs),
        });
        return [];
      }

      // Precheck token
      if (q.includes('select t.id from password_reset_tokens t join users u')) {
        const tokenHash = values[0];
        const found = tokenRows.find((t) => {
          const u = userRows.find((usr) => usr.id === t.user_id);
          return (
            t.token_hash === tokenHash &&
            !t.used_at &&
            !t.invalidated_at &&
            t.expires_at.getTime() > clockMs &&
            u &&
            !u.is_blocked &&
            !u.anonymised_at
          );
        });
        return found ? [{ id: found.id }] : [];
      }

      // Lock token FOR UPDATE
      if (q.includes('for update of t')) {
        const tokenHash = values[0];
        const t = tokenRows.find((row) => row.token_hash === tokenHash);
        if (!t) return [];
        const u = userRows.find((usr) => usr.id === t.user_id);
        if (!u || u.is_blocked || u.anonymised_at) return [];
        return [
          {
            token_id: t.id,
            user_id: t.user_id,
            used_at: t.used_at,
            invalidated_at: t.invalidated_at,
            is_expired: t.expires_at.getTime() <= clockMs,
            email: u.email,
            first_name: u.first_name,
            last_name: u.last_name,
            phone: u.phone ?? null,
          },
        ];
      }

      // Update user password
      if (q.startsWith('update users set password_hash =')) {
        const [passwordHash, userId] = values;
        const u = userRows.find((usr) => usr.id === userId);
        if (u) {
          u.password_hash = passwordHash;
          u.updated_at = new Date(clockMs);
        }
        return [];
      }

      // Mark token used
      if (q.startsWith('update password_reset_tokens set used_at = now() where id =')) {
        const tokenId = values[0];
        const t = tokenRows.find((row) => row.id === tokenId);
        if (t) t.used_at = new Date(clockMs);
        return [];
      }

      // Invalidate other tokens
      if (
        q.startsWith('update password_reset_tokens set invalidated_at = now() where user_id = ? and id <>')
      ) {
        const [userId, tokenId] = values;
        for (const t of tokenRows) {
          if (t.user_id === userId && t.id !== tokenId && !t.used_at && !t.invalidated_at) {
            t.invalidated_at = new Date(clockMs);
          }
        }
        return [];
      }

      // Delete user sessions
      if (q.startsWith('delete from user_sessions where user_id =')) {
        const userId = values[0];
        for (let i = sessionRows.length - 1; i >= 0; i--) {
          if (sessionRows[i].user_id === userId) sessionRows.splice(i, 1);
        }
        return [];
      }

      // Prune rate limits
      if (q.startsWith('delete from auth_rate_limits')) {
        const cutoff = clockMs - 2 * 3600_000;
        const deleted = [];
        for (let i = rateLimitRows.length - 1; i >= 0; i--) {
          if (rateLimitRows[i].created_at.getTime() < cutoff) {
            deleted.push({ id: rateLimitRows[i].id });
            rateLimitRows.splice(i, 1);
          }
        }
        return deleted;
      }

      // Prune tokens
      if (q.startsWith('delete from password_reset_tokens')) {
        const cutoff = clockMs - 24 * 3600_000;
        const deleted = [];
        for (let i = tokenRows.length - 1; i >= 0; i--) {
          const t = tokenRows[i];
          if (
            t.expires_at.getTime() < cutoff ||
            (t.used_at && t.used_at.getTime() < cutoff) ||
            (t.invalidated_at && t.invalidated_at.getTime() < cutoff)
          ) {
            deleted.push({ id: t.id });
            tokenRows.splice(i, 1);
          }
        }
        return deleted;
      }

      // Prune mail failures
      if (q.startsWith('delete from password_reset_mail_failures')) {
        const cutoff = clockMs - 7 * 24 * 3600_000;
        const deleted = [];
        for (let i = mailFailureRows.length - 1; i >= 0; i--) {
          if (mailFailureRows[i].created_at.getTime() < cutoff) {
            deleted.push({ id: mailFailureRows[i].id });
            mailFailureRows.splice(i, 1);
          }
        }
        return deleted;
      }

      throw new Error(`Unhandled query in test harness: ${q}`);
    };
    return fn;
  }

  const sql = makeTagFn();
  sql.begin = async (callback) => {
    const prev = lockChain;
    let release;
    lockChain = new Promise((res) => {
      release = res;
    });
    await prev;
    // Snapshot arrays for rollback on error
    const tokenSnap = tokenRows.map((r) => ({ ...r }));
    const userSnap = userRows.map((r) => ({ ...r }));
    const sessionSnap = sessionRows.map((r) => ({ ...r }));
    const rateSnap = rateLimitRows.map((r) => ({ ...r }));
    try {
      const tx = makeTagFn();
      const result = await callback(tx);
      return result;
    } catch (err) {
      tokenRows.splice(0, tokenRows.length, ...tokenSnap);
      userRows.splice(0, userRows.length, ...userSnap);
      sessionRows.splice(0, sessionRows.length, ...sessionSnap);
      rateLimitRows.splice(0, rateLimitRows.length, ...rateSnap);
      throw err;
    } finally {
      release();
    }
  };

  return {
    sql,
    userRows,
    sessionRows,
    tokenRows,
    rateLimitRows,
    mailFailureRows,
    outboxRows,
    advanceMs(ms) {
      clockMs += ms;
    },
    setFailNextTokenInsert(v) {
      failNextTokenInsert = v;
    },
  };
}

function extractTokenFromHtml(html) {
  const match = html.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function loadComponent(file, hooksOverride = {}, globals = {}, mocks = {}) {
  const module = { exports: {} };
  const allowed = {
    react: { ...React, ...hooksOverride },
    'react/jsx-runtime': jsx,
    '@/lib/auth/validation': validationMod,
    ...mocks,
  };
  const compiled = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

  vm.runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      Response,
      TextDecoder,
      TextEncoder,
      URLSearchParams,
      ...globals,
      require(name) {
        if (name in allowed) return allowed[name];
        throw new Error(`Unexpected import in component test: ${name}`);
      },
    },
    { filename: file },
  );
  return module.exports;
}

function mountHarness(file, exportName, globals = {}) {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const hooks = {
    useState(initial) {
      const idx = cursor++;
      if (!(idx in slots)) {
        slots[idx] = typeof initial === 'function' ? initial() : initial;
      }
      return [
        slots[idx],
        (val) => {
          slots[idx] = typeof val === 'function' ? val(slots[idx]) : val;
        },
      ];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn) {
      effects.push(fn);
    },
  };
  const mod = loadComponent(file, hooks, globals);
  const Comp = mod[exportName];
  return {
    render(props = {}) {
      cursor = 0;
      return Comp(props);
    },
    runEffects() {
      while (effects.length > 0) {
        effects.shift()();
      }
    },
  };
}

function findNodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...React.Children.toArray(tree.props?.children).flatMap((child) =>
      findNodes(child, predicate),
    ),
  ];
}

test('forgot-password returns identical response for existing, unknown, blocked, closed, and email-rate-limited accounts', async () => {
  const oldHash = await bcrypt.hash('OldPassword123!', 12);
  const harness = createPasswordResetHarness({
    users: [
      { id: 'u1', email: 'active@example.com', password_hash: oldHash, first_name: 'A', last_name: 'User', is_blocked: false, anonymised_at: null },
      { id: 'u2', email: 'blocked@example.com', password_hash: oldHash, first_name: 'B', last_name: 'User', is_blocked: true, anonymised_at: null },
      { id: 'u3', email: 'closed@example.com', password_hash: oldHash, first_name: 'C', last_name: 'User', is_blocked: true, anonymised_at: new Date() },
    ],
  });

  const sentEmails = [];
  const deps = {
    sql: harness.sql,
    env: { NODE_ENV: 'production', APP_BASE_URL: 'https://shop.gadzio.test' },
    loadSettings: async () => defaultSettings(),
    sendDirectEmail: async (input) => {
      sentEmails.push(input);
      return { outcome: 'SENT', reason: '', permanent: false };
    },
  };

  const cases = [
    { email: 'active@example.com', ip: '198.51.100.1' },
    { email: 'unknown@example.com', ip: '198.51.100.2' },
    { email: 'blocked@example.com', ip: '198.51.100.3' },
    { email: 'closed@example.com', ip: '198.51.100.4' },
  ];

  for (const c of cases) {
    const res = await requestPasswordReset(c, deps);
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.message, FORGOT_PASSWORD_GENERIC_MESSAGE);
    await res.deferredWork();
  }

  // Only the active, non-anonymised user got a token and email.
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].recipient, 'active@example.com');
  assert.equal(harness.tokenRows.length, 1);
  assert.equal(harness.outboxRows.length, 0);

  // Hit per-email rate limit (3/hr) for active@example.com on different IPs:
  // 2nd and 3rd succeed, 4th still returns the exact same 200 generic message!
  for (let i = 0; i < 4; i++) {
    const res = await requestPasswordReset(
      { email: 'ACTIVE@example.com', ip: `198.51.100.${10 + i}` },
      deps,
    );
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.message, FORGOT_PASSWORD_GENERIC_MESSAGE);
    await res.deferredWork();
  }
  assert.equal(sentEmails.length, 3); // 1 + 2 = 3 total emails; 4th was suppressed silently
});

test('raw token is never stored in DB or logs, expires at 30m, is single-use, and new request invalidates older tokens', async () => {
  const oldHash = await bcrypt.hash('OldPassword123!', 12);
  const harness = createPasswordResetHarness({
    users: [
      { id: 'u1', email: 'user@example.com', password_hash: oldHash, first_name: 'Jane', last_name: 'Doe', phone: null, is_blocked: false, anonymised_at: null },
    ],
    sessions: [
      { token_hash: 'sess-1', user_id: 'u1' },
      { token_hash: 'sess-2', user_id: 'u1' },
    ],
  });

  const sentEmails = [];
  const capturedLogs = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...args) => capturedLogs.push(args.join(' '));
  console.log = (...args) => capturedLogs.push(args.join(' '));

  try {
    const deps = {
      sql: harness.sql,
      env: { NODE_ENV: 'production', APP_BASE_URL: 'https://shop.gadzio.test' },
      loadSettings: async () => defaultSettings(),
      sendDirectEmail: async (input) => {
        sentEmails.push(input);
        return { outcome: 'SENT', reason: '', permanent: false };
      },
    };

    const req1 = await requestPasswordReset({ email: 'user@example.com', ip: '203.0.113.1' }, deps);
    await req1.deferredWork();
    const token1 = extractTokenFromHtml(sentEmails[0].body);
    assert.ok(token1 && token1.length >= 32);

    // Raw token never stored in DB or logs
    assert.equal(harness.tokenRows[0].token_hash, sha256(token1));
    assert.notEqual(harness.tokenRows[0].token_hash, token1);
    assert.equal(JSON.stringify(harness.tokenRows).includes(token1), false);
    assert.equal(JSON.stringify(harness.outboxRows).includes(token1), false);
    assert.equal(capturedLogs.join('\n').includes(token1), false);

    // Expiry is 30 minutes on DB clock
    assert.equal(
      harness.tokenRows[0].expires_at.getTime() - harness.tokenRows[0].created_at.getTime(),
      30 * 60 * 1000,
    );

    // Second request invalidates token1
    const req2 = await requestPasswordReset({ email: 'user@example.com', ip: '203.0.113.1' }, deps);
    await req2.deferredWork();
    const token2 = extractTokenFromHtml(sentEmails[1].body);
    assert.ok(token2 && token2 !== token1);
    assert.ok(harness.tokenRows[0].invalidated_at !== null);

    // Invalidated token1 is rejected with generic error
    const badRes1 = await resetCustomerPassword(
      { token: token1, password: 'NewPassword123!', confirmPassword: 'NewPassword123!', ip: '203.0.113.1' },
      deps,
    );
    assert.equal(badRes1.ok, false);
    assert.equal(badRes1.error, INVALID_RESET_TOKEN_MESSAGE);

    // Advance 31 minutes -> token2 is expired
    harness.advanceMs(31 * 60 * 1000);
    const expiredRes = await resetCustomerPassword(
      { token: token2, password: 'NewPassword123!', confirmPassword: 'NewPassword123!', ip: '203.0.113.1' },
      deps,
    );
    assert.equal(expiredRes.ok, false);
    assert.equal(expiredRes.error, INVALID_RESET_TOKEN_MESSAGE);

    // Request token3, reset password successfully
    const req3 = await requestPasswordReset({ email: 'user@example.com', ip: '203.0.113.1' }, deps);
    await req3.deferredWork();
    const token3 = extractTokenFromHtml(sentEmails[2].body);

    const notificationsQueued = [];
    const okRes = await resetCustomerPassword(
      { token: token3, password: 'BrandNewPassword123!', confirmPassword: 'BrandNewPassword123!', ip: '203.0.113.1' },
      {
        ...deps,
        notifyPasswordChanged: (user) => notificationsQueued.push(user),
      },
    );
    assert.equal(okRes.ok, true);
    assert.equal(okRes.redirectTo, '/auth?reset=success');

    // Password updated with bcrypt cost 12, all sessions deleted, notification queued without token
    assert.match(harness.userRows[0].password_hash, /^\$2[ab]\$12\$/);
    assert.equal(await bcrypt.compare('BrandNewPassword123!', harness.userRows[0].password_hash), true);
    assert.equal(harness.sessionRows.length, 0);
    assert.equal(notificationsQueued.length, 1);
    assert.equal(JSON.stringify(notificationsQueued).includes(token3), false);

    // Reusing token3 fails (single use)
    const reuseRes = await resetCustomerPassword(
      { token: token3, password: 'AnotherPassword123!', confirmPassword: 'AnotherPassword123!', ip: '203.0.113.1' },
      deps,
    );
    assert.equal(reuseRes.ok, false);
    assert.equal(reuseRes.error, INVALID_RESET_TOKEN_MESSAGE);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
  }
});

test('link uses configured APP_BASE_URL, production rejects non-https/missing, and tx failure sends no email', async () => {
  const oldHash = await bcrypt.hash('OldPassword123!', 12);
  const harness = createPasswordResetHarness({
    users: [
      { id: 'u1', email: 'user@example.com', password_hash: oldHash, first_name: 'Jane', last_name: 'Doe', is_blocked: false, anonymised_at: null },
    ],
  });

  const sentEmails = [];
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    // 1. Production refuses http:// APP_BASE_URL
    await processForgotPasswordWork(
      { normalizedEmail: 'user@example.com', ip: '1.2.3.4', emailLimited: false },
      {
        sql: harness.sql,
        env: { NODE_ENV: 'production', APP_BASE_URL: 'http://shop.gadzio.test' },
        loadSettings: async () => defaultSettings(),
        sendDirectEmail: async (input) => {
          sentEmails.push(input);
          return { outcome: 'SENT', reason: '', permanent: false };
        },
      },
    );
    assert.equal(sentEmails.length, 0);
    assert.equal(harness.mailFailureRows.at(-1).reason, 'site_address_unconfigured');
    assert.ok(warnings.length > 0);

    // 2. Production refuses missing APP_BASE_URL
    await processForgotPasswordWork(
      { normalizedEmail: 'user@example.com', ip: '1.2.3.4', emailLimited: false },
      {
        sql: harness.sql,
        env: { NODE_ENV: 'production' },
        loadSettings: async () => defaultSettings(),
        sendDirectEmail: async (input) => {
          sentEmails.push(input);
          return { outcome: 'SENT', reason: '', permanent: false };
        },
      },
    );
    assert.equal(sentEmails.length, 0);

    // 3. Transaction failure -> email is NOT sent
    harness.setFailNextTokenInsert(true);
    await assert.rejects(() =>
      processForgotPasswordWork(
        { normalizedEmail: 'user@example.com', ip: '1.2.3.4', emailLimited: false },
        {
          sql: harness.sql,
          env: { NODE_ENV: 'production', APP_BASE_URL: 'https://real.gadzio.test' },
          loadSettings: async () => defaultSettings(),
          sendDirectEmail: async (input) => {
            sentEmails.push(input);
            return { outcome: 'SENT', reason: '', permanent: false };
          },
        },
      ),
    );
    assert.equal(sentEmails.length, 0);

    // 4. Configured APP_BASE_URL is used even if no Host header is trusted
    await processForgotPasswordWork(
      { normalizedEmail: 'user@example.com', ip: '1.2.3.4', emailLimited: false },
      {
        sql: harness.sql,
        env: { NODE_ENV: 'production', APP_BASE_URL: 'https://real.gadzio.test' },
        loadSettings: async () => defaultSettings(),
        sendDirectEmail: async (input) => {
          sentEmails.push(input);
          return { outcome: 'SENT', reason: '', permanent: false };
        },
      },
    );
    assert.equal(sentEmails.length, 1);
    assert.ok(sentEmails[0].body.includes('https://real.gadzio.test/reset-password?token='));
  } finally {
    console.warn = origWarn;
  }
});

test('per-IP 10/hr limit, concurrent requests, hashed limiter keys, and coarse unknown-IP bucket', async () => {
  const harness = createPasswordResetHarness();
  const deps = {
    sql: harness.sql,
    env: { NODE_ENV: 'production', APP_BASE_URL: 'https://shop.gadzio.test' },
    loadSettings: async () => defaultSettings(),
  };

  // Concurrent 12 requests from same IP -> 10 succeed, 2 return 429 with Retry-After
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      requestPasswordReset({ email: `unknown${i}@example.com`, ip: '198.51.100.99' }, deps),
    ),
  );
  const okCount = results.filter((r) => r.ok).length;
  const limitedCount = results.filter((r) => !r.ok && r.status === 429 && r.retryAfterSec > 0).length;
  assert.equal(okCount, 10);
  assert.equal(limitedCount, 2);

  // Limiter keys are hashed (raw email and raw IP never stored)
  const serialized = JSON.stringify(harness.rateLimitRows);
  assert.equal(serialized.includes('198.51.100.99'), false);
  assert.equal(serialized.includes('unknown0@example.com'), false);

  // Unknown IP (TRUST_PROXY unset -> '') uses coarse shared bucket
  const noProxyIp = clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.5' }), {});
  assert.equal(noProxyIp, '');
  for (let i = 0; i < 10; i++) {
    const r = await requestPasswordReset({ email: `u${i}@example.com`, ip: noProxyIp }, deps);
    assert.equal(r.ok, true);
  }
  const eleventh = await requestPasswordReset({ email: 'u10@example.com', ip: noProxyIp }, deps);
  assert.equal(eleventh.ok, false);
  assert.equal(eleventh.status, 429);

  // Prune cleans old rate limit rows after 2+ hours
  harness.advanceMs(3 * 3600_000);
  const pruned = await prunePasswordResetArtifacts(harness.sql);
  assert.ok(pruned.deletedRateLimits >= 20);
});

test('password policy, mismatch error, mail-not-configured failure recording, and Needs-attention item', async () => {
  const harness = createPasswordResetHarness({
    users: [
      { id: 'u1', email: 'user@example.com', password_hash: 'h', first_name: 'A', last_name: 'B', is_blocked: false, anonymised_at: null },
    ],
  });

  // Mismatch
  const mismatch = await resetCustomerPassword(
    { token: 'abc', password: 'Password123!', confirmPassword: 'Different123!', ip: '1.1.1.1' },
    { sql: harness.sql },
  );
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.error, 'Passwords do not match.');

  // Too short & >72 bytes
  const shortRes = await resetCustomerPassword(
    { token: 'abc', password: 'short', confirmPassword: 'short', ip: '1.1.1.1' },
    { sql: harness.sql },
  );
  assert.equal(shortRes.status, 400);
  assert.match(shortRes.error, /at least 8/);

  const longPw = 'a'.repeat(73);
  const longRes = await resetCustomerPassword(
    { token: 'abc', password: longPw, confirmPassword: longPw, ip: '1.1.1.1' },
    { sql: harness.sql },
  );
  assert.equal(longRes.status, 400);
  assert.match(longRes.error, /at most 72/);

  // Mail not configured -> generic 200 message, failure recorded, surfaces in Needs-attention
  const req = await requestPasswordReset(
    { email: 'user@example.com', ip: '1.1.1.2' },
    { sql: harness.sql },
  );
  assert.equal(req.ok, true);
  assert.equal(req.message, FORGOT_PASSWORD_GENERIC_MESSAGE);

  await processForgotPasswordWork(
    { normalizedEmail: 'user@example.com', ip: '1.1.1.2', emailLimited: false },
    {
      sql: harness.sql,
      env: { NODE_ENV: 'production', APP_BASE_URL: 'https://shop.gadzio.test' },
      loadSettings: async () => defaultSettings({ mail_status: 'off' }),
    },
  );
  assert.equal(harness.mailFailureRows.at(-1).reason, 'mail_not_configured');

  const items = buildNeedsAttentionItems({
    flaggedPaymentsCount: 0,
    refundsOwedCount: 0,
    refundsOwedPaise: 0,
    stuckVerifyingCount: 0,
    failedNotificationsCount: 0,
    passwordResetMailFailuresCount: harness.mailFailureRows.length,
    reconcile: { lastSuccessAt: null, lastError: '', lastProcessedCount: 0, stale: false },
  });
  const resetItem = items.find((i) => i.key === 'password_reset_mail_failures');
  assert.ok(resetItem);
  assert.equal(resetItem.urgent, true);
  assert.equal(resetItem.count, 1);
});

test('UI components: submit button disabled while loading, reset page strips token from URL and never consumes on GET', async () => {
  let resolveFetch;
  const fetchCalls = [];
  const fakeFetch = (url, init) => {
    fetchCalls.push({ url, init });
    return new Promise((res) => {
      resolveFetch = res;
    });
  };

  // ForgotPasswordForm
  const forgot = mountHarness('src/components/auth/ForgotPasswordForm.tsx', 'ForgotPasswordForm', {
    fetch: fakeFetch,
  });
  let tree = forgot.render();
  const emailInput = findNodes(tree, (n) => n.type === 'input' && n.props.name === 'email')[0];
  emailInput.props.onChange({ target: { value: 'user@example.com' } });
  tree = forgot.render();
  const form = findNodes(tree, (n) => n.type === 'form')[0];
  const submitPromise = form.props.onSubmit({ preventDefault() {} });
  tree = forgot.render();
  const submitBtn = findNodes(tree, (n) => n.type === 'button' && n.props.type === 'submit')[0];
  assert.equal(submitBtn.props.disabled, true);
  assert.equal(fetchCalls.length, 1);

  // Double submit while busy is ignored (use the re-rendered form)
  const busyForm = findNodes(tree, (n) => n.type === 'form')[0];
  await busyForm.props.onSubmit({ preventDefault() {} });
  assert.equal(fetchCalls.length, 1);

  resolveFetch({
    ok: true,
    json: async () => ({ message: FORGOT_PASSWORD_GENERIC_MESSAGE }),
  });
  await submitPromise;

  // ResetPasswordForm: strips token via history.replaceState on mount, never calls fetch on GET
  const replaceCalls = [];
  const fakeWindow = {
    location: { search: '?token=secret-url-token', href: '' },
    history: {
      replaceState(_state, _title, url) {
        replaceCalls.push(url);
      },
    },
  };
  const reset = mountHarness('src/components/auth/ResetPasswordForm.tsx', 'ResetPasswordForm', {
    window: fakeWindow,
    fetch: fakeFetch,
  });
  reset.render();
  reset.runEffects();
  assert.deepEqual(replaceCalls, ['/reset-password']);
  assert.equal(fetchCalls.length, 1); // No new fetch on GET!
});

test('maintenance mode, route allowlist, and store admin auth untouched', () => {
  assert.equal(isStorefrontPath('/forgot-password'), true);
  assert.equal(isStorefrontPath('/reset-password'), true);
  assert.equal(isBlockedPurchaseApi('/api/auth/forgot-password'), true);
  assert.equal(isBlockedPurchaseApi('/api/auth/reset-password'), true);
  assert.equal(shouldBlockPath('/forgot-password', true), true);
  assert.equal(shouldBlockPath('/reset-password', true), true);

  assert.deepEqual(PUBLIC_PASSWORD_RESET_ROUTES, [
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/forgot-password',
    '/reset-password',
  ]);

  const diffOut = execFileSync('git', ['diff', '--name-only', '--', 'src/lib/store-admin/auth.ts'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  assert.equal(diffOut, '');
});

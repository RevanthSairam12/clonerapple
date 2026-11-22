import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeCronRequest } from '../src/lib/payu/cron-auth.ts';

test('production fails closed when CRON_SECRET is unset', () => {
  const result = authorizeCronRequest({
    expectedSecret: undefined,
    authorization: null,
    isProduction: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /CRON_SECRET/);

  // An empty or whitespace secret is the same as unset.
  assert.equal(authorizeCronRequest({
    expectedSecret: '   ',
    authorization: 'Bearer anything',
    isProduction: true,
  }).status, 503);
});

test('development still allows an unset secret for manual runs unless ?secret= is passed', () => {
  assert.deepEqual(authorizeCronRequest({
    expectedSecret: undefined,
    authorization: null,
    isProduction: false,
  }), { ok: true });

  assert.equal(authorizeCronRequest({
    expectedSecret: undefined,
    authorization: null,
    hasQuerySecret: true,
    isProduction: false,
  }).status, 401);
});

test('a configured secret accepts Authorization Bearer or X-Cron-Secret headers and rejects query parameters', () => {
  const base = { expectedSecret: 'cron-secret', isProduction: true };

  assert.deepEqual(authorizeCronRequest({ ...base, authorization: 'Bearer cron-secret' }), { ok: true });
  assert.deepEqual(authorizeCronRequest({ ...base, authorization: 'cron-secret' }), { ok: true });
  assert.deepEqual(authorizeCronRequest({ ...base, authorization: null, cronSecretHeader: 'cron-secret' }), { ok: true });

  // SEC-006: ?secret= must NEVER authenticate, and presence of ?secret= is rejected even alongside a valid header.
  assert.equal(authorizeCronRequest({ ...base, authorization: null, querySecret: 'cron-secret' }).status, 401);
  assert.equal(authorizeCronRequest({ ...base, authorization: null, hasQuerySecret: true }).status, 401);
  assert.equal(
    authorizeCronRequest({
      ...base,
      authorization: 'Bearer cron-secret',
      hasQuerySecret: true,
    }).status,
    401,
  );

  for (const attempt of ['', 'Bearer wrong', 'Bearer cron-secret-extra', 'cron']) {
    const result = authorizeCronRequest({ ...base, authorization: attempt });
    assert.equal(result.ok, false, attempt);
    assert.equal(result.status, 401);
  }

  assert.equal(authorizeCronRequest({ ...base, authorization: null, cronSecretHeader: 'wrong' }).status, 401);
  assert.equal(authorizeCronRequest({ ...base, authorization: null }).status, 401);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeCronRequest } from '../src/lib/payu/cron-auth.ts';

test('production fails closed when CRON_SECRET is unset', () => {
  const result = authorizeCronRequest({
    expectedSecret: undefined,
    authorization: null,
    querySecret: null,
    isProduction: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /CRON_SECRET/);

  // An empty or whitespace secret is the same as unset.
  assert.equal(authorizeCronRequest({
    expectedSecret: '   ',
    authorization: 'Bearer anything',
    querySecret: null,
    isProduction: true,
  }).status, 503);
});

test('development still allows an unset secret for manual runs', () => {
  assert.deepEqual(authorizeCronRequest({
    expectedSecret: undefined,
    authorization: null,
    querySecret: null,
    isProduction: false,
  }), { ok: true });
});

test('a configured secret must match the bearer token or query parameter', () => {
  const base = { expectedSecret: 'cron-secret', isProduction: true };

  assert.deepEqual(authorizeCronRequest({ ...base, authorization: 'Bearer cron-secret', querySecret: null }), { ok: true });
  assert.deepEqual(authorizeCronRequest({ ...base, authorization: 'cron-secret', querySecret: null }), { ok: true });
  assert.deepEqual(authorizeCronRequest({ ...base, authorization: null, querySecret: 'cron-secret' }), { ok: true });

  for (const attempt of ['', 'Bearer wrong', 'Bearer cron-secret-extra', 'cron']) {
    const result = authorizeCronRequest({ ...base, authorization: attempt, querySecret: null });
    assert.equal(result.ok, false, attempt);
    assert.equal(result.status, 401);
  }

  assert.equal(authorizeCronRequest({ ...base, authorization: null, querySecret: 'wrong' }).status, 401);
  assert.equal(authorizeCronRequest({ ...base, authorization: null, querySecret: null }).status, 401);
});

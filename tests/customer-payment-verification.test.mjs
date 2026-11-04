import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { checkCustomerPayment } = await jiti.import(path.join(root, 'src/lib/account/payment-verification.ts'));
const { assertSameOrigin } = await jiti.import(path.join(root, 'src/lib/platform/api-guard.ts'));
const request = new Request('http://localhost:3000/api/account/orders/TEST/verify', {
  method: 'POST', headers: { origin: 'http://localhost:3000' },
});

function fixture({ order = { userId: 'owner', status: 'CREATED' }, result = {}, blocked = 0 } = {}) {
  const calls = { gateway: [], limits: [], audits: [] };
  return { calls, deps: {
    getOrderByTxnid: async () => order,
    verifyExistingOrderWithPayU: async (...args) => {
      calls.gateway.push(args);
      return { order: { ...order, status: 'PAID' }, status: 'PAID', ...result };
    },
    checkRateLimit: (key, options) => {
      calls.limits.push({ key, ...options });
      return { allowed: calls.limits.length !== blocked, retryAfterSec: 15 };
    },
    writeAudit: async (entry) => { calls.audits.push(entry); return true; },
  } };
}

for (const order of [null, { userId: 'another-customer', status: 'CREATED' }]) {
  test(`missing/foreign order returns the same 404 before gateway access (${order ? 'foreign' : 'missing'})`, async () => {
    const f = fixture({ order });
    const result = await checkCustomerPayment('owner', 'TEST', request, f.deps);
    assert.deepEqual(result, { status: 404, body: { error: 'Order not found.' } });
    assert.equal(f.calls.gateway.length, 0);
    assert.equal(f.calls.audits.length, 0);
    assert.equal(f.calls.limits.length, 0);
  });
}

test('already-paid owner returns effective PAID without repeated gateway or audit side effects', async () => {
  const f = fixture({ order: { userId: 'owner', status: 'PAID' } });
  const result = await checkCustomerPayment('owner', 'TEST', request, f.deps);
  assert.equal(result.body.status, 'PAID');
  assert.equal(f.calls.gateway.length, 0);
  assert.equal(f.calls.audits.length, 0);
});

for (const blocked of [1, 2]) {
  test(`rate-limit bucket ${blocked} rejects before gateway access`, async () => {
    const f = fixture({ blocked });
    const result = await checkCustomerPayment('owner', 'TEST', request, f.deps);
    assert.equal(result.status, 429);
    assert.equal(result.retryAfter, 15);
    assert.equal(f.calls.gateway.length, 0);
  });
}

test('owner check uses customer source and a sanitized audit', async () => {
  const f = fixture();
  const result = await checkCustomerPayment('owner', ' TEST ', request, f.deps);
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.gateway, [['TEST', 'customer']]);
  assert.deepEqual(f.calls.audits[0].after, { orderStatus: 'PAID', source: 'customer' });
  assert.equal(f.calls.audits[0].actorId, undefined);
  assert.equal(f.calls.audits[0].reason, 'gateway_checked');
  assert.deepEqual(f.calls.limits.map(({ limit, windowMs }) => ({ limit, windowMs })), [
    { limit: 10, windowMs: 60000 }, { limit: 1, windowMs: 15000 },
  ]);
});

test('gateway outage returns retryable 503, never a success claim', async () => {
  const f = fixture({ result: { status: 'PROCESSING', retryable: true } });
  const result = await checkCustomerPayment('owner', 'TEST', request, f.deps);
  assert.equal(result.status, 503);
  assert.equal(result.body.retryable, true);
  assert.notEqual(result.body.status, 'PAID');
  assert.equal(f.calls.audits[0].status, 'unavailable');
});

test('rejected payment returns safe review advice without upstream details', async () => {
  const f = fixture({ result: { status: 'CREATED', rejected: true, reason: 'private upstream text' } });
  const result = await checkCustomerPayment('owner', 'TEST', request, f.deps);
  assert.equal(result.status, 409);
  assert.match(result.body.error, /Do not pay again/);
  assert.ok(!JSON.stringify(result).includes('private upstream text'));
  assert.equal(f.calls.audits[0].reason, 'verification_rejected');
});

test('unconfirmed pending remains pending, not paid', async () => {
  const f = fixture({ result: { status: 'PENDING', retryable: false } });
  const result = await checkCustomerPayment('owner', 'TEST', request, f.deps);
  assert.equal(result.body.status, 'PENDING');
});

test('cross-origin requests are rejected by the route guard', () => {
  assert.equal(assertSameOrigin(new Request(request.url, {
    method: 'POST', headers: { origin: 'https://attacker.example' },
  })).status, 403);
  assert.equal(assertSameOrigin(request), null);
});

test('route binds the account session, checks origin first, and disables response caching', async () => {
  const source = await readFile(path.join(root, 'src/app/api/account/orders/[txnid]/verify/route.ts'), 'utf8');
  assert.ok(source.indexOf('assertSameOrigin(request)') < source.indexOf('await requireAccountSessionApi()'));
  assert.match(source, /if \(!auth.ok\) return auth.response/);
  assert.match(source, /checkCustomerPayment\(auth.session.userId, txnid, request\)/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /'Retry-After'/);
});

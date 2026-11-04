import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { processPayUCallback, verifyOrderWithPayU, verifyExistingOrderWithPayU } = await jiti.import(path.join(root, 'src/lib/payu/process-response.ts'));
const { computeReverseHash } = await jiti.import(path.join(root, 'src/lib/payu/hash.ts'));
const { reconcileOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/reconcile.ts'));
const { getOrderByTxnid, releaseOrderReservation } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));
const { safePaymentSummary } = await jiti.import(path.join(root, 'src/lib/payu/verify.ts'));
const { resolveReturnAccess } = await jiti.import(path.join(root, 'src/lib/payu/return-access.ts'));
const { issueReturnToken } = await jiti.import(path.join(root, 'src/lib/payu/return-link.ts'));
const { NextRequest } = await import('next/server.js');
const { handlePayUCallback } = await jiti.import(path.join(root, 'src/lib/payu/callback-route.ts'));

const envKeys = ['PAYU_KEY', 'PAYU_SALT', 'APP_BASE_URL', 'PAYU_RETURN_SECRET', 'DATABASE_URL'];
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const previousSql = globalThis.__gadzioSql;
let externalCalls = 0;
before(() => {
  process.env.PAYU_KEY = 'fixture-key';
  process.env.PAYU_SALT = 'fixture-salt';
  process.env.APP_BASE_URL = 'https://store.example.test';
  delete process.env.PAYU_RETURN_SECRET;
  process.env.DATABASE_URL = 'postgres://fixture:fixture@localhost/fixture';
  // A sentinel catches accidental application-pool reads/writes without opening
  // a real connection, even when the test runner inherited DATABASE_URL.
  globalThis.__gadzioSql = () => { externalCalls++; throw new Error('application pool used'); };
});
after(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  if (previousSql === undefined) delete globalThis.__gadzioSql;
  else globalThis.__gadzioSql = previousSql;
  assert.equal(externalCalls, 0, 'isolated callbacks never touch the application pool');
});

// Deliberately narrow SQL double: this suite tests dependency routing, not SQL
// correctness. The opt-in integration suite runs real locks/indexes/ledgers.
function fixture({ conflict = false, lateReview = false, activeReservation = false } = {}) {
  let row = {
    id: 'ord_fixture', txnid: 'FIXTURE', status: 'CREATED', amount: '500.00',
    total_paise: 50000, currency: 'INR', items: [],
    user_id: null, customer_name: '', customer_email: '', customer_phone: '',
    payu_mihpayid: null, payu_mode: null, payu_raw_response: null,
    reservation_state: activeReservation ? 'ACTIVE' : lateReview ? 'RELEASED' : 'NONE',
    reservation_expires_at: activeReservation ? new Date(Date.now() + 600_000) : null,
    processing_deadline: null,
    created_at: new Date(), updated_at: new Date(), paid_at: null,
  };
  const events = [];
  const queries = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    queries.push(text);
    if (text === 'select now() as now') return [{ now: new Date('2026-01-01T12:00:00Z') }];
    if (text.startsWith('update orders set next_reconcile_at')) return [];
    if (text.startsWith('select * from orders where txnid')) return values[0] === row.txnid ? [{ ...row }] : [];
    if (text.startsWith('select * from orders where payu_mihpayid')) return [];
    if (text.startsWith('select * from orders where id')) return [{ ...row }];
    if (text.startsWith('select id from orders where id')) return [{ id: row.id }];
    if (text.startsWith('update orders set status')) {
      if (conflict) throw Object.assign(new Error('duplicate mihpayid'), { code: '23505', constraint_name: 'idx_orders_mihpayid_unique' });
      row.status = values[0];
      row.payu_mihpayid = values[1];
      row.payu_raw_response = values[3];
      row.paid_at = values[4];
      row.cancelled_at = values[5];
      row.reservation_state = values[7];
      row.reservation_expires_at = values[8];
      row.processing_deadline = values[11];
      return [];
    }
    if (text.startsWith('update orders set payment_review_required')) { row.payment_review_required = true; return []; }
    if (text.startsWith('insert into payment_events')) { events.push(values); return []; }
    if (text.startsWith('insert into order_status_history')) return [];
    if (text.includes('to_regclass')) return [{ present: false }];
    if (text.includes('from store_settings')) return [{ key: 'auto_confirm', value: 'off' }, { key: 'default_fulfilment_status', value: 'PENDING' }];
    if (text.includes('from stock_movements')) {
      return lateReview ? [{ product_id: 'gone-product', released: 1, reclaimed: 0, quantity: 1 }] : [];
    }
    if (text.includes('from stock') || text.includes('from order_items')) return [];
    if (text.includes('refund_obligations')) {
      if (text.startsWith('insert')) return [{ id: 'refund_fixture', amount_paise: 50000 }];
      return [];
    }
    throw new Error(`Unexpected fixture SQL: ${text}`);
  };
  sql.begin = async (fn) => {
    const snapshot = { ...row };
    try { return await fn(sql); } catch (error) { row = snapshot; throw error; }
  };
  sql.json = (value) => value;
  return { sql, events, queries, row: () => row };
}

const policy = { reservationSeconds: 600, failureGraceSeconds: 0, unresolvedMinutes: 60 };
function payload(overrides = {}) {
  const data = { key: process.env.PAYU_KEY, txnid: 'FIXTURE', amount: '500.00', status: 'success', unmappedstatus: 'captured', ...overrides };
  return { ...data, hash: computeReverseHash({ ...data, salt: process.env.PAYU_SALT }) };
}
function verifier(overrides = {}) {
  return async (txnid, amount) => {
    assert.equal(txnid, 'FIXTURE');
    assert.equal(amount, 500);
    return { verified: true, status: 'success', unmappedstatus: 'captured', mihpayid: 'gateway_fixture', mode: 'UPI', amount: '500.00', amountPaise: 50000, raw: null, ...overrides };
  };
}
function options(f, verify = verifier()) {
  return { sql: f.sql, verifier: verify, policy, sideEffects: false };
}

test('injected verifier and connection settle once and keep the timeline on that connection', async () => {
  const f = fixture();
  const first = await processPayUCallback(payload(), 'webhook', options(f));
  const duplicate = await processPayUCallback(payload(), 'redirect', options(f));
  assert.equal(first.status, 'PAID');
  assert.equal(duplicate.status, 'PAID');
  assert.deepEqual(f.events.map((event) => event[4]), ['paid', 'unchanged']);
  assert.equal(f.queries.filter((text) => text.startsWith('insert into order_status_history')).length, 1);
});

test('invalid hash flags and records the rejection without calling the verifier', async () => {
  const f = fixture();
  const result = await processPayUCallback({ ...payload(), hash: 'invalid' }, 'webhook', options(f, async () => assert.fail('verifier called before hash check')));
  assert.equal(result.reason, 'tampered_hash');
  assert.equal(f.row().status, 'CREATED');
  assert.equal(f.row().payment_review_required, true);
  assert.equal(f.events[0][4], 'rejected');
});

test('amount mismatch rejects a correctly signed success', async () => {
  const f = fixture();
  const result = await processPayUCallback(payload({ amount: '499.99' }), 'webhook', options(f));
  assert.equal(result.reason, 'amount_mismatch');
  assert.equal(f.row().status, 'CREATED');
  assert.equal(f.events[0][5], 'amount_mismatch');
});

test('unknown transaction never calls verification or writes', async () => {
  const f = fixture();
  const result = await processPayUCallback(payload({ txnid: 'UNKNOWN' }), 'webhook', options(f, async () => assert.fail('unknown transaction verified')));
  assert.equal(result.order, null);
  assert.equal(f.events.length, 0);
});

test('verifier outage leaves success unconfirmed and processing', async () => {
  const f = fixture();
  const result = await processPayUCallback(payload(), 'webhook', options(f, async () => { throw new Error('fixture outage'); }));
  assert.equal(result.status, 'PROCESSING');
  assert.equal(f.events[0][4], 'processing');
});

for (const [status, unmappedstatus, expected] of [
  ['failure', 'failed', 'FAILED'],
  ['failure', 'userCancelled', 'CANCELLED'],
  ['pending', 'pending', 'PENDING'],
]) {
  test(`${status}/${unmappedstatus} stays unpaid with the injected verifier`, async () => {
    const f = fixture();
    const result = await processPayUCallback(payload({ status, unmappedstatus }), 'webhook', options(f, verifier({ verified: false, status: expected === 'FAILED' ? 'failure' : 'pending', unmappedstatus: 'pending' })));
    assert.equal(result.status, expected);
    assert.notEqual(f.row().status, 'PAID');
  });
}

test('unique-index race becomes a rejected event on the injected connection', async () => {
  const f = fixture({ conflict: true });
  const result = await processPayUCallback(payload(), 'webhook', options(f));
  assert.equal(result.reason, 'duplicate_gateway_payment');
  assert.equal(f.row().status, 'CREATED');
  assert.equal(f.row().payment_review_required, true);
  assert.equal(f.events[0][4], 'rejected');
});

test('late capture records its refund obligation but suppresses process-global audit writes', async () => {
  const f = fixture({ lateReview: true });
  const result = await processPayUCallback(payload(), 'webhook', options(f));
  assert.equal(result.status, 'PAID');
  assert.equal(f.row().payment_review_required, true);
  assert.ok(f.queries.some((text) => text.startsWith('insert into refund_obligations')));
  assert.equal(f.events[0][4], 'paid');
});

test('staff verification shares the seams and records source admin', async () => {
  const f = fixture();
  const result = await verifyOrderWithPayU('FIXTURE', options(f));
  assert.equal(result.status, 'PAID');
  assert.equal(f.events[0][2], 'admin');
});

test('customer verification settles once and records the honest customer source', async () => {
  const f = fixture();
  const first = await verifyExistingOrderWithPayU('FIXTURE', 'customer', options(f));
  const duplicate = await verifyExistingOrderWithPayU('FIXTURE', 'customer', options(f));
  assert.equal(first.status, 'PAID');
  assert.equal(duplicate.status, 'PAID');
  assert.deepEqual(f.events.map((event) => event[2]), ['customer', 'customer']);
  assert.equal(f.queries.filter((text) => text.startsWith('insert into order_status_history')).length, 1);
});

test('customer verification outage remains unpaid and explicitly retryable', async () => {
  const f = fixture();
  const result = await verifyExistingOrderWithPayU('FIXTURE', 'customer', options(f, async () => { throw new Error('fixture outage'); }));
  assert.equal(result.status, 'PROCESSING');
  assert.equal(result.retryable, true);
  assert.equal(f.events[0][2], 'customer');
});

test('customer checks do not extend the active reservation on an outage', async () => {
  const f = fixture({ activeReservation: true });
  const expiry = f.row().reservation_expires_at;
  const result = await verifyExistingOrderWithPayU('FIXTURE', 'customer', options(f, async () => { throw new Error('fixture outage'); }));
  assert.equal(result.status, 'PROCESSING');
  assert.equal(f.row().reservation_state, 'ACTIVE');
  assert.equal(f.row().reservation_expires_at.getTime(), expiry.getTime());
  assert.equal(f.row().processing_deadline.getTime(), expiry.getTime());
});

test('verified customer capture consumes the active reservation', async () => {
  const f = fixture({ activeReservation: true });
  const result = await verifyExistingOrderWithPayU('FIXTURE', 'customer', options(f));
  assert.equal(result.status, 'PAID');
  assert.equal(f.row().reservation_state, 'CONSUMED');
});

test('omitting policy reads settings only from the injected connection', async () => {
  const f = fixture();
  const opts = options(f);
  delete opts.policy;
  const result = await processPayUCallback(payload(), 'webhook', opts);
  assert.equal(result.status, 'PAID');
  assert.ok(f.queries.some((text) => text.includes('from store_settings')));
});

test('browser POST returns 303 on configured origin, ignoring forged Host', async () => {
  const f = fixture();
  const request = new NextRequest('https://attacker.example/api/payu/success', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'attacker.example' },
    body: new URLSearchParams(payload()),
  });
  const response = await handlePayUCallback(request, options(f));
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://store.example.test');
  assert.equal(location.pathname, '/order/success');
});

test('new persistence contains only allowlisted operational facts', async () => {
  const f = fixture();
  await processPayUCallback(payload({ email: 'private@example.test', firstname: 'Private', phone: '9876543210',
    error_Message: 'sensitive gateway error', udf1: 'opaque-secret', mode: 'UPI' }), 'webhook', options(f));
  assert.deepEqual(f.row().payu_raw_response, { status: 'success', unmappedstatus: 'captured', mode: 'UPI', amountPaise: 50000 });
  assert.deepEqual(safePaymentSummary({ status: 'private@example.test', mode: 'opaque-secret', error: 'secret' }), {});
});

test('settlement and failure grace use transaction time', async () => {
  const f = fixture({ activeReservation: true });
  await processPayUCallback(payload(), 'webhook', options(f));
  assert.equal(f.row().paid_at.toISOString(), '2026-01-01T12:00:00.000Z');
  const failed = fixture({ activeReservation: true });
  await processPayUCallback(payload({ status: 'failure', unmappedstatus: 'failed' }), 'webhook', {
    ...options(failed, verifier({ verified: false, status: 'failure', unmappedstatus: 'failed' })),
    policy: { ...policy, failureGraceSeconds: 120 },
  });
  assert.equal(failed.row().reservation_expires_at.toISOString(), '2026-01-01T12:02:00.000Z');
});

test('reservation release uses database time even when app clock says expired', async () => {
  const f = fixture({ activeReservation: true });
  f.row().reservation_expires_at = new Date('2026-01-01T12:01:00Z');
  const result = await releaseOrderReservation({ txnid: 'FIXTURE', state: 'EXPIRED', reason: 'fixture' }, f.sql);
  assert.equal(result.outcome, 'not-due');
});

for (const [code, raw] of [
  ['txnid_mismatch', { txnid: 'OTHER' }],
  ['currency_mismatch', { currency: 'USD' }],
  ['amount_mismatch', { amt: '499.99' }],
  ['productinfo_mismatch', { productinfo: 'Different product' }],
]) {
  for (const source of ['callback', 'admin', 'customer', 'reconcile']) {
    test(`${source} rejects returned ${code} without persisting raw evidence`, async () => {
      const f = fixture();
      f.row().items = [{ id: 'fixture', name: 'Cable', quantity: 1, price: 500 }];
      const verify = verifier({ raw: { ...raw, email: 'private@example.test', error: 'secret' } });
      if (source === 'callback') {
        assert.equal((await processPayUCallback(payload(), 'webhook', options(f, verify))).reason, code);
      } else if (source === 'reconcile') {
        await reconcileOrderUsing(f.sql, await getOrderByTxnid('FIXTURE', f.sql), {
          policy, autoCancelHours: 0, verifier: verify, now: new Date(), sideEffects: false,
          summary: { flagged: 0, unchanged: 0 },
        });
      } else {
        assert.equal((await verifyExistingOrderWithPayU('FIXTURE', source, options(f, verify))).reason, code);
      }
      assert.equal(f.row().status, 'CREATED');
      assert.equal(f.row().payment_review_required, true);
      assert.equal(f.events[0][5], code);
      assert.equal(f.row().payu_raw_response, null);
    });
  }
}

test('callback and verification gateway identities must agree', async () => {
  const f = fixture();
  const result = await processPayUCallback(payload({ mihpayid: 'different' }), 'webhook', options(f));
  assert.equal(result.reason, 'gateway_identity_mismatch');
  assert.equal(f.row().status, 'CREATED');
});

test('existing order gateway identity cannot be replaced by verified capture', async () => {
  const f = fixture();
  f.row().payu_mihpayid = 'original';
  assert.equal((await verifyOrderWithPayU('FIXTURE', options(f))).reason, 'gateway_identity_mismatch');
});

test('identity check inside the row lock rejects a concurrent same-order identity change', async () => {
  const f = fixture();
  const begin = f.sql.begin;
  f.sql.begin = async (fn) => {
    f.row().payu_mihpayid = 'concurrent-gateway-id';
    return begin(fn);
  };
  const result = await processPayUCallback(payload(), 'webhook', options(f));
  assert.equal(result.reason, 'gateway_identity_mismatch');
  assert.equal(f.row().status, 'CREATED');
  assert.equal(f.row().payu_mihpayid, 'concurrent-gateway-id');
  assert.equal(f.row().payment_review_required, true);
});

test('reconcile persists safe facts rather than raw verification payload', async () => {
  const f = fixture();
  const summary = { markedPaid: 0, unchanged: 0 };
  await reconcileOrderUsing(f.sql, await getOrderByTxnid('FIXTURE', f.sql), {
    policy, autoCancelHours: 0, verifier: verifier({ raw: { email: 'private@example.test', error: 'opaque-secret' } }),
    now: new Date(), sideEffects: false, summary,
  });
  assert.equal(f.row().status, 'PAID');
  assert.deepEqual(f.row().payu_raw_response, { status: 'success', unmappedstatus: 'captured', mode: 'UPI', amountPaise: 50000 });
});

test('a forged invalid callback cannot mint guest summary access', async () => {
  const f = fixture();
  process.env.PAYU_RETURN_SECRET = 'fixture-return-secret-at-least-32-characters';
  try {
    const result = await processPayUCallback({ ...payload(), hash: 'invalid' }, 'redirect', options(f));
    assert.equal(new URL(result.redirectUrl).searchParams.get('rt'), null);
  } finally { delete process.env.PAYU_RETURN_SECRET; }
});

test('exception preserves an existing valid signed token without granting new access', async () => {
  const f = fixture();
  f.sql.begin = async () => { throw new Error('fixture exception'); };
  process.env.PAYU_RETURN_SECRET = 'fixture-return-secret-at-least-32-characters';
  try {
    const token = issueReturnToken('FIXTURE');
    const response = await handlePayUCallback(new NextRequest(`https://store.example.test/api/payu/success?rt=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(payload()),
    }), options(f));
    assert.equal(new URL(response.headers.get('location')).searchParams.get('rt'), token);
  } finally { delete process.env.PAYU_RETURN_SECRET; }
});

test('reconcile duplicate gateway index race becomes a reviewed rejection', async () => {
  const f = fixture({ conflict: true });
  await reconcileOrderUsing(f.sql, await getOrderByTxnid('FIXTURE', f.sql), {
    policy, autoCancelHours: 0, verifier: verifier(), now: new Date(), sideEffects: false,
    summary: { flagged: 0, unchanged: 0 },
  });
  assert.equal(f.row().status, 'CREATED');
  assert.equal(f.events[0][5], 'duplicate_gateway_payment');
});

test('reconcile explicitly cancelled payment remains distinct from failure', async () => {
  const f = fixture();
  const summary = { markedCancelled: 0, markedFailed: 0, unchanged: 0 };
  await reconcileOrderUsing(f.sql, await getOrderByTxnid('FIXTURE', f.sql), {
    policy, autoCancelHours: 0, verifier: verifier({ verified: false, status: 'failure', unmappedstatus: 'userCancelled' }),
    now: new Date(), sideEffects: false, summary,
  });
  assert.equal(f.row().status, 'CANCELLED');
  assert.equal(summary.markedCancelled, 1);
});

test('processor exception preserves POST txn and returns uncertain same-origin 303', async () => {
  const f = fixture();
  f.sql.begin = async () => { throw new Error('private provider error'); };
  const response = await handlePayUCallback(new NextRequest('https://attacker.example/api/payu/success?txnid=FORGED', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(payload()),
  }), options(f));
  const location = new URL(response.headers.get('location'));
  assert.equal(response.status, 303);
  assert.equal(location.origin, 'https://store.example.test');
  assert.equal(location.pathname, '/order/status');
  assert.equal(location.searchParams.get('txnid'), 'FIXTURE');
  assert.equal(location.searchParams.get('rt'), null);
  assert.doesNotMatch(location.href, /private/);
});

test('guest summary requires signed token; only owner gets full access; missing secret fails closed', () => {
  const input = { txnid: 'FIXTURE', token: null, userId: null, sessionUserId: null };
  assert.equal(resolveReturnAccess(input), null);
  process.env.PAYU_RETURN_SECRET = 'fixture-return-secret-at-least-32-characters';
  try {
    const token = issueReturnToken('FIXTURE');
    assert.equal(resolveReturnAccess({ ...input, token }), 'summary');
    assert.equal(resolveReturnAccess({ ...input, txnid: 'OTHER', token }), null);
    assert.equal(resolveReturnAccess({ ...input, userId: 'owner', sessionUserId: 'other' }), null);
    assert.equal(resolveReturnAccess({ ...input, userId: 'owner', sessionUserId: 'owner' }), 'owner');
    delete process.env.PAYU_RETURN_SECRET;
    assert.equal(resolveReturnAccess({ ...input, token }), null);
  } finally { delete process.env.PAYU_RETURN_SECRET; }
});

test('missing site address still settles safely without a Location header', async () => {
  const f = fixture();
  const base = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;
  try {
    const response = await handlePayUCallback(new NextRequest('http://localhost/api/payu/success', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(payload()),
    }), options(f));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(f.row().status, 'PAID');
  } finally { process.env.APP_BASE_URL = base; }
});

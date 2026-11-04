import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';

// No dotenv loaders or postgres connections. Caller-owned connections below are
// in-memory SQL fakes, never configured DB clients.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { checkRefundCapacity, completionReference, initiateRefundUsing, resolveRefundRequestUsing,
  recordCompletedRefund } = await jiti.import(path.join(root, 'src/lib/store-admin/refund-lifecycle.ts'));

for (const [name, input, ok, reason] of [
  ['partial with pending', { amountPaise: 200, capturedPaise: 1000, refundedPaise: 300, pendingPaise: 400 }, true],
  ['exact remaining', { amountPaise: 300, capturedPaise: 1000, refundedPaise: 300, pendingPaise: 400 }, true],
  ['overshoot pending', { amountPaise: 301, capturedPaise: 1000, refundedPaise: 300, pendingPaise: 400 }, false, 'refund-exceeds-captured'],
  ['no capture', { amountPaise: 1, capturedPaise: 0, refundedPaise: 0, pendingPaise: 0 }, false, 'refund-exceeds-captured'],
  ['fractional paise', { amountPaise: 1.1, capturedPaise: 1000, refundedPaise: 0, pendingPaise: 0 }, false, 'invalid-amount'],
  ['unsafe integer', { amountPaise: Number.MAX_SAFE_INTEGER + 1, capturedPaise: 1e20, refundedPaise: 0, pendingPaise: 0 }, false, 'invalid-amount'],
  ['negative', { amountPaise: -1, capturedPaise: 1000, refundedPaise: 0, pendingPaise: 0 }, false, 'invalid-amount'],
  ['zero', { amountPaise: 0, capturedPaise: 1000, refundedPaise: 0, pendingPaise: 0 }, false, 'invalid-amount'],
  ['string amount', { amountPaise: '100', capturedPaise: 1000, refundedPaise: 0, pendingPaise: 0 }, false, 'invalid-amount'],
  ['return cap', { amountPaise: 200, capturedPaise: 1000, refundedPaise: 0, pendingPaise: 0, returnRemainingPaise: 199 }, false, 'return-cap-exceeded'],
  ['return exact cap', { amountPaise: 200, capturedPaise: 1000, refundedPaise: 0, pendingPaise: 0, returnRemainingPaise: 200 }, true],
]) {
  test(`capacity: ${name}`, () => {
    const result = checkRefundCapacity(input);
    assert.equal(result.ok, ok);
    if (!ok) assert.equal(result.reason, reason);
  });
}
test('all completion methods use a bounded, nonempty reference', () => {
  assert.equal(completionReference('  cash receipt #123  '), 'cash receipt #123');
  for (const value of ['', '   ', null, undefined, 123, 'x'.repeat(121)]) assert.equal(completionReference(value), null);
  assert.equal(completionReference('x'.repeat(120)).length, 120);
});

function fakeConnection({ existing = null, auditFailure = false, captured = 1000, orderStatus = 'PAID', returnStatus = 'RECEIVED', pending = 400, otherPending = 0 } = {}) {
  const queries = [];
  let rolledBack = false;
  let committed = false;
  const tx = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    queries.push({ query, values });
    if (query.startsWith('select id, txnid, status, total_paise')) return [{ id: 'o1', txnid: 't1', status: orderStatus, total_paise: 1000, amount: '10.00', currency: 'INR' }];
    if (query.startsWith('select * from refund_requests')) return [{ id: 'rreq_test', order_id: 'o1', amount_paise: 400, method: 'cash', currency: 'INR', reason: 'contact customer private@example.com', note: 'private note' }];
    if (query.startsWith('select status, refund_id from refund_request_events')) return existing ? [existing] : [];
    if (query.startsWith('select coalesce((select sum(amount_paise) from order_payments')) return [{ captured, refunded: existing?.status === 'COMPLETED' ? 400 : 0, pending: existing ? 0 : pending }];
    if (query.startsWith('select id, status from return_requests')) return [{ id: 'ret1', status: returnStatus }];
    if (query.includes('as expected,') && query.includes('as pending')) return [{ expected: 500, refunded: 0, pending: 0 }];
    if (query.startsWith('select coalesce(sum(amount_paise)::bigint, 0) as captured')) return [{ captured }];
    if (query.startsWith('select coalesce(sum(amount_paise)::bigint, 0) as refunded')) return [{ refunded: 0 }];
    if (query.startsWith('select coalesce(sum(q.amount_paise)')) return [{ pending: otherPending }];
    if (query.includes('as last_refund_id')) return [{ refunded: 400, last_refund_id: 'ref_test' }];
    if (query.startsWith('insert into store_admin_audit') && auditFailure) throw new Error('fake audit failure');
    return [];
  };
  tx.json = value => value;
  const sql = { begin: async callback => {
    try { const result = await callback(tx); committed = true; return result; }
    catch (error) { rolledBack = true; throw error; }
  } };
  return { sql, queries, get rolledBack() { return rolledBack; }, get committed() { return committed; } };
}
const actor = { actorId: 'staff1', actorEmail: 'staff@example.com' };
const initiatedInput = { ...actor, txnid: 't1', amountPaise: 200, method: 'cash', reason: 'private free text' };
const resolvedInput = { ...actor, txnid: 't1', requestId: 'rreq_test', status: 'COMPLETED', providerRef: 'cash receipt #123' };

test('initiation only reserves and audits; no ledger, return, stock or coupon effects', async () => {
  const fake = fakeConnection();
  const result = await initiateRefundUsing(fake.sql, initiatedInput);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'INITIATED');
  assert.equal(result.remainingPaise, 400);
  assert.equal(fake.committed, true);
  const mutations = fake.queries.filter(q => /^(insert|update|delete)/.test(q.query));
  assert.equal(mutations.length, 2);
  assert.match(mutations[0].query, /^insert into refund_requests/);
  assert.match(mutations[1].query, /^insert into store_admin_audit/);
  assert.equal(JSON.stringify(mutations[1].values).includes('private free text'), false);
});

test('PAID gateway-only capture fallback can reserve without payment ledger rows', async () => {
  const fake = fakeConnection({ captured: 0 });
  const result = await initiateRefundUsing(fake.sql, initiatedInput);
  assert.equal(result.ok, true);
  assert.equal(result.remainingPaise, 400);
});
test('pending/unpaid order cannot use total as captured fallback', async () => {
  const fake = fakeConnection({ captured: 0, orderStatus: 'PENDING' });
  const result = await initiateRefundUsing(fake.sql, initiatedInput);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'refund-exceeds-captured');
  assert.equal(fake.queries.some(q => q.query.startsWith('insert')), false);
});
test('initiation locks order before return and enforces received eligibility', async () => {
  const fake = fakeConnection({ returnStatus: 'APPROVED' });
  const result = await initiateRefundUsing(fake.sql, { ...initiatedInput, returnId: 'ret1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'return-not-received');
  assert.match(fake.queries[0].query, /from orders .*for update/);
  assert.match(fake.queries[1].query, /from return_requests .*for update/);
});
test('audit false causes transaction rollback, not a successful initiation', async () => {
  const fake = fakeConnection({ auditFailure: true });
  const result = await initiateRefundUsing(fake.sql, initiatedInput);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unavailable');
  assert.equal(fake.rolledBack, true);
  assert.equal(fake.committed, false);
});
test('completion records once, emits event and sanitized strict audit', async () => {
  const fake = fakeConnection();
  const result = await resolveRefundRequestUsing(fake.sql, resolvedInput);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.duplicate, false);
  assert.equal(result.remainingPaise, 600);
  assert.equal(fake.queries.filter(q => q.query.startsWith('insert into refunds ')).length, 1);
  assert.equal(fake.queries.filter(q => q.query.startsWith('insert into refund_request_events ')).length, 1);
  const audit = fake.queries.find(q => q.query.startsWith('insert into store_admin_audit'));
  assert.ok(audit);
  assert.equal(JSON.stringify(audit.values).includes('private note'), false);
  assert.equal(JSON.stringify(audit.values).includes('contact customer'), false);
});
test('fully reserved capacity does not restore a coupon until completed refunds alone cover capture', async () => {
  const fake = fakeConnection({ pending: 1000, otherPending: 600 });
  const result = await resolveRefundRequestUsing(fake.sql, resolvedInput);
  assert.equal(result.ok, true);
  assert.equal(result.remainingPaise, 0);
  assert.equal(fake.queries.some(q => q.query.includes('refunds_restore_coupon')), false);
});
test('completion audit failure rolls back ledger and event transaction', async () => {
  const fake = fakeConnection({ auditFailure: true });
  const result = await resolveRefundRequestUsing(fake.sql, resolvedInput);
  assert.equal(result.ok, false);
  assert.equal(fake.rolledBack, true);
  assert.equal(fake.committed, false);
});
test('duplicate completion returns its original ledger ID with no financial mutations', async () => {
  const fake = fakeConnection({ existing: { status: 'COMPLETED', refund_id: 'ref_original' } });
  const result = await resolveRefundRequestUsing(fake.sql, resolvedInput);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.refundId, 'ref_original');
  assert.equal(fake.queries.some(q => /^(insert|update|delete)/.test(q.query)), false);
});
for (const status of ['FAILED', 'REJECTED']) {
  test(`${status} releases capacity without completed side effects`, async () => {
    const fake = fakeConnection();
    const result = await resolveRefundRequestUsing(fake.sql, { ...resolvedInput, status });
    assert.equal(result.ok, true);
    assert.equal(result.remainingPaise, 1000);
    assert.equal(result.refundId, null);
    const mutations = fake.queries.filter(q => /^(insert|update|delete)/.test(q.query));
    assert.equal(mutations.length, 2);
    assert.match(mutations[0].query, /^insert into refund_request_events/);
    assert.match(mutations[1].query, /^insert into store_admin_audit/);
  });
}
test('terminal failure cannot later complete; retry needs new initiation', async () => {
  const fake = fakeConnection({ existing: { status: 'FAILED', refund_id: null } });
  const result = await resolveRefundRequestUsing(fake.sql, resolvedInput);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-terminal');
  assert.equal(fake.queries.some(q => /^(insert|update|delete)/.test(q.query)), false);
});
test('every completion method requires a reference, including cash', async () => {
  for (const providerRef of ['', ' ', 'x'.repeat(121)]) {
    const fake = fakeConnection();
    const result = await resolveRefundRequestUsing(fake.sql, { ...resolvedInput, providerRef });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-input');
    assert.equal(fake.queries.some(q => /^(insert|update|delete)/.test(q.query)), false);
  }
});
test('legacy immediate path atomically reserves and completes, never bypassing pending capacity', async () => {
  const fake = fakeConnection();
  const result = await recordCompletedRefund({ ...initiatedInput, amountPaise: 700, providerRef: 'receipt', note: '' }, fake.sql);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'refund-exceeds-captured');
  assert.equal(fake.rolledBack, true);
});
test('legacy immediate success creates initiation, completion and two audits in one transaction', async () => {
  const fake = fakeConnection();
  const result = await recordCompletedRefund({ ...initiatedInput, amountPaise: 400, providerRef: 'cash receipt', note: '' }, fake.sql);
  assert.equal(result.ok, true);
  assert.equal(fake.committed, true);
  assert.equal(fake.queries.filter(q => q.query.startsWith('insert into refund_requests ')).length, 1);
  assert.equal(fake.queries.filter(q => q.query.startsWith('insert into refunds ')).length, 1);
  assert.equal(fake.queries.filter(q => q.query.startsWith('insert into refund_request_events ')).length, 1);
  assert.equal(fake.queries.filter(q => q.query.startsWith('insert into store_admin_audit ')).length, 2);
});
test('migration preserves ledger and gives both new immutable tables RLS and unique terminal links', async () => {
  const sql = await readFile(path.join(root, 'migrations/0050_refund_lifecycle.sql'), 'utf8');
  for (const table of ['refund_requests', 'refund_request_events']) {
    assert.match(sql, new RegExp(`alter table ${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`before update or delete on ${table}`, 'i'));
  }
  assert.match(sql, /request_id text primary key references refund_requests/);
  assert.match(sql, /refund_id text unique references refunds/);
  assert.match(sql, /created_by text not null references store_admins/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) refunds\b/i);
  assert.doesNotMatch(sql, /\bcreate policy\b/i);
});

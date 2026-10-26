import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PENDING_TRANSACTION_STATUSES,
  REVENUE_STATUS,
  countPendingTransactions,
  isRevenueStatus,
} from '../src/lib/store-admin/analytics-rules.ts';

test('only a captured order is revenue', () => {
  assert.equal(REVENUE_STATUS, 'PAID');
  assert.equal(isRevenueStatus('PAID'), true);
  assert.equal(isRevenueStatus(' paid '), true, 'the SQL lower-case mix cannot leak in');
  for (const status of ['CREATED', 'PENDING', 'PROCESSING', 'FAILED', 'CANCELLED', 'REFUNDED']) {
    assert.equal(isRevenueStatus(status), false, `${status} is not revenue`);
  }
  assert.equal(isRevenueStatus(null), false);
  assert.equal(isRevenueStatus(undefined), false);
});

test('PROCESSING is an unconfirmed payment, not a pending-for-customer one', () => {
  assert.deepEqual([...PENDING_TRANSACTION_STATUSES], ['CREATED', 'PENDING', 'PROCESSING']);
  assert.equal(PENDING_TRANSACTION_STATUSES.includes('PAID'), false);
  assert.equal(PENDING_TRANSACTION_STATUSES.includes('FAILED'), false);
  assert.equal(PENDING_TRANSACTION_STATUSES.includes('CANCELLED'), false);
});

test('the pending tile adds PROCESSING to the orders still waiting on money', () => {
  const rows = [
    { status: 'CREATED', count: 1 },
    { status: 'PENDING', count: 2 },
    { status: 'PROCESSING', count: 3 },
    { status: 'PAID', count: 40 },
    { status: 'FAILED', count: 5 },
    { status: 'CANCELLED', count: 4 },
  ];
  assert.equal(countPendingTransactions(rows), 6);
  assert.equal(countPendingTransactions([]), 0);
  assert.equal(
    countPendingTransactions([{ status: 'processing', count: 2 }, { status: 'PAID', count: 9 }]),
    2,
    'the bucket is matched case-insensitively',
  );
  assert.equal(
    countPendingTransactions([{ status: 'PROCESSING', count: Number.NaN }]),
    0,
    'a malformed count cannot poison the tile',
  );
});

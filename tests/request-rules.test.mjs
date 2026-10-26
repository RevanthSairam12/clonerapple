import test from 'node:test';
import assert from 'node:assert/strict';

import { canTransitionRequest, validateCustomerRequestState } from '../src/lib/account/request-rules.ts';

test('customer request state rules enforce cancellation and return windows', () => {
  assert.equal(validateCustomerRequestState({ type: 'cancel', fulfilmentStatus: 'PENDING' }).ok, true);
  assert.equal(validateCustomerRequestState({ type: 'cancel', fulfilmentStatus: 'PROCESSING' }).ok, false);
  assert.equal(validateCustomerRequestState({ type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt: '2026-10-14T12:00:00Z', now: new Date('2026-10-21T12:00:00Z') }).ok, true);
  assert.equal(validateCustomerRequestState({ type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt: '2026-10-13T12:00:00Z', now: new Date('2026-10-21T12:00:00Z') }).ok, false);
});

test('the return window follows Store Admin settings and defaults to seven days', () => {
  const deliveredAt = '2026-10-14T12:00:00Z';
  const now = new Date('2026-10-28T12:00:00Z'); // 14 days later

  assert.equal(validateCustomerRequestState({
    type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt, now,
  }).ok, false, 'the default seven-day window closes');

  assert.equal(validateCustomerRequestState({
    type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt, now, returnWindowDays: 14,
  }).ok, true, 'a configured fourteen-day window stays open');

  assert.equal(validateCustomerRequestState({
    type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt, now, returnWindowDays: 30,
  }).ok, true);

  const message = validateCustomerRequestState({
    type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt, now, returnWindowDays: 10,
  });
  assert.equal(message.ok, false);
  assert.match(message.error, /within 10 days/);

  const oneDay = validateCustomerRequestState({
    type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt, now, returnWindowDays: 1,
  });
  assert.match(oneDay.error, /within 1 day\b/);

  // Invalid or empty values keep the default rather than blocking returns.
  assert.equal(validateCustomerRequestState({
    type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt, now: new Date('2026-10-20T12:00:00Z'), returnWindowDays: 0,
  }).ok, true);
});

test('request status transitions are forward and explicitly reopen in-progress work only', () => {
  assert.equal(canTransitionRequest('OPEN', 'IN_PROGRESS'), true);
  assert.equal(canTransitionRequest('IN_PROGRESS', 'OPEN'), true);
  assert.equal(canTransitionRequest('RESOLVED', 'OPEN'), false);
  assert.equal(canTransitionRequest('REJECTED', 'RESOLVED'), false);
});

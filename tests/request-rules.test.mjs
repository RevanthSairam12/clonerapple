import test from 'node:test';
import assert from 'node:assert/strict';

import { canTransitionRequest, validateCustomerRequestState } from '../src/lib/account/request-rules.ts';

test('customer request state rules enforce cancellation and return windows', () => {
  assert.equal(validateCustomerRequestState({ type: 'cancel', fulfilmentStatus: 'PENDING' }).ok, true);
  assert.equal(validateCustomerRequestState({ type: 'cancel', fulfilmentStatus: 'PROCESSING' }).ok, false);
  assert.equal(validateCustomerRequestState({ type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt: '2026-10-14T12:00:00Z', now: new Date('2026-10-21T12:00:00Z') }).ok, true);
  assert.equal(validateCustomerRequestState({ type: 'return', fulfilmentStatus: 'DELIVERED', deliveredAt: '2026-10-13T12:00:00Z', now: new Date('2026-10-21T12:00:00Z') }).ok, false);
});

test('request status transitions are forward and explicitly reopen in-progress work only', () => {
  assert.equal(canTransitionRequest('OPEN', 'IN_PROGRESS'), true);
  assert.equal(canTransitionRequest('IN_PROGRESS', 'OPEN'), true);
  assert.equal(canTransitionRequest('RESOLVED', 'OPEN'), false);
  assert.equal(canTransitionRequest('REJECTED', 'RESOLVED'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isOwnedBySession,
  isWithinReturnWindow,
  maskAccountEmail,
  maskAccountPhone,
  validateAddressInput,
} from '../src/lib/account/rules.ts';

test('address validation requires the customer shipping fields', () => {
  assert.equal(validateAddressInput({ name: 'Ravi Kumar', phone: '9876543210', line1: '1 Main Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).ok, true);
  assert.equal(validateAddressInput({ name: 'R', phone: '123', line1: '', city: 'Pune', state: '', pincode: '411' }).ok, false);
});

test('ownership helper only accepts the matching session user', () => {
  assert.equal(isOwnedBySession('user-a', 'user-a'), true);
  assert.equal(isOwnedBySession('user-a', 'user-b'), false);
  assert.equal(isOwnedBySession('user-a', null), false);
});

test('return window is inclusive through seven days and rejects future deliveries', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  assert.equal(isWithinReturnWindow('2026-10-14T12:00:00Z', now, 7), true);
  assert.equal(isWithinReturnWindow('2026-10-14T11:59:59Z', now, 7), false);
  assert.equal(isWithinReturnWindow('2026-10-22T12:00:00Z', now, 7), false);
});

test('account list masking does not expose full email or phone', () => {
  assert.equal(maskAccountEmail('ravi.kumar@example.com'), 'r***@example.com');
  assert.equal(maskAccountPhone('9876543210'), '98******10');
  assert.notEqual(maskAccountPhone('9876543210'), '9876543210');
});

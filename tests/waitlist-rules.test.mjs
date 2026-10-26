/**
 * Pure waiting-list rules: who may join, the deterministic FIFO order, the
 * cooldown for repeat buyers, token shape and the expiry wording shown to the
 * customer. The database holds the atomic guarantees; these are the decisions
 * shared by the API, the product page and the allocation worker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canJoinWaitingList,
  invitationIsOpen,
  invitationMessage,
  invitationSecondsRemaining,
  isCandidateEligible,
  isInvitationToken,
  nextEligibleCandidate,
  waitingListStatusLabel,
} from '../src/lib/waitlist/rules.ts';

const now = new Date('2026-10-26T12:00:00Z');

test('the list accepts only a product that cannot be bought', () => {
  const base = {
    productActive: true,
    trackInventory: true,
    inStock: true,
    onHand: 1,
    reserved: 0,
    enabled: true,
  };
  assert.deepEqual(canJoinWaitingList(base), { ok: false, reason: 'in-stock' });
  assert.deepEqual(canJoinWaitingList({ ...base, onHand: 0 }), { ok: true });
  assert.deepEqual(canJoinWaitingList({ ...base, onHand: 1, reserved: 1 }), { ok: true });
  assert.deepEqual(canJoinWaitingList({ ...base, enabled: false }), { ok: false, reason: 'disabled' });
  assert.deepEqual(
    canJoinWaitingList({ ...base, productActive: false }),
    { ok: false, reason: 'unavailable' },
  );
  assert.deepEqual(
    canJoinWaitingList({ ...base, trackInventory: false, inStock: false }),
    { ok: true },
  );
  assert.deepEqual(
    canJoinWaitingList({ ...base, trackInventory: false, inStock: true }),
    { ok: false, reason: 'in-stock' },
  );
});

test('FIFO is creation time then id, never a mutable position', () => {
  const candidates = [
    { id: 'wl_c', userId: 'u3', createdAt: '2026-10-26T12:05:00Z' },
    { id: 'wl_a', userId: 'u1', createdAt: '2026-10-26T12:01:00Z' },
    { id: 'wl_b', userId: 'u2', createdAt: '2026-10-26T12:01:00Z' },
  ];
  assert.equal(nextEligibleCandidate(candidates, now, 0)?.id, 'wl_a');
  assert.equal(
    nextEligibleCandidate([...candidates].reverse(), now, 0)?.id,
    'wl_a',
    'input order does not matter',
  );
});

test('blocked accounts and recent buyers are skipped without losing their place', () => {
  const candidates = [
    { id: 'wl_blocked', userId: 'u0', createdAt: '2026-10-26T11:00:00Z', userBlocked: true },
    { id: 'wl_recent', userId: 'u1', createdAt: '2026-10-26T11:10:00Z', lastPurchaseAt: '2026-10-26T11:50:00Z' },
    { id: 'wl_ok', userId: 'u2', createdAt: '2026-10-26T11:30:00Z', lastPurchaseAt: '2026-10-26T10:00:00Z' },
  ];
  assert.equal(nextEligibleCandidate(candidates, now, 30)?.id, 'wl_ok');
  assert.equal(isCandidateEligible(candidates[0], now, 0), false);
  assert.equal(isCandidateEligible(candidates[1], now, 30), false);
  assert.equal(
    isCandidateEligible(candidates[1], new Date('2026-10-26T12:20:00Z'), 30),
    true,
    'the cooldown ends after the configured minutes',
  );
});

test('only a 64-character lower-case hex token is accepted', () => {
  assert.equal(isInvitationToken('a'.repeat(64)), true);
  assert.equal(isInvitationToken('A'.repeat(64)), false);
  assert.equal(isInvitationToken('a'.repeat(63)), false);
  assert.equal(isInvitationToken('g'.repeat(64)), false);
  assert.equal(isInvitationToken(null), false);
  assert.equal(isInvitationToken(undefined), false);
});

test('an invitation is open only while HELD and before its deadline', () => {
  assert.equal(invitationIsOpen('HELD', '2026-10-26T12:15:00Z', now), true);
  assert.equal(invitationIsOpen('HELD', '2026-10-26T11:59:59Z', now), false);
  assert.equal(invitationIsOpen('CLAIMED', '2026-10-26T12:15:00Z', now), false);
  assert.equal(invitationIsOpen('EXPIRED', '2026-10-26T12:15:00Z', now), false);
  assert.equal(invitationSecondsRemaining('2026-10-26T12:15:00Z', now), 15 * 60);
});

test('expiry wording never pretends the unit is still held', () => {
  assert.equal(invitationMessage('HELD', '2026-10-26T12:15:00Z', now), '');
  assert.match(invitationMessage('HELD', '2026-10-26T11:00:00Z', now), /expired/);
  assert.match(invitationMessage('CLAIMED', null, now), /already been used/);
  assert.match(invitationMessage('EXPIRED', null, now), /expired/);
  assert.match(invitationMessage('CANCELLED', null, now), /no longer available/);
  assert.match(invitationMessage('HELD', null, now), /expired/);
});

test('status labels tell the customer what they can do next', () => {
  assert.equal(waitingListStatusLabel('ACTIVE'), 'On the waiting list');
  assert.equal(waitingListStatusLabel('INVITED'), 'A unit is being held for you');
  assert.equal(waitingListStatusLabel('EXPIRED'), 'Invitation expired');
  assert.equal(waitingListStatusLabel(null), 'Not on the waiting list');
});

/**
 * Pure flash-sale reservation rules: the policy defaults, the "verified only"
 * payment classification, the bounded reconcile backoff, customer-facing
 * phases and the release decisions. No database and no wall clock — every
 * function is given `now`, so these assertions are deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RESERVATION_POLICY,
  MAX_CONSECUTIVE_RECONCILE_FAILURES,
  classifyVerification,
  customerPaymentPhase,
  decideCallbackOutcome,
  failureReleaseAt,
  failureReleaseDecision,
  nextReconcileAt,
  nextReconcileDelaySeconds,
  parseReservationPolicy,
  recordReconcileAttempt,
  secondsRemaining,
  unresolvedDeadline,
  unresolvedWindowClosed,
} from '../src/lib/checkout/reservation-rules.ts';

const now = new Date('2026-10-26T12:00:00Z');

test('defaults: a 10-minute checkout hold, 120s failure grace, 60min unresolved window', () => {
  assert.equal(DEFAULT_RESERVATION_POLICY.reservationSeconds, 600);
  assert.equal(DEFAULT_RESERVATION_POLICY.failureGraceSeconds, 120);
  assert.equal(DEFAULT_RESERVATION_POLICY.unresolvedMinutes, 60);
  assert.equal(DEFAULT_RESERVATION_POLICY.waitlistClaimMinutes, 15);
  assert.equal(DEFAULT_RESERVATION_POLICY.waitlistEnabled, true);

  const parsed = parseReservationPolicy({});
  assert.deepEqual(parsed, DEFAULT_RESERVATION_POLICY);

  // The editable range is still 30–1800 seconds; only the default moved.
  assert.equal(parseReservationPolicy({ reservation_seconds: '10' }).reservationSeconds, 30);
  assert.equal(parseReservationPolicy({ reservation_seconds: '1800' }).reservationSeconds, 1800);
  assert.equal(parseReservationPolicy({ reservation_seconds: '7200' }).reservationSeconds, 1800);
});

test('a configured policy is clamped to safe bounds', () => {
  const parsed = parseReservationPolicy({
    reservation_seconds: '60',
    payment_failure_grace_seconds: '0',
    payment_unresolved_minutes: '15',
    waitlist_enabled: 'off',
    waitlist_claim_minutes: '10',
    waitlist_retry_minutes: '45',
  });
  assert.equal(parsed.reservationSeconds, 60);
  assert.equal(parsed.failureGraceSeconds, 0);
  assert.equal(parsed.unresolvedMinutes, 15);
  assert.equal(parsed.waitlistEnabled, false);
  assert.equal(parsed.waitlistClaimMinutes, 10);
  assert.equal(parsed.waitlistRetryMinutes, 45);

  const junk = parseReservationPolicy({
    reservation_seconds: 'abc',
    payment_failure_grace_seconds: '-5',
    waitlist_claim_minutes: '99999',
  });
  assert.equal(junk.reservationSeconds, 600, 'junk falls back to the default');
  assert.equal(junk.failureGraceSeconds, 0, 'a negative grace floors at zero');
  assert.equal(junk.waitlistClaimMinutes, 1440, 'an absurd claim window is capped');
});

test('only a verified capture is a paid payment', () => {
  assert.equal(classifyVerification({ verified: true, status: 'success' }), 'paid');
  assert.equal(classifyVerification({ verified: false, status: 'failure' }), 'failed');
  assert.equal(classifyVerification({ verified: false, status: 'pending' }), 'pending');
  assert.equal(classifyVerification({ verified: false, status: 'NOT_FOUND' }), 'abandoned');
  assert.equal(classifyVerification({ verified: false, error: 'network' }), 'unknown');
  assert.equal(classifyVerification(null), 'unknown');
  assert.equal(classifyVerification(undefined), 'unknown');
});

test('a success claim the server cannot verify stays processing, never failed', () => {
  const decision = decideCallbackOutcome({
    status: 'success',
    verification: { verified: false, error: 'gateway timeout' },
  });
  assert.equal(decision.target, 'PROCESSING');
  assert.equal(decision.outcome, 'unknown');

  const verified = decideCallbackOutcome({
    status: 'success',
    verification: { verified: true, status: 'success' },
  });
  assert.equal(verified.target, 'PAID');
  assert.equal(verified.outcome, 'paid');
});

test('definitive failures fail; cancellation and pending are kept distinct', () => {
  assert.equal(
    decideCallbackOutcome({ status: 'failure', verification: { verified: false, status: 'failure' } }).target,
    'FAILED',
  );
  assert.equal(
    decideCallbackOutcome({ status: 'failure', verification: { verified: false, status: 'failure' } }).outcome,
    'failed',
  );
  assert.equal(decideCallbackOutcome({ status: 'usercancelled' }).target, 'CANCELLED');
  assert.equal(decideCallbackOutcome({ status: 'pending' }).target, 'PENDING');
  // A missing gateway record is not proof of failure: the browser may have
  // closed before paying and the reconciler resolves it at expiry.
  assert.equal(
    decideCallbackOutcome({ status: 'success', verification: { verified: false, status: 'NOT_FOUND' } }).target,
    'PROCESSING',
  );
});

test('reconcile retries back off to a bounded delay and reset on a real answer', () => {
  assert.equal(nextReconcileDelaySeconds(1), 60);
  assert.equal(nextReconcileDelaySeconds(2), 120);
  assert.equal(nextReconcileDelaySeconds(3), 240);
  assert.equal(nextReconcileDelaySeconds(99), 900);
  assert.equal(
    nextReconcileAt(2, now).toISOString(),
    '2026-10-26T12:02:00.000Z',
  );

  assert.deepEqual(recordReconcileAttempt(3, 'unknown'), { failures: 4, reset: false });
  assert.deepEqual(recordReconcileAttempt(3, 'paid'), { failures: 0, reset: true });
  assert.deepEqual(recordReconcileAttempt(3, 'failed'), { failures: 0, reset: true });
  assert.equal(MAX_CONSECUTIVE_RECONCILE_FAILURES, 5);
});

test('the failure grace and unresolved deadlines come from the policy', () => {
  assert.equal(
    failureReleaseAt(now, { ...DEFAULT_RESERVATION_POLICY, failureGraceSeconds: 120 }).toISOString(),
    '2026-10-26T12:02:00.000Z',
  );
  assert.equal(
    unresolvedDeadline(now, { ...DEFAULT_RESERVATION_POLICY, unresolvedMinutes: 60 }).toISOString(),
    '2026-10-26T13:00:00.000Z',
  );
  assert.equal(unresolvedWindowClosed('2026-10-26T11:59:59Z', now), true);
  assert.equal(unresolvedWindowClosed('2026-10-26T12:00:01Z', now), false);
  assert.equal(unresolvedWindowClosed(null, now), false);
});

test('the customer phase is paid first and expired stays expired', () => {
  assert.equal(
    customerPaymentPhase(
      { status: 'PAID', reservationState: 'EXPIRED', reservationExpiresAt: null },
      now,
    ),
    'paid',
    'a verified payment wins even if the hold had expired',
  );
  assert.equal(customerPaymentPhase({ status: 'PROCESSING', reservationState: 'ACTIVE' }, now), 'processing');
  assert.equal(customerPaymentPhase({ status: 'FAILED', reservationState: 'ACTIVE' }, now), 'failed');
  assert.equal(
    customerPaymentPhase(
      { status: 'CANCELLED', reservationState: 'EXPIRED' },
      now,
    ),
    'expired',
  );
  assert.equal(
    customerPaymentPhase(
      { status: 'CREATED', reservationState: 'ACTIVE', reservationExpiresAt: '2026-10-26T12:01:00Z' },
      now,
    ),
    'active',
  );
  assert.equal(
    customerPaymentPhase(
      { status: 'CREATED', reservationState: 'ACTIVE', reservationExpiresAt: '2026-10-26T11:59:00Z' },
      now,
    ),
    'pending',
  );
  assert.equal(secondsRemaining('2026-10-26T12:01:00Z', now), 60);
  assert.equal(secondsRemaining('2026-10-26T11:00:00Z', now), 0);
});

test('a failed order releases only after its grace window has ended', () => {
  const policy = { ...DEFAULT_RESERVATION_POLICY, failureGraceSeconds: 120 };
  assert.equal(
    failureReleaseDecision(
      { status: 'FAILED', reservationState: 'ACTIVE', reservationExpiresAt: '2026-10-26T12:01:00Z' },
      now,
      policy,
    ),
    null,
    'inside the grace window the units stay held',
  );

  const due = failureReleaseDecision(
    { status: 'FAILED', reservationState: 'ACTIVE', reservationExpiresAt: '2026-10-26T11:59:00Z' },
    now,
    policy,
  );
  assert.equal(due?.release, true);
  assert.equal(due?.changeStatus, false);
  assert.equal(due?.nextState, 'RELEASED');

  assert.equal(
    failureReleaseDecision(
      { status: 'PAID', reservationState: 'ACTIVE', reservationExpiresAt: '2026-10-26T11:59:00Z' },
      now,
      policy,
    ),
    null,
    'stock on a paid order is never released',
  );
});

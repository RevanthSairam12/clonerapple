/**
 * Pure flash-sale reservation and payment-outcome rules.
 *
 * Database-free on purpose: the same decision (is this reservation still
 * holding stock, may it be released, did PayU give us a definitive answer)
 * is used by the callback handler, the reconciliation worker, the customer
 * status page and the tests.
 *
 * Server time is the only clock. Every function takes `now` so a test can move
 * time without sleeping and so the worker never trusts a browser-reported
 * deadline.
 */

export interface ReservationPolicy {
  /** How long an online checkout may hold stock before it is re-checked. */
  reservationSeconds: number;
  /** How long stock is kept after a definitive payment failure. */
  failureGraceSeconds: number;
  /** How long an ambiguous payment may keep its claim before ops review. */
  unresolvedMinutes: number;
  /** How long a waiting-list invitation holds one unit. */
  waitlistClaimMinutes: number;
  /** A customer is not re-invited sooner than this after an expiry. */
  waitlistRetryMinutes: number;
  waitlistEnabled: boolean;
}

export const DEFAULT_RESERVATION_POLICY: ReservationPolicy = {
  reservationSeconds: 120,
  failureGraceSeconds: 120,
  unresolvedMinutes: 60,
  waitlistClaimMinutes: 15,
  waitlistRetryMinutes: 30,
  waitlistEnabled: true,
};

function wholeNumber(value: unknown, fallback: number): number {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isOn(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Read the owner-editable policy. A missing, empty or nonsensical value falls
 * back to the default; a value outside the safe band is clamped so a typo
 * cannot hold stock forever or expire it before the gateway answers.
 */
export function parseReservationPolicy(
  settings: Readonly<Record<string, string | undefined>>,
): ReservationPolicy {
  const reservation = Number.isFinite(Number(String(settings.reservation_seconds ?? '').trim()))
    && String(settings.reservation_seconds ?? '').trim() !== ''
    ? wholeNumber(settings.reservation_seconds, DEFAULT_RESERVATION_POLICY.reservationSeconds)
    : DEFAULT_RESERVATION_POLICY.reservationSeconds;
  const graceRaw = String(settings.payment_failure_grace_seconds ?? '').trim();
  const unresolvedRaw = String(settings.payment_unresolved_minutes ?? '').trim();
  const claimRaw = String(settings.waitlist_claim_minutes ?? '').trim();
  const retryRaw = String(settings.waitlist_retry_minutes ?? '').trim();
  const waitlistRaw = String(settings.waitlist_enabled ?? '').trim();

  return {
    reservationSeconds: clamp(reservation, 30, 1800),
    failureGraceSeconds: graceRaw === ''
      ? DEFAULT_RESERVATION_POLICY.failureGraceSeconds
      : clamp(wholeNumber(graceRaw, DEFAULT_RESERVATION_POLICY.failureGraceSeconds), 0, 900),
    unresolvedMinutes: unresolvedRaw === ''
      ? DEFAULT_RESERVATION_POLICY.unresolvedMinutes
      : clamp(wholeNumber(unresolvedRaw, DEFAULT_RESERVATION_POLICY.unresolvedMinutes), 5, 1440),
    waitlistClaimMinutes: claimRaw === ''
      ? DEFAULT_RESERVATION_POLICY.waitlistClaimMinutes
      : clamp(wholeNumber(claimRaw, DEFAULT_RESERVATION_POLICY.waitlistClaimMinutes), 5, 1440),
    waitlistRetryMinutes: retryRaw === ''
      ? DEFAULT_RESERVATION_POLICY.waitlistRetryMinutes
      : clamp(wholeNumber(retryRaw, DEFAULT_RESERVATION_POLICY.waitlistRetryMinutes), 0, 10080),
    waitlistEnabled: waitlistRaw === ''
      ? DEFAULT_RESERVATION_POLICY.waitlistEnabled
      : isOn(waitlistRaw),
  };
}

export type PaymentOutcome =
  | 'paid'
  | 'failed'
  | 'abandoned'
  | 'pending'
  | 'unknown';

export interface VerificationLike {
  verified: boolean;
  status?: string | null;
  unmappedstatus?: string | null;
  error?: string | null;
}

/**
 * Classify the trusted server-to-server verification result.
 *
 * Only a verified capture is `paid`. A `failure` from PayU's verify API is a
 * definitive failed payment. `NOT_FOUND` means PayU has no transaction for
 * that id, which is the abandoned-checkout case (never a client redirect).
 * Everything else — network error, HTTP error, parse error, pending, a
 * success claim that the amount check rejected — is `unknown` and must keep
 * the order in processing rather than fail it.
 */
export function classifyVerification(result: VerificationLike | null | undefined): PaymentOutcome {
  if (!result) return 'unknown';
  if (result.verified) return 'paid';

  const status = String(result.status ?? '').trim().toLowerCase();
  const unmapped = String(result.unmappedstatus ?? '').trim().toLowerCase();

  if (status === 'not_found' || unmapped === 'no_record') return 'abandoned';
  if (status === 'failure' || status === 'failed') return 'failed';
  if (status === 'pending' || unmapped === 'pending' || unmapped === 'pending_payment') {
    return 'pending';
  }
  // A success claim that failed verification (amount mismatch, no capture)
  // is ambiguous, not a failed payment: the customer may still have been
  // charged and a human must look at it.
  if (status === 'success') return 'unknown';
  if (status === 'usercancelled' || unmapped === 'usercancelled') return 'failed';
  return 'unknown';
}

export type CallbackTarget = 'PAID' | 'FAILED' | 'CANCELLED' | 'PENDING' | 'PROCESSING';

export interface CallbackDecision {
  target: CallbackTarget;
  outcome: PaymentOutcome;
  reason: string;
}

/**
 * Combine the hash-verified browser/webhook callback with the trusted
 * server-to-server verification.
 *
 * A verified capture always wins. A success the verifier could not confirm is
 * ambiguous, never failed: the customer may have been debited and a human (or
 * the next reconcile tick) must resolve it. An explicit `failure` status is
 * definitive only because the callback hash proves PayU sent it; `timeout` is
 * not, because the bank may still settle it.
 */
export function decideCallbackOutcome(input: {
  status: string;
  unmappedstatus?: string | null;
  verification?: VerificationLike | null;
  verificationError?: string | null;
}): CallbackDecision {
  const callbackStatus = String(input.status ?? '').trim().toLowerCase();
  const unmapped = String(input.unmappedstatus ?? '').trim().toLowerCase();
  const outcome = classifyVerification(input.verification);

  if (outcome === 'paid') {
    return { target: 'PAID', outcome, reason: 'verified capture' };
  }

  // PayU said success but the server could not confirm the capture. Never
  // treat that as proof; keep the claim and let verification finish.
  if (callbackStatus === 'success') {
    return {
      target: 'PROCESSING',
      outcome,
      reason: input.verificationError
        ? 'success callback could not be verified'
        : 'success callback not yet confirmed',
    };
  }

  if (outcome === 'failed') {
    return { target: 'FAILED', outcome, reason: 'verified failure' };
  }

  if (callbackStatus === 'usercancelled' || unmapped === 'usercancelled') {
    return { target: 'CANCELLED', outcome: 'failed', reason: 'customer cancelled' };
  }

  if (outcome === 'pending' || callbackStatus === 'pending') {
    return { target: 'PENDING', outcome: 'pending', reason: 'payment pending' };
  }

  if (callbackStatus === 'failure' || callbackStatus === 'failed') {
    return { target: 'FAILED', outcome: 'failed', reason: 'definitive failure callback' };
  }

  // NOT_FOUND on the verify API means no payment was ever started; the browser
  // may simply have been closed. It is only safe to cancel when the callback
  // itself reports a failure, otherwise the reconciler resolves it at expiry.
  if (outcome === 'abandoned') {
    return {
      target: 'PROCESSING',
      outcome,
      reason: 'no gateway record yet',
    };
  }

  return {
    target: 'PROCESSING',
    outcome: 'unknown',
    reason: input.verificationError || 'payment outcome not yet known',
  };
}

/** 60s, 120s, 240s … capped at 15 minutes. */
export function nextReconcileDelaySeconds(attempts: unknown): number {
  const safe = Number.isFinite(Number(attempts)) ? Math.max(1, Math.trunc(Number(attempts))) : 1;
  return Math.min(900, 60 * 2 ** Math.min(6, safe - 1));
}

/** When the next PayU verification is allowed after an attempt count. */
export function nextReconcileAt(attempts: unknown, now: Date): Date {
  return new Date(now.getTime() + nextReconcileDelaySeconds(attempts) * 1000);
}

export function addSeconds(now: Date, seconds: number): Date {
  return new Date(now.getTime() + Math.max(0, Math.trunc(seconds)) * 1000);
}

export function addMinutes(now: Date, minutes: number): Date {
  return addSeconds(now, Math.max(0, Math.trunc(minutes)) * 60);
}

/** The release deadline after a definitive failure callback. */
export function failureReleaseAt(now: Date, policy: ReservationPolicy): Date {
  return addSeconds(now, policy.failureGraceSeconds);
}

/** The end of the safe recovery window for an ambiguous payment. */
export function unresolvedDeadline(now: Date, policy: ReservationPolicy): Date {
  return addMinutes(now, policy.unresolvedMinutes);
}

export type ReservationState = 'NONE' | 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

export interface ReservationView {
  status: string;
  reservationState: string | null | undefined;
  reservationExpiresAt?: Date | string | null;
  reservationReleasedAt?: Date | string | null;
  reservationReleasedReason?: string | null;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function secondsRemaining(expiresAt: Date | string | null | undefined, now: Date): number {
  const date = asDate(expiresAt);
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

/**
 * What the customer should see. A paid order is always paid. An expired or
 * released reservation never comes back to life, even when a delayed callback
 * later records the capture: that is a payment decision for ops, not a
 * reopened checkout window.
 */
export type CustomerPaymentPhase =
  | 'paid'
  | 'processing'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'active'
  | 'pending';

export function customerPaymentPhase(
  view: ReservationView,
  now: Date,
): CustomerPaymentPhase {
  const status = String(view.status ?? '').trim().toUpperCase();
  const reservation = String(view.reservationState ?? '').trim().toUpperCase();

  if (status === 'PAID') return 'paid';
  if (status === 'PROCESSING') return 'processing';
  if (status === 'FAILED') return 'failed';
  if (status === 'CANCELLED') {
    return reservation === 'EXPIRED' || String(view.reservationReleasedReason ?? '').includes('expired')
      ? 'expired'
      : 'cancelled';
  }
  if (reservation === 'EXPIRED' || reservation === 'RELEASED') return 'expired';
  if (reservation === 'ACTIVE') {
    return secondsRemaining(view.reservationExpiresAt, now) > 0 ? 'active' : 'pending';
  }
  return 'pending';
}

export interface ReleaseDecision {
  release: boolean;
  /** The order status stays FAILED/PROCESSING; only the claim is returned. */
  changeStatus: boolean;
  /** EXPIRED is used when the window closed, RELEASED for a failure. */
  nextState: 'EXPIRED' | 'RELEASED';
  reason: string;
}

/**
 * Decide whether a due reservation may be released without talking to the
 * payment gateway. Used for the failure-grace path; the worker still verifies
 * CREATED/PENDING/PROCESSING rows before this.
 */
export function failureReleaseDecision(
  view: ReservationView,
  now: Date,
  policy: ReservationPolicy,
): ReleaseDecision | null {
  const status = String(view.status ?? '').trim().toUpperCase();
  const reservation = String(view.reservationState ?? '').trim().toUpperCase();
  if (reservation !== 'ACTIVE') return null;
  if (status !== 'FAILED' && status !== 'CANCELLED') return null;
  const expires = asDate(view.reservationExpiresAt);
  if (!expires || expires.getTime() > now.getTime()) return null;
  return {
    release: true,
    changeStatus: false,
    nextState: 'RELEASED',
    reason: status === 'FAILED'
      ? 'payment failed; the grace window has ended'
      : 'payment cancelled; the grace window has ended',
  };
}

/** Is an unresolved payment past the safe recovery window? */
export function unresolvedWindowClosed(
  processingDeadline: Date | string | null | undefined,
  now: Date,
): boolean {
  const deadline = asDate(processingDeadline);
  return Boolean(deadline && deadline.getTime() <= now.getTime());
}

/**
 * The bounded retry counter for gateway failures. A successful verification
 * attempt resets it; repeated network/HTTP errors raise it so the worker can
 * flag the order instead of polling forever.
 */
export function recordReconcileAttempt(
  previousFailures: unknown,
  outcome: PaymentOutcome,
): { failures: number; reset: boolean } {
  const previous = Number.isFinite(Number(previousFailures))
    ? Math.max(0, Math.trunc(Number(previousFailures)))
    : 0;
  const transient = outcome === 'unknown';
  const failures = transient ? previous + 1 : 0;
  return { failures, reset: !transient };
}

/** How many consecutive gateway failures before an order is flagged. */
export const MAX_CONSECUTIVE_RECONCILE_FAILURES = 5;

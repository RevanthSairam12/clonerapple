/**
 * Pure waiting-list rules.
 *
 * The database decides atomicity; these functions decide eligibility so the
 * customer panel, the API and the allocation worker cannot disagree. No
 * database, no clock of its own: every function takes `now`.
 */

export type WaitingListStatus = 'ACTIVE' | 'INVITED' | 'PURCHASED' | 'EXPIRED' | 'CANCELLED';

export const WAITING_LIST_STATUSES: readonly WaitingListStatus[] = [
  'ACTIVE',
  'INVITED',
  'PURCHASED',
  'EXPIRED',
  'CANCELLED',
];

export function isWaitingListStatus(value: unknown): value is WaitingListStatus {
  return typeof value === 'string'
    && (WAITING_LIST_STATUSES as readonly string[]).includes(value);
}

/** A status the customer can still do something about. */
export function isOpenStatus(status: string | null | undefined): boolean {
  return status === 'ACTIVE' || status === 'INVITED';
}

export function waitingListStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'ACTIVE':
      return 'On the waiting list';
    case 'INVITED':
      return 'A unit is being held for you';
    case 'PURCHASED':
      return 'Purchased';
    case 'EXPIRED':
      return 'Invitation expired';
    case 'CANCELLED':
      return 'Left the waiting list';
    default:
      return 'Not on the waiting list';
  }
}

export interface JoinEligibilityInput {
  productActive: boolean;
  trackInventory: boolean;
  inStock: boolean;
  onHand: number;
  reserved: number;
  enabled: boolean;
}

export type JoinEligibility =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'unavailable' | 'in-stock' };

/**
 * Only a product that cannot currently be bought accepts a waiting-list entry.
 * An untracked product uses its `in_stock` flag; a tracked one is joinable when
 * every unit on hand is reserved.
 */
export function canJoinWaitingList(input: JoinEligibilityInput): JoinEligibility {
  if (!input.enabled) return { ok: false, reason: 'disabled' };
  if (!input.productActive) return { ok: false, reason: 'unavailable' };
  if (!input.trackInventory) {
    return input.inStock ? { ok: false, reason: 'in-stock' } : { ok: true };
  }
  const available = Math.max(0, Math.trunc(input.onHand) - Math.trunc(input.reserved));
  return available > 0 ? { ok: false, reason: 'in-stock' } : { ok: true };
}

export interface WaitingListCandidate {
  id: string;
  userId: string;
  createdAt: Date | string;
  /** Last time this customer bought the same product through an invitation. */
  lastPurchaseAt?: Date | string | null;
  userBlocked?: boolean;
}

function time(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isNaN(millis) ? null : millis;
}

/**
 * A blocked account is skipped forever; a customer who recently purchased the
 * same product through an invitation waits out the cooldown so one person
 * cannot cycle through every unit. A malformed timestamp is treated as absent.
 */
export function isCandidateEligible(
  candidate: WaitingListCandidate,
  now: Date,
  retryMinutes: number,
): boolean {
  if (candidate.userBlocked) return false;
  const last = time(candidate.lastPurchaseAt);
  if (last === null) return true;
  const cooldownMs = Math.max(0, Math.trunc(retryMinutes)) * 60_000;
  return last + cooldownMs <= now.getTime();
}

/**
 * Deterministic FIFO: creation time, then id. Stable for equal timestamps and
 * independent of any mutable position column.
 */
export function nextEligibleCandidate(
  candidates: readonly WaitingListCandidate[],
  now: Date,
  retryMinutes: number,
): WaitingListCandidate | null {
  const eligible = candidates
    .filter((candidate) => isCandidateEligible(candidate, now, retryMinutes))
    .sort((a, b) => {
      const aTime = time(a.createdAt) ?? 0;
      const bTime = time(b.createdAt) ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });
  return eligible[0] ?? null;
}

/** A 32-byte random token, lower-case hex. */
export function isInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** How long the claim page has left, in whole seconds. */
export function invitationSecondsRemaining(
  expiresAt: Date | string | null | undefined,
  now: Date,
): number {
  const millis = time(expiresAt);
  if (millis === null) return 0;
  return Math.max(0, Math.ceil((millis - now.getTime()) / 1000));
}

export function invitationIsOpen(
  status: string | null | undefined,
  expiresAt: Date | string | null | undefined,
  now: Date,
): boolean {
  return status === 'HELD' && invitationSecondsRemaining(expiresAt, now) > 0;
}

/**
 * A reservation token that no longer holds stock must never be presented as a
 * working checkout. The claim page uses this to explain precisely what
 * happened instead of letting the customer start a doomed payment.
 */
export function invitationMessage(
  status: string | null | undefined,
  expiresAt: Date | string | null | undefined,
  now: Date,
): string {
  if (status === 'HELD') {
    return invitationSecondsRemaining(expiresAt, now) > 0
      ? ''
      : 'This reservation has expired and the unit has been offered to the next customer.';
  }
  if (status === 'CLAIMED') return 'This invitation has already been used.';
  if (status === 'EXPIRED') {
    return 'This reservation has expired and the unit has been offered to the next customer.';
  }
  if (status === 'CANCELLED') return 'This invitation is no longer available.';
  return 'This invitation link is not valid.';
}

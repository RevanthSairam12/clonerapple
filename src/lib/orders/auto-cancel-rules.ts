/**
 * Pure rules for expiring unpaid online orders.
 *
 * `auto_cancel_unpaid_hours` comes from Store Admin → Orders. Zero keeps the
 * old behaviour: an abandoned checkout that PayU never saw is expired after
 * two hours. A configured value replaces that cutoff. Reconciliation re-checks
 * PayU first, so a captured payment can never be expired here.
 */

/** Fallback cutoff when the setting is 0/empty. */
export const DEFAULT_ABANDONED_HOURS = 2;

const MAX_HOURS = 24 * 365;

export function parseAutoCancelHours(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAX_HOURS, Math.max(0, Math.trunc(parsed)));
}

/** Cutoff actually used, in hours. Never 0. */
export function autoCancelCutoffHours(configuredHours: number): number {
  const parsed = parseAutoCancelHours(configuredHours);
  return parsed > 0 ? parsed : DEFAULT_ABANDONED_HOURS;
}

export function isAutoCancelDue(
  createdAt: Date | string,
  now: Date,
  configuredHours: number,
): boolean {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return false;
  const ageHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  return ageHours >= autoCancelCutoffHours(configuredHours);
}

export function autoCancelReason(configuredHours: number): string {
  const hours = parseAutoCancelHours(configuredHours);
  return hours > 0
    ? `Unpaid order cancelled after ${hours} hour${hours === 1 ? '' : 's'}`
    : `Abandoned checkout expired after ${DEFAULT_ABANDONED_HOURS} hours`;
}

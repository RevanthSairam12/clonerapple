/**
 * Shared client-safe Spin and Win countdown and date formatting helpers.
 */

export function computeRemainingMs(targetIso: string | null | undefined, nowMs: number): number {
  if (!targetIso) return 0;
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return 0;
  return Math.max(0, targetMs - nowMs);
}

export function formatCountdownHms(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function formatSpinCouponExpiry(
  isoString: string | null | undefined,
  timeZone = 'Asia/Kolkata',
): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}


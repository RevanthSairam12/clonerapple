import type { NotificationEvent } from './types';

/**
 * Which stock alert, if any, a manual adjustment should raise.
 *
 * Only a crossing counts: coming back above zero is "back in stock", dropping
 * from above the threshold to a low but non-zero count is "low stock". Staying
 * low, staying in stock or going from out-of-stock to low is silent, so a
 * flurry of adjustments cannot spam the staff audience.
 */
export function stockNotificationEvent(input: {
  availableBefore: number;
  availableAfter: number;
  threshold: number;
}): NotificationEvent | null {
  const before = Math.trunc(Number(input.availableBefore) || 0);
  const after = Math.trunc(Number(input.availableAfter) || 0);
  const threshold = Math.max(0, Math.trunc(Number(input.threshold) || 0));

  if (before <= 0 && after > 0) return 'back_in_stock';
  if (before > threshold && after > 0 && after <= threshold) return 'low_stock';
  return null;
}

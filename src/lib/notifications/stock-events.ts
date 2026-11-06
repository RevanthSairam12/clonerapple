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

/**
 * The name a stock alert shows: the product on its own for a product-level
 * row, or "Product — Colour: Black" for one option.
 *
 * One option crossing its threshold must not read as the whole product going
 * low, so the option's own label is part of the name staff see. The label is
 * trimmed and the whole string capped, because it reaches a template.
 */
export function stockAlertProductName(productName: string, optionLabel?: string | null): string {
  const name = String(productName ?? '').trim().slice(0, 200);
  const label = String(optionLabel ?? '').trim().slice(0, 120);
  if (!label) return name;
  if (!name) return label;
  return `${name} — ${label}`.slice(0, 300);
}

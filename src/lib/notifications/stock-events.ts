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

export interface SaleMovementStockSnapshot {
  movementId: number;
  productId: string;
  variantId?: string | null;
  productName: string;
  optionLabel?: string | null;
  availableBefore: number;
  availableAfter: number;
  lowStockThreshold: number;
  trackInventory: boolean;
}

export interface PlannedLowStockAlert {
  event: 'low_stock';
  productId: string;
  variantId: string | null;
  productName: string;
  stockAvailable: number;
  staffLink: string;
  token: string;
}

/**
 * Pure planner deciding which sale movements from a committed checkout or POS
 * order crossed their option's (or product's) low-stock threshold.
 *
 * Dedupe is per crossing: only the movement that moves available stock from
 * `> threshold` into `1..threshold` emits an alert, and its token is keyed by
 * the movement id (`movement:<id>`) so retries never duplicate the alert.
 */
export function planOrderLowStockAlerts(
  movements: readonly SaleMovementStockSnapshot[],
): PlannedLowStockAlert[] {
  const alerts: PlannedLowStockAlert[] = [];
  const seenKeys = new Set<string>();

  for (const row of movements) {
    if (!row.trackInventory) continue;
    const productId = String(row.productId ?? '').trim();
    if (!productId) continue;
    const variantId = row.variantId ? String(row.variantId).trim() : null;
    const event = stockNotificationEvent({
      availableBefore: row.availableBefore,
      availableAfter: row.availableAfter,
      threshold: row.lowStockThreshold,
    });
    if (event !== 'low_stock') continue;

    const identityKey = `${productId}::${variantId ?? ''}`;
    if (seenKeys.has(identityKey)) continue;
    seenKeys.add(identityKey);

    alerts.push({
      event: 'low_stock',
      productId,
      variantId,
      productName: stockAlertProductName(row.productName, variantId ? row.optionLabel : null),
      stockAvailable: Math.max(0, Math.trunc(Number(row.availableAfter) || 0)),
      staffLink: variantId
        ? `/store-admin/stock/${encodeURIComponent(productId)}?variant=${encodeURIComponent(variantId)}`
        : `/store-admin/stock/${encodeURIComponent(productId)}`,
      token: `movement:${Math.trunc(Number(row.movementId) || 0)}`,
    });
  }

  return alerts;
}

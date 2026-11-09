import type postgres from 'postgres';
import { enqueueNotification } from './enqueue';
import { queueNotification } from './queue';
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

export interface StockAlertItem {
  productId: string;
  variantId?: string | null;
  productName: string;
  variantLabel?: string | null;
  availableBefore: number;
  availableAfter: number;
  lowStockThreshold: number;
  movementId: string | number;
}

/**
 * Queue staff stock notifications for committed stock movements that cross a threshold.
 *
 * Idempotent: keyed by the exact movement id so retries never duplicate alerts.
 * Runs post-commit outside SQL transactions.
 */
export async function queueStockAlerts(
  alerts: readonly StockAlertItem[],
  options: { sqlOverride?: postgres.Sql } = {},
): Promise<void> {
  for (const alert of alerts) {
    const event = stockNotificationEvent({
      availableBefore: alert.availableBefore,
      availableAfter: alert.availableAfter,
      threshold: alert.lowStockThreshold,
    });
    if (!event) continue;
    const context = {
      productName: stockAlertProductName(alert.productName, alert.variantLabel),
      stockAvailable: alert.availableAfter,
      staffLink: alert.variantId
        ? `/store-admin/stock/${encodeURIComponent(alert.productId)}?variant=${encodeURIComponent(alert.variantId)}`
        : `/store-admin/stock/${encodeURIComponent(alert.productId)}`,
      token: `movement:${alert.movementId}`,
    };
    if (options.sqlOverride) {
      await enqueueNotification(event, { type: 'product', id: alert.productId }, context, options.sqlOverride);
    } else {
      queueNotification(event, { type: 'product', id: alert.productId }, context);
    }
  }
}

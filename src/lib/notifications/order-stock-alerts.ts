import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { enqueueNotification } from './enqueue';
import { queueNotification } from './queue';
import {
  planOrderLowStockAlerts,
  type PlannedLowStockAlert,
  type SaleMovementStockSnapshot,
} from './stock-events';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Order low-stock alert helpers must run on the server only.');
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function deriveOptionLabel(row: Record<string, unknown>): string | null {
  const modelName = text(row.variant_device_model_name);
  const colourName = text(row.variant_colour_name) || text(row.option_value);
  if (modelName && colourName) return `${modelName} · ${colourName}`;
  if (modelName) return modelName;
  if (colourName) return colourName;

  const variantLabel = text(row.variant_label);
  if (variantLabel) return variantLabel;

  const optName = text(row.option_name);
  const optVal = text(row.option_value);
  if (optName && optVal) return `${optName}: ${optVal}`;
  if (optVal) return optVal;
  return null;
}

/**
 * Evaluate and enqueue per-option (and product-level) low-stock staff
 * notifications after a checkout (`createOrderUsing`) or POS sale
 * (`createPosSaleUsing`) transaction has committed.
 *
 * Uses the append-only `stock_movements` ledger to reconstruct exact
 * `availableBefore` and `availableAfter` at each movement `m.id`, so concurrent
 * sales never double-alert or miss a threshold crossing. Each crossing is
 * deduplicated by `token: "movement:<id>"`.
 */
export async function enqueueOrderLowStockAlerts(
  orderId: string,
  options: {
    sql?: postgres.Sql;
  } = {},
): Promise<PlannedLowStockAlert[]> {
  const cleanOrderId = text(orderId);
  if (!cleanOrderId) return [];

  const sql = options.sql ?? getSql();
  if (!sql) return [];

  const isAppPool = Boolean(
    !options.sql
      || (globalThis as typeof globalThis & { __gadzioSql?: unknown }).__gadzioSql === sql,
  );

  try {
    const [reg] = await sql<Array<{ has_variants: string | null }>>`
      select to_regclass('product_variants')::text as has_variants
    `;
    const hasVariantsTable = Boolean(reg?.has_variants);

    const rows = hasVariantsTable
      ? await sql<Array<Record<string, unknown>>>`
          select
            m.id as movement_id,
            m.product_id,
            m.variant_id,
            -m.delta as quantity_sold,
            s.on_hand,
            s.reserved,
            s.low_stock_threshold,
            s.track_inventory,
            coalesce(nullif(oi.product_name, ''), p.name, m.product_id) as product_name,
            oi.variant_label,
            oi.variant_device_model_name,
            oi.variant_colour_name,
            v.option_name,
            v.option_value,
            coalesce((
              select sum(m2.delta)::int
              from stock_movements m2
              where m2.product_id = m.product_id
                and m2.variant_id is not distinct from m.variant_id
                and m2.id > m.id
            ), 0) as later_delta
          from stock_movements m
          join stock s
            on s.product_id = m.product_id
           and s.variant_id is not distinct from m.variant_id
          left join products p on p.id = m.product_id
          left join product_variants v on v.id = m.variant_id and v.product_id = m.product_id
          left join lateral (
            select
              oi_inner.product_name,
              to_jsonb(oi_inner)->>'variant_label' as variant_label,
              to_jsonb(oi_inner)->>'variant_device_model_name' as variant_device_model_name,
              to_jsonb(oi_inner)->>'variant_colour_name' as variant_colour_name
            from order_items oi_inner
            where oi_inner.order_id = m.order_id
              and oi_inner.product_id = m.product_id
              and oi_inner.variant_id is not distinct from m.variant_id
            order by oi_inner.line_number asc
            limit 1
          ) oi on true
          where m.order_id = ${cleanOrderId}
            and m.reason = 'sale'
            and m.delta < 0
          order by m.id asc
        `
      : await sql<Array<Record<string, unknown>>>`
          select
            m.id as movement_id,
            m.product_id,
            m.variant_id,
            -m.delta as quantity_sold,
            s.on_hand,
            s.reserved,
            s.low_stock_threshold,
            s.track_inventory,
            coalesce(nullif(oi.product_name, ''), p.name, m.product_id) as product_name,
            oi.variant_label,
            oi.variant_device_model_name,
            oi.variant_colour_name,
            coalesce((
              select sum(m2.delta)::int
              from stock_movements m2
              where m2.product_id = m.product_id
                and m2.variant_id is not distinct from m.variant_id
                and m2.id > m.id
            ), 0) as later_delta
          from stock_movements m
          join stock s
            on s.product_id = m.product_id
           and s.variant_id is not distinct from m.variant_id
          left join products p on p.id = m.product_id
          left join lateral (
            select
              oi_inner.product_name,
              to_jsonb(oi_inner)->>'variant_label' as variant_label,
              to_jsonb(oi_inner)->>'variant_device_model_name' as variant_device_model_name,
              to_jsonb(oi_inner)->>'variant_colour_name' as variant_colour_name
            from order_items oi_inner
            where oi_inner.order_id = m.order_id
              and oi_inner.product_id = m.product_id
              and oi_inner.variant_id is not distinct from m.variant_id
            order by oi_inner.line_number asc
            limit 1
          ) oi on true
          where m.order_id = ${cleanOrderId}
            and m.reason = 'sale'
            and m.delta < 0
          order by m.id asc
        `;

    const snapshots: SaleMovementStockSnapshot[] = rows.map((row) => {
      const currentAvailable =
        Math.trunc(Number(row.on_hand) || 0) - Math.trunc(Number(row.reserved) || 0);
      const laterDelta = Math.trunc(Number(row.later_delta) || 0);
      const quantitySold = Math.max(0, Math.trunc(Number(row.quantity_sold) || 0));
      const availableAfter = currentAvailable - laterDelta;
      const availableBefore = availableAfter + quantitySold;

      return {
        movementId: Math.trunc(Number(row.movement_id) || 0),
        productId: text(row.product_id),
        variantId: text(row.variant_id) || null,
        productName: text(row.product_name),
        optionLabel: deriveOptionLabel(row),
        availableBefore,
        availableAfter,
        lowStockThreshold: Math.max(0, Math.trunc(Number(row.low_stock_threshold) || 0)),
        trackInventory: Boolean(row.track_inventory),
      };
    });

    const alerts = planOrderLowStockAlerts(snapshots);
    for (const alert of alerts) {
      await enqueueNotification(
        'low_stock',
        { type: 'product', id: alert.productId },
        {
          productName: alert.productName,
          stockAvailable: alert.stockAvailable,
          staffLink: alert.staffLink,
          token: alert.token,
        },
        sql,
      );
      if (isAppPool && !options.sql) {
        queueNotification(
          'low_stock',
          { type: 'product', id: alert.productId },
          {
            productName: alert.productName,
            stockAvailable: alert.stockAvailable,
            staffLink: alert.staffLink,
            token: alert.token,
          },
        );
      }
    }

    return alerts;
  } catch {
    return [];
  }
}

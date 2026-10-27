import type postgres from 'postgres';

import { stockStateFrom } from './catalog-rules';
import type { AvailabilityRead, ProductAvailability } from './availability-rules';
import { readSaleStateUsing } from './sale-state';

/**
 * The click-time availability read. One query for every requested product,
 * joined to the product-level stock row, plus the sale switch on the same
 * connection (so both decisions come from the same database clock).
 *
 * Online holds decrement `on_hand`, so the count already excludes units other
 * customers are holding. The legacy `reserved` counter is subtracted too.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Availability is read on the server only.');
}

type Row = Record<string, unknown>;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readAvailabilityUsing(
  sql: postgres.Sql | postgres.TransactionSql,
  ids: readonly string[],
): Promise<AvailabilityRead> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const state = await readSaleStateUsing(sql);

  if (wanted.length === 0) {
    return { saleLive: state.live, databaseNow: state.databaseNow, products: [] };
  }

  const rows = (await sql`
    select p.id, p.is_active, p.deleted_at, p.in_stock,
           s.on_hand, s.reserved, s.low_stock_threshold, s.track_inventory
    from products p
    left join stock s on s.product_id = p.id and s.variant_id is null
    where p.id = any(${wanted}::text[])
  `) as Row[];

  const byId = new Map<string, Row>();
  for (const row of rows) byId.set(String(row.id), row);

  const products: ProductAvailability[] = wanted.map((id) => {
    const row = byId.get(id);
    // A missing, inactive or deleted row cannot be sold. It is reported as
    // unavailable rather than thrown away, so the caller can name it.
    if (!row || row.deleted_at !== null || row.is_active === false) {
      return { id, inStock: false, tracked: false, available: null, lowStockThreshold: null };
    }

    const hasStockRow = row.track_inventory !== null && row.track_inventory !== undefined;
    const snapshot = stockStateFrom(
      hasStockRow
        ? {
            on_hand: numberOrNull(row.on_hand) ?? 0,
            reserved: numberOrNull(row.reserved) ?? 0,
            track_inventory: Boolean(row.track_inventory),
            low_stock_threshold: numberOrNull(row.low_stock_threshold) ?? 0,
          }
        : null,
      Boolean(row.in_stock),
    );

    return {
      id,
      inStock: snapshot.state !== 'out_of_stock',
      tracked: snapshot.tracked,
      available: snapshot.available,
      lowStockThreshold: snapshot.threshold,
    };
  });

  return { saleLive: state.live, databaseNow: state.databaseNow, products };
}

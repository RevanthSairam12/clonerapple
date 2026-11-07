import type postgres from 'postgres';
import { stockStateFrom } from './catalog-rules';
import { aggregateVariantAvailability, availabilityKey, supportsQuantity, type AvailabilityLine, type AvailabilityRead, type ProductAvailability } from './availability-rules';
import { readSaleState, readSaleStateUsing } from './sale-state';

if (typeof window !== 'undefined') throw new Error('Availability is read on the server only.');
type Row = Record<string, unknown>;

function unavailable(id: string, variantId?: string): ProductAvailability {
  return { id, ...(variantId ? { variantId } : {}), inStock: false, tracked: false, available: null, lowStockThreshold: null };
}

function fromStock(id: string, row: Row, fallback: boolean, variantId?: string): ProductAvailability {
  const hasStock = row.track_inventory !== null && row.track_inventory !== undefined;
  // Activated commerce identities require an explicit row, including untracked variants.
  if (variantId && !hasStock) return unavailable(id, variantId);
  const snapshot = stockStateFrom(hasStock ? row : null, fallback);
  return { id, ...(variantId ? { variantId } : {}), inStock: snapshot.state !== 'out_of_stock',
    tracked: snapshot.tracked, available: snapshot.tracked ? snapshot.available : null, lowStockThreshold: snapshot.threshold };
}

const inflightStockByWanted = new Map<
  string,
  Promise<{ rows: Row[]; variantRows: Row[] }>
>();

async function loadAvailabilityRows(
  sql: postgres.Sql | postgres.TransactionSql,
  wanted: string[],
  isAppPool: boolean,
): Promise<{ rows: Row[]; variantRows: Row[] }> {
  const key = isAppPool ? [...wanted].sort().join('\0') : '';
  if (isAppPool) {
    const existing = inflightStockByWanted.get(key);
    if (existing) return existing;
  }

  const promise = (async () => {
    const rows = (await sql`
      select p.id, p.is_active, p.deleted_at, p.in_stock, p.inventory_mode,
             s.on_hand, s.reserved, s.low_stock_threshold, s.track_inventory
      from products p left join stock s on s.product_id = p.id and s.variant_id is null
      where p.id = any(${wanted}::text[])
    `) as Row[];
    const hasVariantProducts = rows.some((row) => row.inventory_mode === 'variant');
    const variantRows = hasVariantProducts
      ? ((await sql`
          select v.id as variant_id, v.product_id, v.sku, v.combination_key,
                 s.on_hand, s.reserved, s.low_stock_threshold, s.track_inventory
          from product_variants v
          join products p on p.id = v.product_id and p.inventory_mode = 'variant'
          left join product_types pt on pt.id = p.product_type_id
          left join stock s on s.product_id = v.product_id and s.variant_id = v.id
          where v.product_id = any(${wanted}::text[]) and v.is_active and v.is_purchasable and v.retired_at is null
            and nullif(trim(v.sku), '') is not null and nullif(trim(v.combination_key), '') is not null
            and (not coalesce(pt.requires_compatibility, false) or v.device_model_id is not null)
            and (v.device_model_id is null or exists (
              select 1 from product_device_models j join device_models d on d.id = j.device_model_id
              join device_brands b on b.id = d.brand_id
              where j.product_id = v.product_id and j.device_model_id = v.device_model_id and j.archived_at is null))
        `) as Row[])
      : [];
    return { rows, variantRows };
  })().finally(() => {
    if (isAppPool) {
      inflightStockByWanted.delete(key);
    }
  });

  if (isAppPool) {
    inflightStockByWanted.set(key, promise);
  }
  return promise;
}

/** Advisory only; the final guarded claim remains authoritative. Never reads sibling parent balances as variant stock. */
export async function readAvailabilityUsing(
  sql: postgres.Sql | postgres.TransactionSql,
  ids: readonly string[],
  lines: readonly AvailabilityLine[] = [],
): Promise<AvailabilityRead> {
  const wanted = [...new Set([...ids, ...lines.map((line) => line.productId)].map((id) => id.trim()).filter(Boolean))];
  const isAppPool = Boolean(
    sql && (globalThis as typeof globalThis & { __gadzioSql?: unknown }).__gadzioSql === sql,
  );
  const readState = () =>
    isAppPool && typeof readSaleState === 'function' ? readSaleState() : readSaleStateUsing(sql);
  if (!wanted.length) {
    const state = await readState();
    return { saleLive: state.live, databaseNow: state.databaseNow, products: [], variants: [] };
  }
  const [state, { rows, variantRows }] = await Promise.all([
    readState(),
    loadAvailabilityRows(sql, wanted, isAppPool),
  ]);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const eligible = (id: string) => { const row = byId.get(id); return Boolean(row && row.deleted_at === null && row.is_active !== false); };
  const variants = variantRows.map((row) => eligible(String(row.product_id))
    ? fromStock(String(row.product_id), row, true, String(row.variant_id))
    : unavailable(String(row.product_id), String(row.variant_id)));
  const products = wanted.map((id) => {
    const row = byId.get(id);
    if (!row || !eligible(id)) return unavailable(id);
    return row.inventory_mode === 'variant'
      ? aggregateVariantAvailability(id, variants.filter((variant) => variant.id === id))
      : fromStock(id, row, Boolean(row.in_stock));
  });
  // Multiple legacy display lines sharing one stock key must be checked together.
  const requested = new Map<string, number>();
  for (const line of lines) {
    const key = availabilityKey(line.productId, line.variantId);
    requested.set(key, (requested.get(key) ?? 0) + line.quantity);
  }
  for (const line of lines) {
    const row = byId.get(line.productId);
    const selected = line.variantId
      ? variants.find((variant) => variant.id === line.productId && variant.variantId === line.variantId)
      : products.find((product) => product.id === line.productId);
    const validScope = row?.inventory_mode === 'variant' ? Boolean(line.variantId) : !line.variantId;
    const quantityAvailable = Boolean(validScope && selected && supportsQuantity(selected, requested.get(availabilityKey(line.productId, line.variantId)) ?? 0));
    if (selected) selected.quantityAvailable = quantityAvailable;
    else if (line.variantId) variants.push({ ...unavailable(line.productId, line.variantId), quantityAvailable: false });
  }
  return { saleLive: state.live, databaseNow: state.databaseNow, products, variants };
}

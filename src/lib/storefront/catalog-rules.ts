/**
 * Pure storefront catalogue rules. No database, no React, no Next.js cache —
 * these are the decisions the read layer makes, kept importable by tests.
 */

export type CatalogStockState = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface StockRowLike {
  on_hand?: unknown;
  reserved?: unknown;
  low_stock_threshold?: unknown;
  track_inventory?: unknown;
}

export interface StockSnapshot {
  state: CatalogStockState;
  /** `on_hand - reserved`; null only when there is no stock row. */
  available: number | null;
  threshold: number | null;
  tracked: boolean;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Availability for one product.
 *
 * `products.in_stock` is the denormalised gate the back office maintains.
 * Untracked products use it directly. Tracked products are out when the
 * available count is zero, low at or below `low_stock_threshold`, and in
 * stock otherwise. A tracked row whose `in_stock` gate is false is still out:
 * the two writes that set it derive it from the same count.
 */
export function stockStateFrom(
  row: StockRowLike | null | undefined,
  inStock: boolean,
): StockSnapshot {
  if (!row) {
    return {
      state: inStock ? 'in_stock' : 'out_of_stock',
      available: null,
      threshold: null,
      tracked: false,
    };
  }

  const tracked = Boolean(row.track_inventory);
  const available = Math.max(0, toNumber(row.on_hand) - toNumber(row.reserved));
  const threshold = Math.max(0, toNumber(row.low_stock_threshold));

  if (!tracked) {
    return {
      state: inStock ? 'in_stock' : 'out_of_stock',
      available,
      threshold,
      tracked: false,
    };
  }

  const state: CatalogStockState =
    available <= 0 || !inStock
      ? 'out_of_stock'
      : available <= threshold
        ? 'low_stock'
        : 'in_stock';

  return { state, available, threshold, tracked: true };
}

export type CatalogSource = 'db' | 'static' | 'missing';

/**
 * The fallback rule, in one place.
 *
 * - Database unreachable → the static bundle (never an empty page).
 * - Database reachable but the row is absent/inactive/deleted → missing. This
 *   is the 404 path; a stale static product must not come back to life.
 */
export function chooseCatalogSource<T>(
  databaseReady: boolean,
  fromDatabase: T | null,
  fromStatic: T | null,
): { source: CatalogSource; value: T | null } {
  if (databaseReady) {
    return fromDatabase
      ? { source: 'db', value: fromDatabase }
      : { source: 'missing', value: null };
  }
  return fromStatic
    ? { source: 'static', value: fromStatic }
    : { source: 'missing', value: null };
}

export interface LabelledValue {
  label: string;
  value: string;
}

/** Case/punctuation-insensitive key for spec labels ("Magnetic Hold" == "magneticHold"). */
export function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Static spec rows keep their order and label casing; a database row with the
 * same normalised label replaces the value. Database-only rows are appended.
 * Blank database values never erase a static value.
 */
export function mergeSpecRows(
  staticRows: LabelledValue[],
  databaseRows: LabelledValue[],
): LabelledValue[] {
  if (databaseRows.length === 0) return [...staticRows];

  const databaseByKey = new Map<string, LabelledValue>();
  for (const row of databaseRows) {
    const label = String(row.label ?? '').trim();
    const value = String(row.value ?? '').trim();
    const key = normaliseKey(label);
    if (!key || !value) continue;
    databaseByKey.set(key, { label, value });
  }

  const merged: LabelledValue[] = [];
  const used = new Set<string>();
  for (const row of staticRows) {
    const key = normaliseKey(row.label);
    const databaseRow = databaseByKey.get(key);
    if (databaseRow) {
      merged.push({ label: row.label, value: databaseRow.value });
      used.add(key);
    } else {
      merged.push({ ...row });
    }
  }
  for (const [key, row] of databaseByKey) {
    if (!used.has(key)) merged.push(row);
  }
  return merged;
}

/**
 * Facet values are display strings. A non-empty database value wins; static
 * keys the database does not carry are kept; blank database values are ignored.
 */
export function mergeFacets(
  staticFacets: Record<string, string> | null | undefined,
  databaseFacets: Record<string, string> | null | undefined,
): Record<string, string> {
  const merged: Record<string, string> = { ...(staticFacets ?? {}) };
  for (const [key, value] of Object.entries(databaseFacets ?? {})) {
    const cleaned = String(value ?? '').trim();
    if (cleaned) merged[key] = cleaned;
  }
  return merged;
}

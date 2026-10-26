/**
 * Pure rules for storefront product collections.
 *
 * A collection is a named, ordered list of product ids stored in
 * `product_collections`. The storefront reads it server-side; an empty or
 * unreachable collection falls back to the coded/CMS list supplied by the
 * caller, so a homepage rail never renders empty.
 *
 * No database or React imports so tests can exercise the ordering and
 * fallback rules directly.
 */

/** Cache tag invalidated by every store-admin collection write. */
export const COLLECTION_CACHE_TAG = 'storefront-collections';

export const COLLECTION_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface CollectionRow {
  collection_key?: string;
  product_id: string;
  position: number;
  is_active: boolean;
}

/** Normalise a collection key; returns '' when it is not valid. */
export function normaliseCollectionKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidCollectionKey(value: unknown): boolean {
  return COLLECTION_KEY_RE.test(normaliseCollectionKey(value));
}

/**
 * Keep active rows, order by position then product id, and de-duplicate.
 * The product-id tie-break makes the order deterministic even when an editor
 * has left two rows at the same position.
 */
export function orderCollectionRows(rows: CollectionRow[]): string[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => row.is_active && typeof row.product_id === 'string')
    .slice()
    .sort((a, b) => {
      const byPosition = Number(a.position) - Number(b.position);
      if (byPosition !== 0) return byPosition;
      return a.product_id.localeCompare(b.product_id);
    })
    .flatMap((row) => {
      if (seen.has(row.product_id)) return [];
      seen.add(row.product_id);
      return [row.product_id];
    });
}

/**
 * Database membership wins whole. The fallback is used only when the database
 * collection is empty — never merged, so removing a product in the store admin
 * cannot be undone by an old CMS list.
 */
export function chooseCollectionMembership(
  databaseIds: string[],
  fallbackIds: string[],
): string[] {
  if (databaseIds.length > 0) return [...databaseIds];
  return [...fallbackIds];
}

/** De-duplicate and trim a caller-supplied fallback list. */
export function cleanFallbackIds(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const value = typeof id === 'string' ? id.trim() : '';
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [value];
  });
}

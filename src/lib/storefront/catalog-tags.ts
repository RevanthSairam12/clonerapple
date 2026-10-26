/**
 * Cache tags for the storefront catalogue. Kept in a tiny pure module so route
 * handlers can invalidate without importing React or the read layer.
 */

export const CATALOG_CACHE_TAG = 'storefront-catalog';

/** One product's detail entry. Ids are case-insensitive, like every lookup. */
export function productCacheTag(id: string): string {
  return `storefront-product:${id.trim().toLowerCase()}`;
}

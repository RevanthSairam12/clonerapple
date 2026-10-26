/**
 * Immediate storefront catalogue invalidation for Store Admin writes.
 *
 * Call this after a successful catalogue mutation. `expire: 0` makes the next
 * storefront request block on a fresh read instead of serving the stale entry
 * once, which is what "shows on the next request" means here.
 */

import { revalidateTag } from 'next/cache';

import { CATALOG_CACHE_TAG, productCacheTag } from './catalog-tags';

export function revalidateCatalog(productIds?: string | string[] | null): void {
  revalidateTag(CATALOG_CACHE_TAG, { expire: 0 });

  const ids = Array.isArray(productIds)
    ? productIds
    : productIds
      ? [productIds]
      : [];
  for (const id of new Set(ids.map((value) => value.trim()).filter(Boolean))) {
    revalidateTag(productCacheTag(id), { expire: 0 });
  }
}

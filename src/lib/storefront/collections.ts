/**
 * Server-side read layer for storefront product collections.
 *
 * Components never query `product_collections` directly: they ask for a
 * collection key and a fallback list of product ids. The database membership
 * wins when it is non-empty; otherwise the fallback (the CMS/static list the
 * page already carries) is returned so a rail is never empty.
 *
 * Reads are cached per request with React `cache()` and across requests with
 * `unstable_cache`, tagged `COLLECTION_CACHE_TAG`. Every store-admin write
 * calls `revalidateTag(COLLECTION_CACHE_TAG, { expire: 0 })`, so an edit is
 * visible on the next request. The 30-second safety revalidation only exists
 * so a transient database outage cannot pin an empty list forever.
 */

import { cache } from 'react';
import { unstable_cache } from 'next/cache';

import { getSql } from '@/lib/platform/db';
import { getStorefrontProducts, type StorefrontProduct } from '@/lib/catalog/storefront';

import {
  COLLECTION_CACHE_TAG,
  chooseCollectionMembership,
  cleanFallbackIds,
  isValidCollectionKey,
  normaliseCollectionKey,
  orderCollectionRows,
  type CollectionRow,
} from './collections-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Storefront collections are read on the server only.');
}

const readCollectionIds = unstable_cache(
  async (collectionKey: string): Promise<string[]> => {
    const sql = getSql();
    if (!sql) return [];
    try {
      const rows = await sql`
        select collection_key, product_id, position, is_active
        from product_collections
        where collection_key = ${collectionKey} and is_active
        order by position asc, product_id asc
        limit 200
      `;
      return orderCollectionRows(rows as unknown as CollectionRow[]);
    } catch {
      console.warn('[storefront/collections] could not read a collection');
      return [];
    }
  },
  ['storefront-product-collection'],
  { tags: [COLLECTION_CACHE_TAG], revalidate: 30 },
);

/**
 * Ordered product ids for one collection. An invalid/unknown collection, an
 * empty collection, or an unreachable database returns the cleaned fallback.
 */
export const getCollectionProductIds = cache(
  async (key: string, fallbackIds: string[] = []): Promise<string[]> => {
    const fallback = cleanFallbackIds(fallbackIds);
    const collectionKey = normaliseCollectionKey(key);
    if (!isValidCollectionKey(collectionKey)) return fallback;

    const databaseIds = await readCollectionIds(collectionKey);
    return chooseCollectionMembership(databaseIds, fallback);
  },
);

/**
 * The resolved storefront products for a collection, in order. Products that
 * are archived or inactive are dropped by the catalogue read.
 */
export const getCollectionProducts = cache(
  async (key: string, fallbackIds: string[] = []): Promise<StorefrontProduct[]> => {
    const ids = await getCollectionProductIds(key, fallbackIds);
    return getStorefrontProducts(ids);
  },
);

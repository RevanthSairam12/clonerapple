/**
 * Storefront catalogue — the server read layer every customer surface uses.
 *
 * Store Admin owns `products`, `product_images`, `product_variants`,
 * `product_specs`, `product_facets` and `stock`. This module reads them once
 * per request (React `cache`), across requests (`unstable_cache`, 30s safety
 * net) and tags the entries so every successful Store Admin write can call
 * `revalidateCatalog()` and make the next request see the new value.
 *
 * Fallback rule: if the database is unreachable (or DATABASE_URL is unset),
 * every function returns the static bundle exactly as the storefront rendered
 * before this layer existed. If the database is reachable, a missing/inactive
 * product row is a 404 — a stale static product must not come back to life.
 *
 * Components never query the database; they receive props from a server page.
 */

import { cache } from 'react';
import { unstable_cache } from 'next/cache';

import { toCategoryConfig } from '@/lib/catalog/adapter';
import {
  readStorefrontCatalog,
  type StorefrontCatalogSnapshot,
  type StorefrontCategory,
  type StorefrontProduct,
  type StorefrontProductRef,
} from '@/lib/catalog/storefront';
import type { AccessoryProduct, CategoryConfig } from '@/components/sites/accessories/data/types';
import type { Product as CaseProduct } from '@/components/sites/cases-protection/data/products';
import type { CollectionProduct } from '@/components/collection/types';

import { CATALOG_CACHE_TAG, productCacheTag } from './catalog-tags';
import {
  accessoryProductFromDatabase,
  caseProductFromDatabase,
  collectionProductFromDatabase,
  mergeAccessoryProduct,
  mergeCaseProduct,
  refFromDatabase,
} from './catalog-merge';
import {
  STATIC_CASES_CONFIG,
  STATIC_PRODUCT_REFS,
  getStaticAccessoryCategory,
  getStaticAccessoryProduct,
  getStaticCaseCollectionProduct,
  getStaticCaseProduct,
  getStaticProduct,
  staticCaseCollectionProducts,
  type StaticAccessoryCategory,
} from './static-catalog';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Storefront catalogue reads happen on the server only.');
}

export type CatalogSourceKind = 'db' | 'static';

interface CatalogState {
  ready: boolean;
  snapshot: StorefrontCatalogSnapshot | null;
}

const readCachedCatalog = unstable_cache(
  async (): Promise<StorefrontCatalogSnapshot | null> => readStorefrontCatalog(),
  ['storefront-catalog'],
  { tags: [CATALOG_CACHE_TAG], revalidate: 30 },
);

/**
 * One catalogue read per request. Never throws: an unreachable database is
 * the fallback signal, not a page error.
 */
const getCatalogState = cache(async (): Promise<CatalogState> => {
  try {
    const snapshot = await readCachedCatalog();
    return { ready: snapshot !== null, snapshot };
  } catch {
    console.warn('[storefront/catalog] catalogue database unavailable; rendering static data');
    return { ready: false, snapshot: null };
  }
});

interface ProductState {
  ready: boolean;
  product: StorefrontProduct | null;
}

function readCachedProduct(id: string) {
  const normalised = id.trim().toLowerCase();
  return unstable_cache(
    async (): Promise<ProductState> => {
      const snapshot = await readStorefrontCatalog();
      if (!snapshot) return { ready: false, product: null };
      const product =
        snapshot.products.find((entry) => entry.id.toLowerCase() === normalised) ?? null;
      return { ready: true, product };
    },
    ['storefront-product', normalised],
    { tags: [CATALOG_CACHE_TAG, productCacheTag(id)], revalidate: 30 },
  );
}

/** One product read; `ready` distinguishes "not in the catalogue" from "no DB". */
const getProductState = cache(async (id: string): Promise<ProductState> => {
  if (!id.trim()) return { ready: false, product: null };
  try {
    return await readCachedProduct(id)();
  } catch {
    console.warn('[storefront/catalog] product database unavailable; rendering static data');
    return { ready: false, product: null };
  }
});

function findCategory(
  snapshot: StorefrontCatalogSnapshot,
  slugOrId: string,
): StorefrontCategory | null {
  const needle = slugOrId.trim().toLowerCase();
  if (!needle) return null;
  return (
    snapshot.categories.find(
      (category) =>
        category.slug.toLowerCase() === needle || category.id.toLowerCase() === needle,
    ) ?? null
  );
}

function accessoryProductsFromCategory(category: StorefrontCategory): AccessoryProduct[] {
  return category.products.map((product) => {
    const staticProduct = getStaticAccessoryProduct(product.id);
    return staticProduct
      ? mergeAccessoryProduct(staticProduct, product)
      : accessoryProductFromDatabase(product);
  });
}

function caseProductsFromCategory(category: StorefrontCategory): CollectionProduct[] {
  return category.products.map((product) => {
    const staticProduct = getStaticCaseCollectionProduct(product.id);
    return collectionProductFromDatabase(product, staticProduct ?? null);
  });
}

/* ------------------------------------------------------------ accessories */

export interface AccessoryCategoryView {
  config: CategoryConfig;
  products: AccessoryProduct[];
  source: CatalogSourceKind;
}

/**
 * A config-driven accessory category (`/in/shop/iphone/accessories/[slug]`).
 * The database supplies the page furniture too, because that is what this
 * route rendered before. A missing category row is a 404 once the database
 * answers; static data is used only when it cannot.
 */
export const getAccessoryCategoryView = cache(
  async (slug: string): Promise<AccessoryCategoryView | null> => {
    const state = await getCatalogState();
    if (!state.ready) {
      const staticCategory = getStaticAccessoryCategory(slug);
      return staticCategory
        ? { ...staticCategory, source: 'static' }
        : null;
    }

    const category = findCategory(state.snapshot!, slug);
    if (!category) return null;

    return {
      config: toCategoryConfig(category),
      products: accessoryProductsFromCategory(category),
      source: 'db',
    };
  },
);

export interface AccessoryProductsView {
  products: AccessoryProduct[];
  source: CatalogSourceKind;
}

/**
 * Products for one of the five explicit accessory routes. Those pages keep
 * their static `CONFIG` (page furniture is not moving in this phase); only the
 * product records are merged. If the category row or the database is missing,
 * the static records render exactly as before.
 */
export const getAccessoryProductsView = cache(
  async (slug: string): Promise<AccessoryProductsView> => {
    const staticCategory: StaticAccessoryCategory | undefined =
      getStaticAccessoryCategory(slug);
    const state = await getCatalogState();

    if (!state.ready) {
      return { products: staticCategory?.products ?? [], source: 'static' };
    }

    const category = findCategory(state.snapshot!, slug);
    if (!category) {
      return { products: staticCategory?.products ?? [], source: 'static' };
    }

    return { products: accessoryProductsFromCategory(category), source: 'db' };
  },
);

/* ------------------------------------------------------------------ cases */

export interface CasesCategoryView {
  config: CategoryConfig;
  products: CollectionProduct[];
  source: CatalogSourceKind;
}

/**
 * Cases & Protection. Both routes already read the database; this keeps that
 * and adds the static bundle as the outage fallback.
 */
export const getCasesCategoryView = cache(async (): Promise<CasesCategoryView | null> => {
  const state = await getCatalogState();
  if (!state.ready) {
    return {
      config: STATIC_CASES_CONFIG,
      products: staticCaseCollectionProducts(),
      source: 'static',
    };
  }

  const category = findCategory(state.snapshot!, 'cases-protection');
  if (!category) return null;

  return {
    config: toCategoryConfig(category),
    products: caseProductsFromCategory(category),
    source: 'db',
  };
});

/* ----------------------------------------------------------------- detail */

export type ProductDetail =
  | { kind: 'case'; product: CaseProduct; source: CatalogSourceKind }
  | { kind: 'accessory'; product: AccessoryProduct; source: CatalogSourceKind };

/**
 * One product for `/shop/product/[id]` and `/shop/buy/[id]`.
 *
 * - Database unreachable → the static record (or null if even static lacks it).
 * - Database reachable + row absent/inactive/deleted → null (the page 404s).
 * - Row present → database values win; static fills the marketing gaps.
 */
export const getProductDetail = cache(async (id: string): Promise<ProductDetail | null> => {
  const state = await getProductState(id);

  if (!state.ready) {
    const staticProduct = getStaticProduct(id);
    if (!staticProduct) return null;
    return staticProduct.kind === 'case'
      ? { kind: 'case', product: staticProduct.product, source: 'static' }
      : { kind: 'accessory', product: staticProduct.product, source: 'static' };
  }

  if (!state.product) return null;
  const databaseProduct = state.product;

  const staticCase = getStaticCaseProduct(databaseProduct.id);
  if (staticCase || databaseProduct.categorySlug === 'cases-protection') {
    return {
      kind: 'case',
      product: staticCase
        ? mergeCaseProduct(staticCase, databaseProduct)
        : caseProductFromDatabase(databaseProduct),
      source: 'db',
    };
  }

  const staticAccessory = getStaticAccessoryProduct(databaseProduct.id);
  return {
    kind: 'accessory',
    product: staticAccessory
      ? mergeAccessoryProduct(staticAccessory, databaseProduct)
      : accessoryProductFromDatabase(databaseProduct),
    source: 'db',
  };
});

/* --------------------------------------------------------- search / bag */

export interface StorefrontRefs {
  products: StorefrontProductRef[];
  source: CatalogSourceKind;
}

/**
 * Compact rows (name, id, category, image, price, availability) for search
 * and the bag. Explicit fields only: no cost, notes, audit data or customer
 * data can reach this shape.
 */
export const getStorefrontRefs = cache(async (): Promise<StorefrontRefs> => {
  const state = await getCatalogState();
  if (!state.ready) {
    return { products: STATIC_PRODUCT_REFS, source: 'static' };
  }

  const categoryNames = new Map(
    state.snapshot!.categories.map((category) => [category.id, category.name]),
  );
  return {
    products: state.snapshot!.products.map((product) =>
      refFromDatabase(product, categoryNames.get(product.categoryId)),
    ),
    source: 'db',
  };
});

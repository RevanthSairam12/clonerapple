/**
 * Storefront catalogue — the server read layer every customer surface uses.
 *
 * Store Admin owns `products`, `product_images`, `product_variants`,
 * `product_specs`, `product_facets` and `stock`. This module reads them once
 * per request (React `cache`), across requests (`unstable_cache`, 30s safety
 * net) and tags the entries so every successful Store Admin write can call
 * `revalidateCatalog()` and make the next request see the new value.
 *
 * The cached entries carry catalogue rows only, priced at the **regular**
 * price. The sale switch is read fresh on every request and applied through
 * `applySaleDisplay()`, so a sale starting or ending is reflected immediately
 * rather than up to 30 seconds later.
 *
 * Fallback rule: if the database is unreachable (or DATABASE_URL is unset),
 * static marketing remains available but managed compatibility, scoped attributes
 * and their filters are suppressed. Missing schema is deployment-not-ready, not
 * an outage fallback. A reachable missing/inactive product row remains a 404.
 *
 * Components never query the database; they receive props from a server page.
 */

import { cache } from 'react';
import { unstable_cache } from 'next/cache';

import { toCategoryConfig } from '@/lib/catalog/adapter';
import {
  applySaleDisplay,
  readStorefrontCatalog,
  type StorefrontCatalogSnapshot,
  type StorefrontCategory,
  type StorefrontProduct,
  type StorefrontProductRef,
} from '@/lib/catalog/storefront';
import type { AccessoryProduct, CategoryConfig } from '@/components/sites/accessories/data/types';
import type { Product as CaseProduct } from '@/components/sites/cases-protection/data/products';
import type { CollectionProduct } from '@/components/collection/types';

import { isCatalogSchemaError, suppressManagedCatalog } from './catalog-rules';
import { CATALOG_CACHE_TAG, productCacheTag } from './catalog-tags';
import { readSaleState, type SaleState } from './sale-state';
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

const CATALOG_SNAPSHOT_TTL_MS = 30_000;

const globalForCatalog = globalThis as typeof globalThis & {
  __gadzioCatalogSnapshot?: { snapshot: StorefrontCatalogSnapshot; at: number } | null;
};

let inflightCatalogRead: Promise<StorefrontCatalogSnapshot | null> | null = null;
let inflightCachedCatalog: Promise<StorefrontCatalogSnapshot | null> | null = null;

function readCatalogSingleflight(): Promise<StorefrontCatalogSnapshot | null> {
  if (inflightCatalogRead) return inflightCatalogRead;
  const p = readStorefrontCatalog().finally(() => {
    if (inflightCatalogRead === p) inflightCatalogRead = null;
  });
  inflightCatalogRead = p;
  return p;
}

const readCachedCatalog = unstable_cache(
  async (): Promise<StorefrontCatalogSnapshot | null> => readCatalogSingleflight(),
  ['storefront-catalog', 'phase-b2-option-prices-v3'],
  { tags: [CATALOG_CACHE_TAG], revalidate: 30 },
);

function startCachedCatalogRefresh(): Promise<StorefrontCatalogSnapshot | null> {
  if (inflightCachedCatalog) return inflightCachedCatalog;
  const p = readCachedCatalog()
    .then((snapshot) => {
      if (snapshot) {
        globalForCatalog.__gadzioCatalogSnapshot = { snapshot, at: Date.now() };
      }
      return snapshot;
    })
    .finally(() => {
      if (inflightCachedCatalog === p) inflightCachedCatalog = null;
    });
  inflightCachedCatalog = p;
  return p;
}

function getCachedCatalogSingleflight(): Promise<StorefrontCatalogSnapshot | null> {
  const slot = globalForCatalog.__gadzioCatalogSnapshot;
  const now = Date.now();
  if (slot && now - slot.at < CATALOG_SNAPSHOT_TTL_MS) {
    return Promise.resolve(slot.snapshot);
  }
  if (slot) {
    void startCachedCatalogRefresh();
    return Promise.resolve(slot.snapshot);
  }
  return startCachedCatalogRefresh();
}

/**
 * One catalogue read per request. Connection outages fall back; missing schema
 * throws a distinct deployment-not-ready error without inventing managed data.
 */
const getCatalogState = cache(async (): Promise<CatalogState> => {
  try {
    const snapshot = await getCachedCatalogSingleflight();
    return { ready: snapshot !== null, snapshot };
  } catch (error) {
    if (isCatalogSchemaError(error)) throw new Error('Catalogue deployment is not ready.', { cause: error });
    console.warn('[storefront/catalog] catalogue database unavailable; rendering static data');
    return { ready: false, snapshot: null };
  }
});

interface ProductState {
  ready: boolean;
  product: StorefrontProduct | null;
}

/** One product read; `ready` distinguishes "not in the catalogue" from "no DB". */
const getProductState = cache(async (id: string): Promise<ProductState> => {
  const normalised = id.trim().toLowerCase();
  if (!normalised) return { ready: false, product: null };
  void productCacheTag;
  const state = await getCatalogState();
  if (!state.ready || !state.snapshot) return { ready: false, product: null };
  const product =
    state.snapshot.products.find((entry) => entry.id.toLowerCase() === normalised) ?? null;
  return { ready: true, product };
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

/**
 * The sale switch, read once per request. The cached snapshot never holds it,
 * so every caller gets the state as of this request.
 */
const getSaleState = cache(async () => readSaleState());

function withDescription<T extends { description: string }>(product: T, source: StorefrontProduct): T & Pick<StorefrontProduct, 'shortDescription' | 'descriptionSections'> {
  return { ...product, shortDescription: source.shortDescription ?? null, descriptionSections: source.descriptionSections ?? null };
}

function descriptionRef(product: StorefrontProduct, categoryName?: string): StorefrontProductRef {
  const ref = refFromDatabase(product, categoryName);
  // Compact search includes the short summary only; hidden/long sections stay out.
  return { ...ref, keywords: [...ref.keywords, ...(product.shortDescription ?? '').toLowerCase().split(/\s+/).filter(Boolean)] };
}

function accessoryProductsFromCategory(
  category: StorefrontCategory,
  saleLive: boolean,
): AccessoryProduct[] {
  return category.products.map((row) => {
    const product = applySaleDisplay(row, saleLive);
    const staticProduct = getStaticAccessoryProduct(product.id);
    return withDescription(staticProduct
      ? mergeAccessoryProduct(staticProduct, product)
      : accessoryProductFromDatabase(product), product);
  });
}

function caseProductsFromCategory(
  category: StorefrontCategory,
  saleLive: boolean,
): CollectionProduct[] {
  return category.products.map((row) => {
    const product = applySaleDisplay(row, saleLive);
    const staticProduct = getStaticCaseCollectionProduct(product.id);
    return collectionProductFromDatabase(product, staticProduct ?? null);
  });
}

/** Keep editorial furniture; only product-backed filters/pills are replaced. */
function fallbackConfig(config: CategoryConfig, products: { brand: string }[]): CategoryConfig {
  const options = [...new Set(products.map((product) => product.brand).filter(Boolean))];
  return { ...config, filters: options.length ? [{ id: 'brand', label: 'Brand', options }] : [],
    quickPillFacet: undefined, quickPills: undefined };
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
    const [state, sale] = await Promise.all([getCatalogState(), getSaleState()]);
    if (!state.ready) {
      const staticCategory = getStaticAccessoryCategory(slug);
      if (!staticCategory) return null;
      const products = staticCategory.products.map(suppressManagedCatalog);
      return { config: fallbackConfig(staticCategory.config, products), products, source: 'static' };
    }

    const category = findCategory(state.snapshot!, slug);
    if (!category) return null;

    return {
      config: toCategoryConfig(category),
      products: accessoryProductsFromCategory(category, sale.live),
      source: 'db',
    };
  },
);

export interface AccessoryProductsView {
  filters: CategoryConfig['filters'];
  quickPillFacet?: string;
  quickPills?: string[];
  products: AccessoryProduct[];
  source: CatalogSourceKind;
}

/**
 * Products for one of the five explicit accessory routes. Those pages keep
 * their static `CONFIG` (page furniture is not moving in this phase); only the
 * products and filters come from projected rows. A missing database uses sanitized
 * static marketing; a reachable missing category never revives static products.
 */
export const getAccessoryProductsView = cache(
  async (slug: string): Promise<AccessoryProductsView> => {
    const staticCategory: StaticAccessoryCategory | undefined =
      getStaticAccessoryCategory(slug);
    const [state, sale] = await Promise.all([getCatalogState(), getSaleState()]);

    if (!state.ready) {
      const products = (staticCategory?.products ?? []).map(suppressManagedCatalog);
      const config = staticCategory ? fallbackConfig(staticCategory.config, products) : null;
      return { products, filters: config?.filters ?? [], source: 'static' };
    }

    const category = findCategory(state.snapshot!, slug);
    if (!category) return { products: [], filters: [], source: 'db' };
    const { filters, quickPillFacet, quickPills } = toCategoryConfig(category);
    return { products: accessoryProductsFromCategory(category, sale.live),
      filters, quickPillFacet, quickPills, source: 'db' };
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
  const [state, sale] = await Promise.all([getCatalogState(), getSaleState()]);
  if (!state.ready) {
    const products = staticCaseCollectionProducts().map(suppressManagedCatalog);
    return {
      config: fallbackConfig(STATIC_CASES_CONFIG, products),
      products,
      source: 'static',
    };
  }

  const category = findCategory(state.snapshot!, 'cases-protection');
  if (!category) return null;

  return {
    config: toCategoryConfig(category),
    products: caseProductsFromCategory(category, sale.live),
    source: 'db',
  };
});

/* ----------------------------------------------------------------- detail */

/** Stock as the detail page rendered it; the click-time endpoint refreshes it. */
export interface ProductStockState {
  inStock: boolean;
  trackInventory: boolean;
  availableStock: number | null;
}

export type ProductDetail =
  | { kind: 'case'; product: CaseProduct; stock: ProductStockState; source: CatalogSourceKind }
  | { kind: 'accessory'; product: AccessoryProduct; stock: ProductStockState; source: CatalogSourceKind };

/**
 * One product for `/shop/product/[id]` and `/shop/buy/[id]`.
 *
 * - Database unreachable → the static record (or null if even static lacks it).
 * - Database reachable + row absent/inactive/deleted → null (the page 404s).
 * - Row present → database values win; static fills the marketing gaps.
 */
export const getProductDetail = cache(async (id: string): Promise<ProductDetail | null> => {
  const [state, sale] = await Promise.all([getProductState(id), getSaleState()]);

  if (!state.ready) {
    const staticProduct = getStaticProduct(id);
    if (!staticProduct) return null;
    const stock: ProductStockState = {
      inStock: true,
      trackInventory: false,
      availableStock: null,
    };
    return staticProduct.kind === 'case'
      ? { kind: 'case', product: suppressManagedCatalog(staticProduct.product), stock, source: 'static' }
      : { kind: 'accessory', product: suppressManagedCatalog(staticProduct.product), stock, source: 'static' };
  }

  if (!state.product) return null;
  // The cached row is regular-priced; the sale switch is applied here, on
  // this request, so the detail page can never show a stale badge or price.
  const databaseProduct = applySaleDisplay(state.product, sale.live);
  const stock: ProductStockState = {
    inStock: databaseProduct.inStock,
    trackInventory: databaseProduct.trackInventory,
    availableStock: databaseProduct.availableStock,
  };

  const staticCase = getStaticCaseProduct(databaseProduct.id);
  if (staticCase || databaseProduct.categorySlug === 'cases-protection') {
    return {
      kind: 'case',
      product: withDescription(staticCase
        ? mergeCaseProduct(staticCase, databaseProduct)
        : caseProductFromDatabase(databaseProduct), databaseProduct),
      stock,
      source: 'db',
    };
  }

  const staticAccessory = getStaticAccessoryProduct(databaseProduct.id);
  return {
    kind: 'accessory',
    product: withDescription(staticAccessory
      ? mergeAccessoryProduct(staticAccessory, databaseProduct)
      : accessoryProductFromDatabase(databaseProduct), databaseProduct),
    stock,
    source: 'db',
  };
});

/* --------------------------------------------------------- search / bag */

/** Purchase admission must not use cross-request cached rows or outage fallback. */
export async function getFreshStorefrontRefs(): Promise<StorefrontRefs> {
  const [snapshot, sale] = await Promise.all([readStorefrontCatalog(), readSaleState()]);
  if (!snapshot || sale.unreadable) throw new Error('Current catalogue pricing is unavailable.');
  const categories = new Map(snapshot.categories.map(category => [category.id, category.name]));
  return { products: snapshot.products.map(product => descriptionRef(applySaleDisplay(product, sale.live), categories.get(product.categoryId))),
    saleLive: sale.live, source: 'db' };
}

export interface StorefrontRefs {
  products: StorefrontProductRef[];
  /** The sale switch on the database clock; false when it cannot be read. */
  saleLive: boolean;
  source: CatalogSourceKind;
}

/**
 * Compact rows (name, id, category, image, price, availability) for search
 * and the bag. Explicit fields only: no cost, notes, audit data or customer
 * data can reach this shape.
 */
export const getStorefrontRefs = cache(async (saleState?: SaleState): Promise<StorefrontRefs> => {
  const [state, sale] = await Promise.all([getCatalogState(), saleState ?? getSaleState()]);
  if (!state.ready) {
    return { products: STATIC_PRODUCT_REFS, saleLive: sale.live, source: 'static' };
  }

  const categoryNames = new Map(
    state.snapshot!.categories.map((category) => [category.id, category.name]),
  );
  return {
    products: state.snapshot!.products.map((product) =>
      descriptionRef(applySaleDisplay(product, sale.live), categoryNames.get(product.categoryId)),
    ),
    saleLive: sale.live,
    source: 'db',
  };
});

/**
 * Several products by id from the cached storefront snapshot, with the live
 * sale switch applied per request. Used by the homepage so `/` shares the
 * 30s catalog cache instead of running 9 uncached full-table queries per visit.
 */
export const getCachedStorefrontProducts = cache(
  async (ids: readonly string[]): Promise<StorefrontProduct[]> => {
    if (ids.length === 0) return [];
    const [state, sale] = await Promise.all([getCatalogState(), getSaleState()]);
    if (!state.ready || !state.snapshot) return [];
    const byId = new Map<string, StorefrontProduct>();
    for (const product of state.snapshot.products) {
      byId.set(product.id, product);
      byId.set(product.id.toLowerCase(), product);
    }
    return ids.flatMap((id) => {
      const match = byId.get(id) ?? byId.get(id.toLowerCase());
      return match ? [applySaleDisplay(match, sale.live)] : [];
    });
  },
);

/**
 * The static catalogue, in one place.
 *
 * These bundles are the fallback when the database is unreachable (and the
 * seed source the factory used before Store Admin owned the catalogue). While
 * the database is answering they fill only the fields a row does not carry
 * (marketing copy, colour swatches, gallery extras, in-the-box lists); database
 * values always win. They are the whole page only when
 * `readStorefrontCatalog()` cannot reach the database.
 *
 * Server-only by convention: the read layer imports this, and every page that
 * touches it is a server component.
 */

import {
  CASE_PRODUCTS,
  ALL_ACCESSORY_PRODUCTS,
} from '@/lib/products/registry';
import type { Product as CaseProduct } from '@/components/sites/cases-protection/data/products';
import {
  FILTER_BRANDS,
  FILTER_MATERIALS,
  FILTER_MODELS,
} from '@/components/sites/cases-protection/data/products';
import type {
  AccessoryProduct,
  CategoryConfig,
} from '@/components/sites/accessories/data/types';
import { buildCategoryLinks } from '@/components/sites/accessories/data/types';
import type { CollectionProduct } from '@/components/collection/types';
import { normalizeProduct } from '@/components/collection/types';
import type { StorefrontProductRef } from '@/lib/catalog/storefront';

import { CONFIG as POWER_CONFIG, PRODUCTS as POWER_PRODUCTS } from '@/components/sites/accessories/data/power-adapter-cable';
import { CONFIG as WIRED_CONFIG, PRODUCTS as WIRED_PRODUCTS } from '@/components/sites/accessories/data/wired-earphones';
import { CONFIG as CABLE_CONFIG, PRODUCTS as CABLE_PRODUCTS } from '@/components/sites/accessories/data/cable-plug-case';
import { CONFIG as AIRPODS_CONFIG, PRODUCTS as AIRPODS_PRODUCTS } from '@/components/sites/accessories/data/airpods-case';
import { CONFIG as MOBILE_CONFIG, PRODUCTS as MOBILE_PRODUCTS } from '@/components/sites/accessories/data/mobile-cases';

import {
  refFromStaticAccessory,
  refFromStaticCase,
} from './catalog-merge';

export interface StaticAccessoryCategory {
  config: CategoryConfig;
  products: AccessoryProduct[];
}

/** The five config-driven accessory categories (cases has its own page). */
export const STATIC_ACCESSORY_CATEGORIES: Record<string, StaticAccessoryCategory> = {
  'power-adapter-cable': { config: POWER_CONFIG, products: POWER_PRODUCTS },
  'wired-earphones': { config: WIRED_CONFIG, products: WIRED_PRODUCTS },
  'cable-plug-case': { config: CABLE_CONFIG, products: CABLE_PRODUCTS },
  'airpods-case': { config: AIRPODS_CONFIG, products: AIRPODS_PRODUCTS },
  'mobile-cases': { config: MOBILE_CONFIG, products: MOBILE_PRODUCTS },
};

/** Page furniture for Cases & Protection when the category row is unavailable. */
export const STATIC_CASES_CONFIG: CategoryConfig = {
  slug: 'cases-protection',
  title: 'iPhone Cases & Protection',
  subhead:
    'Explore premium Gadzio protective cases for iPhone with military-grade drop defense, liquid silicone, anti-yellowing crystal clear, and MagSafe compatibility.',
  breadcrumbLeaf: 'Cases & Protection',
  countNoun: 'cases',
  categoryLinks: buildCategoryLinks('cases-protection'),
  filters: [
    { id: 'model', label: 'Compatible With', options: FILTER_MODELS },
    { id: 'material', label: 'Material', options: FILTER_MATERIALS },
    { id: 'brand', label: 'Brand', options: FILTER_BRANDS },
  ],
  quickPillFacet: 'model',
  quickPills: FILTER_MODELS,
  disclaimer:
    'iPhone, MagSafe, and Apple are trademarks of Apple Inc. Gadzio cases and accessories are independently engineered for device compatibility and are not affiliated with, sponsored, or endorsed by Apple Inc.',
  seo: {
    title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
    description:
      'Shop Gadzio protective cases for iPhone. Find MagSafe liquid silicone cases, crystal clear cases, and AeroWeave technical textile cases with military-grade drop defense.',
  },
};

export const STATIC_CASE_PRODUCTS: CaseProduct[] = CASE_PRODUCTS;
export const STATIC_ACCESSORY_PRODUCTS: AccessoryProduct[] = ALL_ACCESSORY_PRODUCTS;

export function getStaticAccessoryCategory(
  slug: string,
): StaticAccessoryCategory | undefined {
  return STATIC_ACCESSORY_CATEGORIES[slug];
}

export function getStaticCategoryConfig(slug: string): CategoryConfig | undefined {
  if (slug === STATIC_CASES_CONFIG.slug) return STATIC_CASES_CONFIG;
  return STATIC_ACCESSORY_CATEGORIES[slug]?.config;
}

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function getStaticCaseProduct(id: string): CaseProduct | undefined {
  return CASE_PRODUCTS.find((product) => sameId(product.id, id));
}

export function getStaticAccessoryProduct(id: string): AccessoryProduct | undefined {
  return ALL_ACCESSORY_PRODUCTS.find((product) => sameId(product.id, id));
}

export type StaticProduct =
  | { kind: 'case'; product: CaseProduct }
  | { kind: 'accessory'; product: AccessoryProduct };

export function getStaticProduct(id: string): StaticProduct | undefined {
  const caseProduct = getStaticCaseProduct(id);
  if (caseProduct) return { kind: 'case', product: caseProduct };
  const accessoryProduct = getStaticAccessoryProduct(id);
  if (accessoryProduct) return { kind: 'accessory', product: accessoryProduct };
  return undefined;
}

/** Cases & Protection grid, from the static records, for the fallback path. */
export function staticCaseCollectionProducts(): CollectionProduct[] {
  return CASE_PRODUCTS.map((product) => normalizeProduct(product));
}

export function getStaticCaseCollectionProduct(
  id: string,
): CollectionProduct | undefined {
  const product = getStaticCaseProduct(id);
  return product ? normalizeProduct(product) : undefined;
}

/** Compact rows for search and the bag when the database is unreachable. */
export const STATIC_PRODUCT_REFS: StorefrontProductRef[] = [
  ...CASE_PRODUCTS.map(refFromStaticCase),
  ...ALL_ACCESSORY_PRODUCTS.map(refFromStaticAccessory),
];

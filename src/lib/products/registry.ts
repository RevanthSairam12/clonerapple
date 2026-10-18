// Central product registry.
//
// Aggregates the original iPhone cases-protection catalog with the generic
// accessory catalogs so the shared consumers — the product-detail route, the
// PayU checkout catalog, and site search — can resolve any product by id
// without caring which bundle it came from.
//
// The cases-protection flow is intentionally left untouched: its products keep
// their own `Product` shape and render via the original ProductDetailPage.

import {
  PRODUCTS as CASE_PRODUCTS,
  getProductById as getCaseProductById,
  type Product as CaseProduct,
} from '@/components/sites/cases-protection/data/products';

import { PRODUCTS as POWER_ADAPTER_CABLE } from '@/components/sites/accessories/data/power-adapter-cable';
import { PRODUCTS as WIRED_EARPHONES } from '@/components/sites/accessories/data/wired-earphones';
import { PRODUCTS as CABLE_PLUG_CASE } from '@/components/sites/accessories/data/cable-plug-case';
import { PRODUCTS as AIRPODS_CASE } from '@/components/sites/accessories/data/airpods-case';
import { PRODUCTS as MOBILE_CASES } from '@/components/sites/accessories/data/mobile-cases';
import type { AccessoryProduct } from '@/components/sites/accessories/data/types';

export type { CaseProduct, AccessoryProduct };
export { getCaseProductById, CASE_PRODUCTS };

/** Every generic accessory product across the five new categories. */
export const ALL_ACCESSORY_PRODUCTS: AccessoryProduct[] = [
  ...POWER_ADAPTER_CABLE,
  ...WIRED_EARPHONES,
  ...CABLE_PLUG_CASE,
  ...AIRPODS_CASE,
  ...MOBILE_CASES,
];

/** Resolve a generic accessory product by id (undefined if not an accessory). */
export function getAccessoryProductById(id: string): AccessoryProduct | undefined {
  return ALL_ACCESSORY_PRODUCTS.find((p) => p.id === id);
}

/** Every product id known to the store (cases + accessories), de-duplicated. */
export function getAllProductIds(): string[] {
  return Array.from(
    new Set([...CASE_PRODUCTS.map((p) => p.id), ...ALL_ACCESSORY_PRODUCTS.map((p) => p.id)]),
  );
}

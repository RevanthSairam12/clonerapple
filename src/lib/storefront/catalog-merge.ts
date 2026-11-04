/**
 * Pure merge rules for storefront product data.
 *
 * The database owns every value it has. The static bundles fill the fields the
 * database does not carry (marketing copy, colour swatches, gallery extras,
 * in-the-box lists) so a page keeps the shape it renders today. Prices always
 * come from the database row; a static price is never used when a row exists.
 *
 * No queries and no Next.js imports: tests import this module directly.
 */

import type {
  AccessoryProduct,
  ProductHighlight,
  SpecRow,
} from '@/components/sites/accessories/data/types';
import type { Product as CaseProduct, ProductSpecs } from '@/components/sites/cases-protection/data/products';
import type { CollectionProduct } from '@/components/collection/types';
import type { StorefrontProductRef } from '@/lib/catalog/storefront';

import {
  normaliseKey,
  type LabelledValue,
} from './catalog-rules';

/** The subset of `StorefrontProduct` these rules read. */
export interface CatalogProductSource {
  inventoryMode?: 'product' | 'variant';
  purchasableVariants?: import('@/lib/catalog/storefront').StorefrontPurchasableVariant[];

  id: string;
  name?: string | null;
  subtitle?: string | null;
  price?: number | null;
  pricePaise?: number | null;
  priceDisplay?: string | null;
  regularPricePaise?: number | null;
  salePricePaise?: number | null;
  onSale?: boolean | null;
  image?: string | null;
  gallery?: string[] | null;
  hoverImage?: string | null;
  colors?: { name: string; hex: string }[] | null;
  compatibility?: string[] | null;
  material?: string | null;
  brand?: string | null;
  description?: string | null;
  highlights?: ProductHighlight[] | null;
  features?: string[] | null;
  specs?: SpecRow[] | null;
  inTheBox?: string[] | null;
  badge?: string | null;
  inStock?: boolean | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  facets?: Record<string, string> | null;
  searchValues?: string[] | null;
  href?: string | null;
}

function text(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function list<T>(value: T[] | null | undefined): T[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null;
}

/** Matches `formatPaise` in the database reader: Indian grouping, two decimals. */
function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pricePaiseOf(product: CatalogProductSource): number {
  const paise = Math.round(Number(product.pricePaise));
  if (Number.isFinite(paise) && paise >= 0 && product.pricePaise !== null && product.pricePaise !== undefined) {
    return paise;
  }
  const rupees = Number(product.price);
  return Number.isFinite(rupees) && rupees >= 0 ? Math.round(rupees * 100) : 0;
}

function priceDisplayOf(product: CatalogProductSource, paise: number): string {
  return text(product.priceDisplay) ?? formatRupees(paise);
}

/** The struck-through regular price, only while the sale price is in force. */
function wasPriceDisplayOf(product: CatalogProductSource): string | undefined {
  if (product.onSale !== true) return undefined;
  const regular = Math.round(Number(product.regularPricePaise));
  return Number.isFinite(regular) && regular > 0 ? formatRupees(regular) : undefined;
}

function featuresOf(
  features: string[] | null | undefined,
  highlights: ProductHighlight[] | null | undefined,
): string[] {
  return list(features) ?? (list(highlights)?.map((highlight) => highlight.title) ?? []);
}

function specsFromDatabase(product: CatalogProductSource): SpecRow[] {
  return (product.specs ?? []).flatMap((spec) => {
    const label = text(spec.label);
    const value = text(spec.value);
    return label && value ? [{ label, value }] : [];
  });
}

function caseSpecsFromDatabase(
  databaseSpecs: SpecRow[],
): ProductSpecs {
  const values = new Map<string, string>();
  for (const spec of databaseSpecs) {
    const key = normaliseKey(spec.label);
    const value = text(spec.value);
    if (key && value) values.set(key, value);
  }

  const keys: Array<keyof ProductSpecs> = [
    'material',
    'weight',
    'thickness',
    'magneticHold',
    'dropProtection',
    'warranty',
  ];
  const specs = Object.fromEntries(databaseSpecs
    .filter((spec) => !keys.some((key) => normaliseKey(key) === normaliseKey(spec.label)))
    .map((spec) => [spec.label, spec.value])) as unknown as ProductSpecs;
  for (const key of keys) {
    specs[key] =
      values.get(normaliseKey(key)) ?? '';
  }
  return specs;
}

function hrefOf(product: CatalogProductSource, fallback?: string): string {
  return text(product.href) ?? fallback ?? `/shop/product/${encodeURIComponent(product.id)}`;
}

/* ------------------------------------------------------------------ detail */

/**
 * Accessory detail props. Database values win; the static record fills gaps.
 */
export function mergeAccessoryProduct(
  staticProduct: AccessoryProduct,
  databaseProduct: CatalogProductSource,
): AccessoryProduct {
  const paise = pricePaiseOf(databaseProduct);
  const databaseSpecs = specsFromDatabase(databaseProduct);
  const databaseImages = list((databaseProduct.gallery ?? []).filter(Boolean));
  const wasPriceDisplay = wasPriceDisplayOf(databaseProduct);

  return {
    id: staticProduct.id,
    inventoryMode: databaseProduct.inventoryMode ?? 'product',
    purchasableVariants: databaseProduct.purchasableVariants ?? [],
    name: text(databaseProduct.name) ?? staticProduct.name,
    subtitle: text(databaseProduct.subtitle) ?? staticProduct.subtitle,
    price: paise / 100,
    priceDisplay: priceDisplayOf(databaseProduct, paise),
    ...(wasPriceDisplay
      ? {
          wasPriceDisplay,
          regularPrice: Math.round(Number(databaseProduct.regularPricePaise)) / 100,
        }
      : {}),
    image: text(databaseProduct.image) ?? staticProduct.image,
    images: databaseImages ?? staticProduct.images,
    colors: list(databaseProduct.colors) ?? staticProduct.colors,
    compatibility: databaseProduct.compatibility ?? [],
    material: text(databaseProduct.material) ?? '',
    brand: text(databaseProduct.brand) ?? staticProduct.brand,
    category: text(databaseProduct.categoryName) ?? staticProduct.category,
    categorySlug: text(databaseProduct.categorySlug) ?? staticProduct.categorySlug,
    facets: { ...(databaseProduct.facets ?? {}) },
    features:
      list(databaseProduct.features) ??
      list(databaseProduct.highlights)?.map((highlight) => highlight.title) ??
      staticProduct.features,
    description: text(databaseProduct.description) ?? staticProduct.description,
    highlights: list(databaseProduct.highlights) ?? staticProduct.highlights,
    specs: databaseSpecs,
    inTheBox: list(databaseProduct.inTheBox) ?? staticProduct.inTheBox,
    href: hrefOf(databaseProduct, staticProduct.href),
    inStock: databaseProduct.inStock !== false,
  };
}

/** Accessory detail props for a product the static bundles do not know. */
export function accessoryProductFromDatabase(
  databaseProduct: CatalogProductSource,
): AccessoryProduct {
  const paise = pricePaiseOf(databaseProduct);
  const image = text(databaseProduct.image) ?? '';
  const gallery = (databaseProduct.gallery ?? []).filter(Boolean);
  const highlights = databaseProduct.highlights ?? [];
  const wasPriceDisplay = wasPriceDisplayOf(databaseProduct);

  return {
    id: databaseProduct.id,
    inventoryMode: databaseProduct.inventoryMode ?? 'product',
    purchasableVariants: databaseProduct.purchasableVariants ?? [],
    name: text(databaseProduct.name) ?? databaseProduct.id,
    subtitle: text(databaseProduct.subtitle) ?? '',
    price: paise / 100,
    priceDisplay: priceDisplayOf(databaseProduct, paise),
    ...(wasPriceDisplay
      ? {
          wasPriceDisplay,
          regularPrice: Math.round(Number(databaseProduct.regularPricePaise)) / 100,
        }
      : {}),
    image,
    images: gallery.length > 0 ? gallery : image ? [image] : [],
    colors: databaseProduct.colors ?? [],
    compatibility: databaseProduct.compatibility ?? [],
    material: text(databaseProduct.material) ?? '',
    brand: text(databaseProduct.brand) ?? '',
    category: text(databaseProduct.categoryName) ?? '',
    categorySlug: text(databaseProduct.categorySlug) ?? '',
    facets: { ...(databaseProduct.facets ?? {}) },
    features: featuresOf(databaseProduct.features, highlights),
    description: text(databaseProduct.description) ?? '',
    highlights,
    specs: specsFromDatabase(databaseProduct),
    inTheBox: databaseProduct.inTheBox ?? [],
    href: hrefOf(databaseProduct),
    inStock: databaseProduct.inStock !== false,
  };
}

/** Case detail props. Database values win; static fills the union-typed gaps. */
export function mergeCaseProduct(
  staticProduct: CaseProduct,
  databaseProduct: CatalogProductSource,
): CaseProduct {
  const paise = pricePaiseOf(databaseProduct);
  const databaseSpecs = specsFromDatabase(databaseProduct);
  const hoverImage = text(databaseProduct.hoverImage) ?? staticProduct.hoverImage;
  const badge = text(databaseProduct.badge) ?? staticProduct.badge;
  const wasPriceDisplay = wasPriceDisplayOf(databaseProduct);

  const product: CaseProduct = {
    id: staticProduct.id,
    inventoryMode: databaseProduct.inventoryMode ?? 'product',
    purchasableVariants: databaseProduct.purchasableVariants ?? [],
    name: text(databaseProduct.name) ?? staticProduct.name,
    subtitle: text(databaseProduct.subtitle) ?? staticProduct.subtitle,
    price: paise / 100,
    priceDisplay: priceDisplayOf(databaseProduct, paise),
    ...(wasPriceDisplay
      ? {
          wasPriceDisplay,
          regularPrice: Math.round(Number(databaseProduct.regularPricePaise)) / 100,
        }
      : {}),
    image: text(databaseProduct.image) ?? staticProduct.image,
    colors: list(databaseProduct.colors) ?? staticProduct.colors,
    compatibility: databaseProduct.compatibility ?? [],
    material: (text(databaseProduct.material) ?? '') as CaseProduct['material'],
    brand: (text(databaseProduct.brand) ?? staticProduct.brand) as CaseProduct['brand'],
    features:
      list(databaseProduct.features) ??
      list(databaseProduct.highlights)?.map((highlight) => highlight.title) ??
      staticProduct.features,
    description: text(databaseProduct.description) ?? staticProduct.description,
    highlights: list(databaseProduct.highlights) ?? staticProduct.highlights,
    specs: caseSpecsFromDatabase(databaseSpecs),
    inTheBox: list(databaseProduct.inTheBox) ?? staticProduct.inTheBox,
    href: hrefOf(databaseProduct, staticProduct.href),
  };

  if (hoverImage) product.hoverImage = hoverImage;
  if (badge) product.badge = badge;
  return product;
}

/** Case detail props for a case created entirely in Store Admin. */
export function caseProductFromDatabase(
  databaseProduct: CatalogProductSource,
): CaseProduct {
  const paise = pricePaiseOf(databaseProduct);
  const highlights = databaseProduct.highlights ?? [];
  const badge = text(databaseProduct.badge);
  const wasPriceDisplay = wasPriceDisplayOf(databaseProduct);

  const product: CaseProduct = {
    id: databaseProduct.id,
    inventoryMode: databaseProduct.inventoryMode ?? 'product',
    purchasableVariants: databaseProduct.purchasableVariants ?? [],
    name: text(databaseProduct.name) ?? databaseProduct.id,
    subtitle: text(databaseProduct.subtitle) ?? '',
    price: paise / 100,
    priceDisplay: priceDisplayOf(databaseProduct, paise),
    ...(wasPriceDisplay
      ? {
          wasPriceDisplay,
          regularPrice: Math.round(Number(databaseProduct.regularPricePaise)) / 100,
        }
      : {}),
    image: text(databaseProduct.image) ?? '',
    colors: databaseProduct.colors ?? [],
    compatibility: databaseProduct.compatibility ?? [],
    material: (text(databaseProduct.material) ?? '') as CaseProduct['material'],
    brand: (text(databaseProduct.brand) ?? '') as CaseProduct['brand'],
    features: featuresOf(databaseProduct.features, highlights),
    description: text(databaseProduct.description) ?? '',
    highlights,
    specs: caseSpecsFromDatabase(specsFromDatabase(databaseProduct)),
    inTheBox: databaseProduct.inTheBox ?? [],
    href: hrefOf(databaseProduct),
  };

  const hoverImage = text(databaseProduct.hoverImage);
  if (hoverImage) product.hoverImage = hoverImage;
  if (badge) product.badge = badge;
  return product;
}

/* -------------------------------------------------------------------- grid */

/** Grid-card props. `base` is the static record, when one exists. */
export function collectionProductFromDatabase(
  databaseProduct: CatalogProductSource,
  base: CollectionProduct | null = null,
): CollectionProduct {
  const paise = pricePaiseOf(databaseProduct);
  const image = text(databaseProduct.image) ?? base?.image ?? '';
  const gallery = list((databaseProduct.gallery ?? []).filter(Boolean));
  const badge = text(databaseProduct.badge) ?? base?.badge;
  const databaseSpecs = specsFromDatabase(databaseProduct);
  const wasPriceDisplay = wasPriceDisplayOf(databaseProduct);

  const product: CollectionProduct = {
    id: databaseProduct.id,
    inventoryMode: databaseProduct.inventoryMode ?? 'product',
    purchasableVariants: databaseProduct.purchasableVariants ?? [],
    name: text(databaseProduct.name) ?? base?.name ?? databaseProduct.id,
    subtitle: text(databaseProduct.subtitle) ?? base?.subtitle ?? '',
    price: paise / 100,
    priceDisplay: priceDisplayOf(databaseProduct, paise),
    ...(wasPriceDisplay
      ? {
          wasPriceDisplay,
          regularPrice: Math.round(Number(databaseProduct.regularPricePaise)) / 100,
        }
      : {}),
    image,
    images: gallery ?? base?.images ?? (image ? [image] : []),
    colors: list(databaseProduct.colors) ?? base?.colors ?? [],
    compatibility: databaseProduct.compatibility ?? [],
    material: text(databaseProduct.material) ?? '',
    brand: text(databaseProduct.brand) ?? base?.brand ?? 'Gadzio',
    facets: { ...(databaseProduct.facets ?? {}) },
    features:
      list(databaseProduct.features) ??
      list(databaseProduct.highlights)?.map((highlight) => highlight.title) ??
      base?.features ??
      [],
    description: text(databaseProduct.description) ?? base?.description ?? '',
    inStock:
      typeof databaseProduct.inStock === 'boolean'
        ? databaseProduct.inStock
        : base?.inStock ?? true,
    href: hrefOf(databaseProduct, base?.href),
  };

  const hoverImage = text(databaseProduct.hoverImage) ?? base?.hoverImage;
  if (hoverImage) product.hoverImage = hoverImage;
  if (badge) {
    product.badge = badge;
    product.isNew = badge === 'New';
  }

  const category = text(databaseProduct.categoryName) ?? base?.category;
  if (category) product.category = category;
  const categorySlug = text(databaseProduct.categorySlug) ?? base?.categorySlug;
  if (categorySlug) product.categorySlug = categorySlug;

  const highlights = list(databaseProduct.highlights) ?? base?.highlights;
  if (highlights) product.highlights = highlights;
  product.specs = databaseSpecs;
  const inTheBox = list(databaseProduct.inTheBox) ?? base?.inTheBox;
  if (inTheBox) product.inTheBox = inTheBox;

  return product;
}

/* -------------------------------------------------------------------- refs */

function keywordsOf(parts: Array<string | null | undefined>): string[] {
  return parts
    .flatMap((part) => String(part ?? '').split(/\s+/))
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** Compact row for search and the bag. Explicit fields — no cost, no notes. */
export function refFromDatabase(
  databaseProduct: CatalogProductSource,
  categoryName?: string | null,
): StorefrontProductRef {
  const paise = pricePaiseOf(databaseProduct);
  const wasPriceDisplay = wasPriceDisplayOf(databaseProduct);
  return {
    id: databaseProduct.id,
    inventoryMode: databaseProduct.inventoryMode ?? 'product',
    purchasableVariants: databaseProduct.purchasableVariants ?? [],
    name: text(databaseProduct.name) ?? databaseProduct.id,
    subtitle: text(databaseProduct.subtitle) ?? '',
    pricePaise: paise,
    priceDisplay: priceDisplayOf(databaseProduct, paise),
    ...(wasPriceDisplay ? { wasPriceDisplay } : {}),
    ...(wasPriceDisplay
      ? { regularPricePaise: Math.round(Number(databaseProduct.regularPricePaise)) }
      : {}),
    image: text(databaseProduct.image) ?? '',
    categorySlug: text(databaseProduct.categorySlug) ?? '',
    categoryName: text(categoryName) ?? text(databaseProduct.categoryName) ?? '',
    inStock: databaseProduct.inStock !== false,
    keywords: [
      ...keywordsOf([
        databaseProduct.name,
        databaseProduct.subtitle,
        databaseProduct.brand,
        categoryName ?? databaseProduct.categoryName,
        ...(databaseProduct.searchValues ?? []),
      ]),
    ].filter(Boolean),
  };
}

export function refFromStaticAccessory(product: AccessoryProduct): StorefrontProductRef {
  return {
    id: product.id,
    name: product.name,
    subtitle: product.subtitle,
    pricePaise: Math.round(product.price * 100),
    priceDisplay: product.priceDisplay,
    image: product.image,
    categorySlug: product.categorySlug,
    categoryName: product.category,
    inStock: true,
    keywords: [
      ...keywordsOf([
        product.name,
        product.subtitle,
        product.brand,
        product.category,
      ]),
    ].filter(Boolean),
  };
}

export function refFromStaticCase(product: CaseProduct): StorefrontProductRef {
  return {
    id: product.id,
    name: product.name,
    subtitle: product.subtitle,
    pricePaise: Math.round(product.price * 100),
    priceDisplay: product.priceDisplay,
    image: product.image,
    categorySlug: 'cases-protection',
    categoryName: 'Cases & Protection',
    inStock: true,
    keywords: [
      ...keywordsOf([
        product.name,
        product.subtitle,
        product.brand,
        'Cases & Protection',
      ]),
    ].filter(Boolean),
  };
}

/** Static `SpecRow` shape from the fixed case spec object (for card display). */
export function caseSpecRows(specs: ProductSpecs): LabelledValue[] {
  return Object.entries(specs).map(([label, value]) => ({ label, value: String(value) }));
}

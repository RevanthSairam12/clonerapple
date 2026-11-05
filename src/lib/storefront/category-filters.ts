/**
 * Category filter rules: Phone model, Colour and Price.
 *
 * Pure and framework-free. The category page already holds the catalogue
 * snapshot (one bounded read, cached briefly and re-priced per request against
 * the sale switch), so every filter value and count is derived from that same
 * payload. Nothing here queries the database, invents a model, colour or
 * combination, or consults cost/internal data.
 *
 * Locked rules (PRODUCT_OPTIONS_FINAL_PLAN.md phase 4):
 * - a value appears only when at least one product in this category matches it;
 * - a variant product matches a model through an active option for that model;
 *   a shared-stock product matches through its compatibility list;
 * - a deactivated model is never a filter value;
 * - filters combine: OR inside one filter, AND across filters;
 * - the selected card shows the matching option's price and colour photo.
 */

import type {
  CollectionProduct,
  CollectionFilterKind,
  CollectionFilterSelection,
} from '@/components/collection/types';
import type {
  StorefrontCompatibilityModel,
  StorefrontImage,
  StorefrontPurchasableVariant,
} from '@/lib/catalog/storefront';

import { formatOptionPaise, normalizeHex } from './option-selection';

/* -------------------------------------------------------------------- data */

export interface ModelFilterOption {
  id: string;
  name: string;
  count: number;
}

export interface ModelFilterGroup {
  /** The device brand, or "Other devices" when the row has no brand. */
  brand: string;
  options: ModelFilterOption[];
}

export interface ColourFilterOption {
  id: string;
  name: string;
  hex: string;
  count: number;
}

export interface PriceFilterOption {
  id: string;
  label: string;
  count: number;
}

export interface CategoryFilterOptions {
  models: ModelFilterGroup[];
  colours: ColourFilterOption[];
  prices: PriceFilterOption[];
}

interface PriceBand {
  id: string;
  label: string;
  minPaise: number;
  maxPaise: number | null;
}

/** Fixed bands, in display order. A band with no products is never rendered. */
export const PRICE_BANDS: readonly PriceBand[] = [
  { id: 'under-1000', label: 'Under ₹1,000', minPaise: 0, maxPaise: 100_000 },
  { id: '1000-2499', label: '₹1,000 – ₹2,499', minPaise: 100_000, maxPaise: 250_000 },
  { id: '2500-4999', label: '₹2,500 – ₹4,999', minPaise: 250_000, maxPaise: 500_000 },
  { id: '5000-plus', label: '₹5,000 & above', minPaise: 500_000, maxPaise: null },
];

export function emptyFilterSelection(): CollectionFilterSelection {
  return { models: [], colours: [], prices: [] };
}

/* ----------------------------------------------------------------- parsing */

type SearchInput =
  | string
  | URLSearchParams
  | { getAll(name: string): string[] }
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function valuesOf(input: SearchInput, key: string): string[] {
  if (!input) return [];
  if (typeof input === 'string') {
    const raw = input.startsWith('?') ? input.slice(1) : input;
    return new URLSearchParams(raw).getAll(key);
  }
  if (typeof (input as URLSearchParams).getAll === 'function') {
    return (input as { getAll(name: string): string[] }).getAll(key);
  }
  const value = (input as Record<string, string | string[] | undefined>)[key];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function cleanValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const cleaned = String(value ?? '').trim();
    if (!cleaned || seen.has(cleaned)) return [];
    seen.add(cleaned);
    return [cleaned];
  });
}

/**
 * Read `?model=` / `?colour=` / `?price=` from the URL. Values are trimmed and
 * deduplicated; what they mean is decided against this category's products by
 * `sanitiseCategoryFilterSelection`, so a stale link cannot empty the page.
 */
export function parseCategoryFilterSearch(input: SearchInput): CollectionFilterSelection {
  return {
    models: cleanValues(valuesOf(input, 'model')),
    colours: cleanValues(valuesOf(input, 'colour')),
    prices: cleanValues(valuesOf(input, 'price')),
  };
}

/** Serialise a selection back into the shareable query string (stable order). */
export function categoryFilterQuery(selection: CollectionFilterSelection): string {
  const params = new URLSearchParams();
  for (const id of selection.models) params.append('model', id);
  for (const id of selection.colours) params.append('colour', id);
  for (const id of selection.prices) params.append('price', id);
  return params.toString();
}

export function filterSelectionIsEmpty(selection: CollectionFilterSelection): boolean {
  return selection.models.length === 0 && selection.colours.length === 0 && selection.prices.length === 0;
}

export function toggleFilterSelection(
  selection: CollectionFilterSelection,
  kind: CollectionFilterKind,
  id: string,
): CollectionFilterSelection {
  const key = kind === 'model' ? 'models' : kind === 'colour' ? 'colours' : 'prices';
  const current = selection[key];
  const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
  return { ...selection, [key]: next };
}

/* -------------------------------------------------------------- projections */

function variantPricePaise(variant: StorefrontPurchasableVariant): number {
  return Number.isFinite(variant.pricePaise) ? Math.max(0, Math.round(variant.pricePaise)) : 0;
}

/** Configured options only; a deactivated model contributes nothing. */
function activeVariants(product: CollectionProduct): StorefrontPurchasableVariant[] {
  if (product.inventoryMode !== 'variant') return [];
  return (product.purchasableVariants ?? []).filter(
    (variant) => variant.deviceModelEligible !== false,
  );
}

interface ProductModel {
  id: string;
  name: string;
  brand: string;
}

/**
 * The models this product can be found by.
 *
 * A variant product matches through its active model options. A shared-stock
 * product (one stock count for several devices) matches through its
 * compatibility list, which the reader already limits to active models.
 */
function productModels(product: CollectionProduct): ProductModel[] {
  if (product.inventoryMode === 'variant') {
    const seen = new Set<string>();
    return activeVariants(product).flatMap((variant) => {
      const id = String(variant.deviceModelId ?? '').trim();
      const name = String(variant.deviceModelName ?? '').trim();
      if (!id || !name || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name, brand: String(variant.deviceModelBrandName ?? '').trim() }];
    });
  }
  return (product.compatibilityModels ?? []).flatMap((model) => {
    const id = String(model.id ?? '').trim();
    const name = String(model.name ?? '').trim();
    return id && name ? [{ id, name, brand: String(model.brandName ?? '').trim() }] : [];
  });
}

function productColours(product: CollectionProduct): { id: string; name: string; hex: string }[] {
  const seen = new Set<string>();
  return activeVariants(product).flatMap((variant) => {
    const id = String(variant.colourId ?? '').trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: String(variant.colourName ?? variant.optionValue ?? '').trim() || 'Colour',
      hex: normalizeHex(variant.colourHex),
    }];
  });
}

function matchesModels(product: CollectionProduct, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const wanted = new Set(selected);
  return productModels(product).some((model) => wanted.has(model.id));
}

function matchesColours(product: CollectionProduct, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const wanted = new Set(selected);
  return productColours(product).some((colour) => wanted.has(colour.id));
}

/** Variants of this product that satisfy the active model and colour choice. */
function selectedVariants(
  product: CollectionProduct,
  selection: CollectionFilterSelection,
): StorefrontPurchasableVariant[] {
  const models = new Set(selection.models);
  const colours = new Set(selection.colours);
  return activeVariants(product).filter((variant) => {
    if (models.size > 0 && !models.has(String(variant.deviceModelId ?? ''))) return false;
    if (colours.size > 0 && !colours.has(String(variant.colourId ?? ''))) return false;
    return true;
  });
}

/**
 * The amount the card should show for the current filters.
 *
 * A model/colour choice prices the cheapest row that satisfies it; otherwise
 * the product's own headline (already its cheapest concrete option) stands.
 */
export function candidatePricePaise(
  product: CollectionProduct,
  selection: CollectionFilterSelection,
): number {
  const fallback = Number.isFinite(product.price) ? Math.max(0, Math.round(product.price * 100)) : 0;
  const hasChoice = selection.models.length > 0 || selection.colours.length > 0;
  if (!hasChoice || product.inventoryMode !== 'variant') return fallback;
  const matching = selectedVariants(product, selection);
  if (matching.length === 0) return fallback;
  return matching.reduce(
    (best, variant) => Math.min(best, variantPricePaise(variant)),
    Number.POSITIVE_INFINITY,
  );
}

function priceBandOf(paise: number): string | null {
  return PRICE_BANDS.find(
    (band) => paise >= band.minPaise && (band.maxPaise === null || paise < band.maxPaise),
  )?.id ?? null;
}

function matchesPrices(
  product: CollectionProduct,
  selected: readonly string[],
  selection: CollectionFilterSelection,
): boolean {
  if (selected.length === 0) return true;
  const band = priceBandOf(candidatePricePaise(product, selection));
  return band !== null && selected.includes(band);
}

/** The products visible under the whole filter selection. */
export function filterCategoryProducts(
  products: readonly CollectionProduct[],
  selection: CollectionFilterSelection,
): CollectionProduct[] {
  return products.filter(
    (product) =>
      matchesModels(product, selection.models)
      && matchesColours(product, selection.colours)
      && matchesPrices(product, selection.prices, selection),
  );
}

/* ------------------------------------------------------------------- facets */

function countBy<T>(
  products: readonly CollectionProduct[],
  entries: (product: CollectionProduct) => T[],
  key: (entry: T) => string,
): Map<string, { value: T; count: number }> {
  const counts = new Map<string, { value: T; count: number }>();
  for (const product of products) {
    const seen = new Set<string>();
    for (const entry of entries(product)) {
      const id = key(entry);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const current = counts.get(id);
      if (current) current.count += 1;
      else counts.set(id, { value: entry, count: 1 });
    }
  }
  return counts;
}

/**
 * Every list the page renders, with counts.
 *
 * Each facet is enumerated over the products that pass the *other* filters, so
 * the colour list shows only colours that exist for the chosen model, and a
 * count is the number of products choosing that value would show.
 */
export function buildCategoryFilterOptions(
  products: readonly CollectionProduct[],
  selection: CollectionFilterSelection,
): CategoryFilterOptions {
  // Models: colours and price apply; the model facet does not filter itself.
  const modelPool = products.filter(
    (product) =>
      matchesColours(product, selection.colours)
      && matchesPrices(product, selection.prices, selection),
  );
  const models = new Map<string, { option: ModelFilterOption; brand: string }>();
  for (const [id, entry] of countBy(modelPool, productModels, (model) => model.id)) {
    models.set(id, {
      brand: entry.value.brand || 'Other devices',
      option: { id, name: entry.value.name, count: entry.count },
    });
  }
  const groups = new Map<string, ModelFilterOption[]>();
  for (const { option, brand } of models.values()) {
    const bucket = groups.get(brand) ?? [];
    bucket.push(option);
    groups.set(brand, bucket);
  }

  // Colours: the model and price filters apply. A colour belongs to a model
  // only through an active option, so the chosen model's colours are exact.
  const colourPool = products.filter(
    (product) =>
      matchesModels(product, selection.models)
      && matchesPrices(product, selection.prices, selection),
  );
  const colours = countBy(
    colourPool,
    (product) => productColours(product).filter((colour) => colourMatchesModel(product, colour.id, selection)),
    (colour) => colour.id,
  );

  // Price: the model and colour filters apply.
  const pricePool = products.filter(
    (product) => matchesModels(product, selection.models)
      && matchesColours(product, selection.colours),
  );
  const priceCounts = new Map<string, number>();
  for (const product of pricePool) {
    const band = priceBandOf(candidatePricePaise(product, selection));
    if (band) priceCounts.set(band, (priceCounts.get(band) ?? 0) + 1);
  }

  return {
    models: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([brand, options]) => ({
        brand,
        options: options.sort((a, b) => a.name.localeCompare(b.name)),
      })),
    colours: [...colours.values()]
      .map((entry) => ({
        id: entry.value.id,
        name: entry.value.name,
        hex: entry.value.hex,
        count: entry.count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    prices: PRICE_BANDS.flatMap((band) => {
      const count = priceCounts.get(band.id) ?? 0;
      return count > 0 ? [{ id: band.id, label: band.label, count }] : [];
    }),
  };
}

/**
 * When a model is chosen, a product contributes only the colours its options
 * carry for that model — never a colour that exists solely on another model.
 */
function colourMatchesModel(
  product: CollectionProduct,
  colourId: string,
  selection: CollectionFilterSelection,
): boolean {
  if (selection.models.length === 0) return true;
  const wanted = new Set(selection.models);
  return activeVariants(product).some(
    (variant) =>
      String(variant.colourId ?? '') === colourId
      && wanted.has(String(variant.deviceModelId ?? '')),
  );
}

/* ---------------------------------------------------------------- sanitiser */

function knownModelIds(products: readonly CollectionProduct[]): Set<string> {
  return new Set(products.flatMap((product) => productModels(product).map((model) => model.id)));
}

function knownColourIds(products: readonly CollectionProduct[]): Set<string> {
  return new Set(products.flatMap((product) => productColours(product).map((colour) => colour.id)));
}

/**
 * Keep only values that exist in this category. A link saved before a model or
 * colour was retired still opens the category instead of an empty page.
 */
export function sanitiseCategoryFilterSelection(
  products: readonly CollectionProduct[],
  selection: CollectionFilterSelection,
): CollectionFilterSelection {
  const modelIds = knownModelIds(products);
  const colourIds = knownColourIds(products);
  const priceIds = new Set(PRICE_BANDS.map((band) => band.id));
  return {
    models: selection.models.filter((id) => modelIds.has(id)),
    colours: selection.colours.filter((id) => colourIds.has(id)),
    prices: selection.prices.filter((id) => priceIds.has(id)),
  };
}

/* ------------------------------------------------------------------- cards */

/** The chosen colour's photo when it has one; the default gallery otherwise. */
export function photoForColour(
  photos: readonly StorefrontImage[] | undefined,
  colourId: string | null | undefined,
): string | null {
  const wanted = String(colourId ?? '').trim();
  if (!wanted) return null;
  const matches = (photos ?? []).filter(
    (photo) => String(photo.colourId ?? '').trim() === wanted && photo.role !== 'hover' && photo.url,
  );
  if (matches.length === 0) return null;
  const sorted = [...matches].sort(
    (a, b) =>
      (a.role === 'primary' ? 0 : 1) - (b.role === 'primary' ? 0 : 1)
      || (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  return sorted[0]?.url ?? null;
}

/**
 * The card a filter selection produces.
 *
 * The price is the cheapest exact row satisfying the choice, the sold-out mark
 * follows only that row (sale mode is applied by the card itself), and a single
 * colour choice swaps in that colour's photo when the product has one.
 */
export function cardForFilterSelection(
  product: CollectionProduct,
  selection: CollectionFilterSelection,
): CollectionProduct {
  const hasChoice = selection.models.length > 0 || selection.colours.length > 0;
  let card = product;

  if (hasChoice && product.inventoryMode === 'variant') {
    const matching = selectedVariants(product, selection);
    if (matching.length > 0) {
      const cheapest = matching.reduce((best, variant) =>
        variantPricePaise(variant) < variantPricePaise(best) ? variant : best);
      const pricePaise = variantPricePaise(cheapest);
      const regularPaise = Math.round(Number(cheapest.regularPricePaise ?? 0));
      const onSale = cheapest.onSale === true && regularPaise > pricePaise;
      card = {
        ...card,
        price: pricePaise / 100,
        priceDisplay: formatOptionPaise(pricePaise),
        inStock: matching.some((variant) => variant.inStock),
        ...(onSale
          ? { regularPrice: regularPaise / 100, wasPriceDisplay: formatOptionPaise(regularPaise) }
          : {}),
      };
    }
  }

  if (selection.colours.length === 1) {
    const photo = photoForColour(card.photoColours, selection.colours[0]);
    if (photo) card = { ...card, image: photo };
  }

  return card;
}

/** Label for one selected value, used by the active-filter chips. */
export function filterValueLabel(
  products: readonly CollectionProduct[],
  kind: CollectionFilterKind,
  id: string,
): string {
  if (kind === 'model') {
    for (const product of products) {
      const model = productModels(product).find((entry) => entry.id === id);
      if (model) return model.name;
    }
    return id;
  }
  if (kind === 'colour') {
    for (const product of products) {
      const colour = productColours(product).find((entry) => entry.id === id);
      if (colour) return colour.name;
    }
    return id;
  }
  return PRICE_BANDS.find((band) => band.id === id)?.label ?? id;
}

/** Compatibility models travel with shared-stock cards only. */
export function compatibilityModelIds(product: CollectionProduct): string[] {
  return product.inventoryMode === 'variant'
    ? []
    : (product.compatibilityModels ?? []).map((model: StorefrontCompatibilityModel) => model.id);
}

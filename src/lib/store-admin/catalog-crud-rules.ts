/** Pure validation for catalogue writes. No database, no framework. */

import { slugify } from './catalog-rules';
import { isSellBy, type SellBy } from './options-table-rules';
import { parseMetadataInput, type MetadataInput } from '@/lib/catalog/product-metadata-rules';
import {
  MAX_PRICE_PAISE,
  belowCostWarning,
  formatRupees,
  salePriceProblem,
} from './money';

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown, max: number, label: string): FieldResult<string> {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be text.` };
  const result = value.trim();
  if (result.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: result };
}

function boundedInt(
  value: unknown,
  min: number,
  max: number,
  label: string,
): FieldResult<number> {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false, error: `${label} must be a whole number between ${min} and ${max}.` };
  }
  return { ok: true, value: parsed };
}

/** Money fields are paise on the wire, but errors talk in rupees. */
function boundedPaise(
  value: unknown,
  min: number,
  max: number,
  label: string,
): FieldResult<number> {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      error: `${label} must be between ${formatRupees(min)} and ${formatRupees(max)}.`,
    };
  }
  return { ok: true, value: parsed };
}

function optionalId(value: unknown): string | null {
  const result = trimmed(value);
  return result && ID_RE.test(result) ? result : null;
}

/* ------------------------------------------------------------ categories */

export interface CategoryInput {
  id?: string;
  slug: string;
  name: string;
  parentId: string | null;
  title: string;
  subhead: string;
  navLabel: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  isActive: boolean;
}

export function validateCategoryInput(input: unknown): FieldResult<CategoryInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the category fields as a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  const name = trimmed(body.name);
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'A category name is required (1–80 characters).' };
  }

  const rawSlug = trimmed(body.slug);
  const slug = rawSlug || slugify(name);
  if (slug.length > 80 || !SLUG_RE.test(slug)) {
    return { ok: false, error: 'The slug may only use lowercase letters, numbers and single dashes.' };
  }

  const id = body.id === undefined ? undefined : trimmed(body.id);
  if (id !== undefined && !ID_RE.test(id)) {
    return { ok: false, error: 'The category id is not valid.' };
  }

  const parentId = optionalId(body.parentId);
  if (trimmed(body.parentId) && !parentId) {
    return { ok: false, error: 'Pick a valid parent category.' };
  }
  if (id && parentId === id) {
    return { ok: false, error: 'A category cannot be its own parent.' };
  }

  const title = optionalText(body.title, 140, 'The category title');
  if (!title.ok) return title;
  const subhead = optionalText(body.subhead, 300, 'The subhead');
  if (!subhead.ok) return subhead;
  const navLabel = optionalText(body.navLabel, 60, 'The nav label');
  if (!navLabel.ok) return navLabel;
  const seoTitle = optionalText(body.seoTitle, 120, 'The SEO title');
  if (!seoTitle.ok) return seoTitle;
  const seoDescription = optionalText(body.seoDescription, 320, 'The SEO description');
  if (!seoDescription.ok) return seoDescription;

  const sortOrder = boundedInt(body.sortOrder ?? 0, 0, 9999, 'Sort order');
  if (!sortOrder.ok) return sortOrder;

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      slug,
      name,
      parentId,
      title: title.value,
      subhead: subhead.value,
      navLabel: navLabel.value,
      seoTitle: seoTitle.value,
      seoDescription: seoDescription.value,
      sortOrder: sortOrder.value,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    },
  };
}

/**
 * True when re-parenting `nodeId` under `newParentId` would create a loop.
 * `parentOf` is the current tree: every id mapped to its parent (or null).
 */
export function createsCategoryCycle(
  parentOf: Map<string, string | null>,
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/* ------------------------------------------------------------ conditions */

export interface ConditionInput {
  id?: string;
  label: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export function validateConditionInput(input: unknown): FieldResult<ConditionInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the condition fields as a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  const label = trimmed(body.label);
  if (label.length < 1 || label.length > 80) {
    return { ok: false, error: 'A condition label is required (1–80 characters).' };
  }

  const id = body.id === undefined ? undefined : trimmed(body.id);
  if (id !== undefined && !ID_RE.test(id)) {
    return { ok: false, error: 'The condition id is not valid.' };
  }

  const description = optionalText(body.description, 300, 'The description');
  if (!description.ok) return description;

  const sortOrder = boundedInt(body.sortOrder ?? 0, 0, 9999, 'Sort order');
  if (!sortOrder.ok) return sortOrder;

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      label,
      description: description.value,
      sortOrder: sortOrder.value,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    },
  };
}

/* -------------------------------------------------------------- products */

export interface NewProductInput extends MetadataInput {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  categoryId: string;
  pricePaise: number;
  compareAtPaise: number | null;
  brand: string;
  brandId: string | null;
  conditionId: string | null;
  material: string;
  description: string;
  badge: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
  isGiftOnly: boolean;
  trackInventory: boolean;
  initialOnHand: number;
  /** Which options table the editor shows. Never rewrites saved rows. */
  sellBy: SellBy;
  /** Editable SKU suggestion pattern; null uses the default. */
  skuPattern: string | null;
}

export const PRICE_MAX_PAISE = MAX_PRICE_PAISE;

export function validateNewProductInput(input: unknown): FieldResult<NewProductInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the product fields as a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  const name = trimmed(body.name);
  if (name.length < 1 || name.length > 140) {
    return { ok: false, error: 'A product name is required (1–140 characters).' };
  }

  const rawSlug = trimmed(body.slug);
  const slug = rawSlug || slugify(name);
  if (slug.length > 80 || !SLUG_RE.test(slug)) {
    return { ok: false, error: 'The slug may only use lowercase letters, numbers and single dashes.' };
  }

  const categoryId = optionalId(body.categoryId);
  if (!categoryId) return { ok: false, error: 'Pick a category for the product.' };

  const pricePaise = boundedPaise(body.pricePaise, 1, PRICE_MAX_PAISE, 'Selling price');
  if (!pricePaise.ok) return pricePaise;

  let compareAtPaise: number | null = null;
  if (body.compareAtPaise !== undefined && body.compareAtPaise !== null && body.compareAtPaise !== '') {
    const parsed = boundedPaise(body.compareAtPaise, 0, PRICE_MAX_PAISE, 'Compare-at price');
    if (!parsed.ok) return parsed;
    compareAtPaise = parsed.value;
  }
  const pricePair = checkPricePair(pricePaise.value, compareAtPaise);
  if (pricePair) return { ok: false, error: pricePair };

  const subtitle = optionalText(body.subtitle, 200, 'The subtitle');
  if (!subtitle.ok) return subtitle;
  const material = optionalText(body.material, 120, 'The material');
  if (!material.ok) return material;
  const brandLabel = optionalText(body.brand, 80, 'The brand label');
  if (!brandLabel.ok) return brandLabel;
  const description = optionalText(body.description, 5000, 'The description');
  if (!description.ok) return description;
  const badge = optionalText(body.badge, 40, 'The badge');
  if (!badge.ok) return badge;
  const seoTitle = optionalText(body.seoTitle, 120, 'The SEO title');
  if (!seoTitle.ok) return seoTitle;
  const seoDescription = optionalText(body.seoDescription, 320, 'The SEO description');
  if (!seoDescription.ok) return seoDescription;

  const initialOnHand = boundedInt(body.initialOnHand ?? 0, 0, 100_000, 'The opening stock');
  if (!initialOnHand.ok) return initialOnHand;
  let metadata: MetadataInput;
  try { metadata = parseMetadataInput(body); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Invalid product metadata.' }; }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') return {ok:false,error:'Visibility must be true or false.'};
  if (body.isGiftOnly !== undefined && typeof body.isGiftOnly !== 'boolean') return {ok:false,error:'Gift-only flag must be true or false.'};
  if (body.sellBy !== undefined && !isSellBy(body.sellBy)) return {ok:false,error:'Choose how this product is sold.'};
  const skuPattern = optionalText(body.skuPattern, 120, 'The SKU pattern');
  if (!skuPattern.ok) return skuPattern;

  return {
    ok: true,
    value: {
      id: slug,
      slug,
      name,
      subtitle: subtitle.value,
      categoryId,
      pricePaise: pricePaise.value,
      compareAtPaise,
      brand: brandLabel.value,
      brandId: optionalId(body.brandId),
      conditionId: optionalId(body.conditionId),
      material: material.value,
      description: description.value,
      badge: badge.value,
      seoTitle: seoTitle.value,
      seoDescription: seoDescription.value,
      isActive: body.isActive === undefined ? false : body.isActive,
      isGiftOnly: body.isGiftOnly === true,
      ...metadata,
      trackInventory: body.trackInventory === true,
      initialOnHand: initialOnHand.value,
      sellBy: isSellBy(body.sellBy) ? body.sellBy : 'single',
      skuPattern: skuPattern.value || null,
    },
  };
}

/** `null` when the pair is fine, otherwise the reason. */
export function checkPricePair(pricePaise: number, compareAtPaise: number | null): string | null {
  if (!Number.isInteger(pricePaise) || pricePaise < 0) return 'The selling price must be a whole number of paise.';
  if (pricePaise > PRICE_MAX_PAISE) return 'The selling price is above the allowed maximum.';
  if (compareAtPaise === null) return null;
  if (!Number.isInteger(compareAtPaise) || compareAtPaise < 0) {
    return 'The compare-at price must be a whole number of paise.';
  }
  if (compareAtPaise > PRICE_MAX_PAISE) return 'The compare-at price is above the allowed maximum.';
  if (compareAtPaise < pricePaise) return 'The compare-at price cannot be below the selling price.';
  return null;
}

export interface PricePatch {
  pricePaise?: number;
  compareAtPaise?: number | null;
  /** `null` clears the sale price; omitted leaves it unchanged. */
  salePricePaise?: number | null;
}

export function validatePricePatch(input: unknown): FieldResult<PricePatch> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the price fields as a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  const value: PricePatch = {};

  if (body.pricePaise !== undefined) {
    const price = boundedPaise(body.pricePaise, 1, PRICE_MAX_PAISE, 'Selling price');
    if (!price.ok) return price;
    value.pricePaise = price.value;
  }

  if (body.compareAtPaise !== undefined) {
    if (body.compareAtPaise === null || body.compareAtPaise === '') {
      value.compareAtPaise = null;
    } else {
      const compareAt = boundedPaise(body.compareAtPaise, 0, PRICE_MAX_PAISE, 'Compare-at price');
      if (!compareAt.ok) return compareAt;
      value.compareAtPaise = compareAt.value;
    }
  }

  if (body.salePricePaise !== undefined) {
    if (body.salePricePaise === null || body.salePricePaise === '') {
      value.salePricePaise = null;
    } else {
      const sale = boundedPaise(body.salePricePaise, 1, PRICE_MAX_PAISE, 'Sale price');
      if (!sale.ok) return sale;
      value.salePricePaise = sale.value;
    }
  }

  if (
    value.pricePaise === undefined
    && value.compareAtPaise === undefined
    && value.salePricePaise === undefined
  ) {
    return { ok: false, error: 'Send a selling price, a compare-at price, a sale price, or a combination.' };
  }
  return { ok: true, value };
}

/**
 * Sale-specific checks that need the whole price pair. Returns an error when
 * the sale price cannot be stored, or a warning when it is allowed but risky
 * (below cost). A warning never blocks the write.
 */
export function checkSalePrice(args: {
  salePaise: number | null;
  regularPaise: number;
  costPaise: number | null;
}): { error: string | null; warning: string | null } {
  const { salePaise, regularPaise, costPaise } = args;
  if (salePaise === null) return { error: null, warning: null };

  const error = salePriceProblem(salePaise, regularPaise);
  if (error) return { error, warning: null };
  return { error: null, warning: belowCostWarning(salePaise, costPaise) };
}

/* -------------------------------------------------------------- variants */

export interface VariantInput {
  id?: string;
  sku: string | null;
  optionName: string;
  optionValue: string;
  optionHex: string | null;
  /** Omitted means "leave the saved price unchanged"; null means "use the base price". */
  priceOverridePaise?: number | null;
  salePricePaise?: number | null;
  isPurchasable?: boolean;
  deviceModelId?: string | null;
  combinationKey?: string | null;
  /** Explicit normalized option value, never inferred from a model display label. */
  optionIdentity?: string | null;
  /**
   * The shared colour this option row sells, by `colours.id`. This is the only
   * colour identity the storefront reads; it is never inferred from the option
   * label or hex. Omitted means "leave the saved link untouched", and links are
   * append-only — correcting one means archiving and replacing the option.
   */
  colourId?: string | null;
  /** Owned saved variant to retire; only valid when creating a new identity. */
  replacesVariantId?: string;
  /** The person confirmed a large option price change. Never sent by default. */
  confirmLargeChange?: boolean;
  isActive: boolean;
  sortOrder: number;
}

export function validateVariantInput(input: unknown): FieldResult<VariantInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the variant fields as a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  const optionName = trimmed(body.optionName) || 'Colour';
  if (optionName.length > 40) return { ok: false, error: 'The option name must be 40 characters or fewer.' };

  const optionValue = trimmed(body.optionValue);
  if (optionValue.length < 1 || optionValue.length > 60) {
    return { ok: false, error: 'An option value is required (1–60 characters).' };
  }

  const rawSku = trimmed(body.sku);
  let sku: string | null = null;
  if (rawSku) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(rawSku)) {
      return { ok: false, error: 'The SKU may only use letters, numbers and dashes.' };
    }
    sku = rawSku.toUpperCase();
  }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') return {ok:false,error:'Active must be true or false.'};
  if (body.isPurchasable !== undefined && typeof body.isPurchasable !== 'boolean') return {ok:false,error:'Purchasable must be true or false.'};
  const deviceModelId = trimmed(body.deviceModelId) || null;
  const combinationKey = trimmed(body.combinationKey) || null;
  if (deviceModelId && !ID_RE.test(deviceModelId)) return {ok:false,error:'Invalid device model identity.'};
  if (combinationKey && combinationKey.length > 160) return {ok:false,error:'Combination key must be 160 characters or fewer.'};
  if (body.isPurchasable === true && (!sku || (!combinationKey && body.replacesVariantId === undefined))) return {ok:false,error:'Purchasable combinations require a SKU and stable combination key.'};
  if (body.optionIdentity !== undefined && body.optionIdentity !== null && (typeof body.optionIdentity !== 'string' || !body.optionIdentity.trim() || body.optionIdentity.trim().length > 100)) return {ok:false,error:'Option identity must contain 1–100 characters.'};
  const optionIdentity = body.optionIdentity == null ? null : (body.optionIdentity as string).trim().replace(/\s+/g, ' ').toLowerCase();
  if (body.replacesVariantId !== undefined && (typeof body.replacesVariantId !== 'string' || !ID_RE.test(body.replacesVariantId) || body.id !== undefined)) return {ok:false,error:'Replacement must name a saved variant and create a new identity.'};
  const rawHex = trimmed(body.optionHex);
  if (rawHex && !HEX_RE.test(rawHex)) {
    return { ok: false, error: 'The colour must be a hex value such as #1f2937.' };
  }

  // Colour identity is a reference to a shared colour row, never a label or a
  // hex value typed into this form. An empty value means "no colour link".
  const rawColourId = trimmed(body.colourId);
  const colourId = rawColourId || null;
  if (body.colourId !== undefined && body.colourId !== null && typeof body.colourId !== 'string') {
    return { ok: false, error: 'Choose a shared colour for this option.' };
  }
  if (colourId && !ID_RE.test(colourId)) {
    return { ok: false, error: 'Choose a shared colour for this option.' };
  }

  let priceOverridePaise: number | null | undefined;
  if (body.priceOverridePaise !== undefined) {
    if (body.priceOverridePaise === null || body.priceOverridePaise === '') {
      priceOverridePaise = null;
    } else {
      const parsed = boundedPaise(body.priceOverridePaise, 1, PRICE_MAX_PAISE, 'Option price');
      if (!parsed.ok) return parsed;
      priceOverridePaise = parsed.value;
    }
  }
  if (body.confirmLargeChange !== undefined && typeof body.confirmLargeChange !== 'boolean') return {ok:false,error:'Price change confirmation must be true or false.'};
  let salePricePaise: number | null | undefined;
  if (body.salePricePaise !== undefined) {
    if (body.salePricePaise === null || body.salePricePaise === '') {
      salePricePaise = null;
    } else {
      const parsed = boundedPaise(body.salePricePaise, 1, PRICE_MAX_PAISE, 'Option sale price');
      if (!parsed.ok) return parsed;
      salePricePaise = parsed.value;
    }
  }

  const sortOrder = boundedInt(body.sortOrder ?? 0, 0, 9999, 'Sort order');
  if (!sortOrder.ok) return sortOrder;

  const id = body.id === undefined ? undefined : trimmed(body.id);
  if (id !== undefined && !ID_RE.test(id)) {
    return { ok: false, error: 'The variant id is not valid.' };
  }

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      sku,
      optionName,
      optionValue,
      optionHex: rawHex ? rawHex.toLowerCase() : null,
      ...(body.isPurchasable === undefined ? {} : {isPurchasable:body.isPurchasable as boolean}),
      ...(body.deviceModelId === undefined ? {} : {deviceModelId}),
      ...(body.combinationKey === undefined ? {} : {combinationKey}),
      ...(body.optionIdentity === undefined ? {} : {optionIdentity}),
      ...(body.colourId === undefined ? {} : {colourId}),
      ...(body.replacesVariantId === undefined ? {} : {replacesVariantId:body.replacesVariantId as string}),
      ...(priceOverridePaise === undefined ? {} : {priceOverridePaise}),
      ...(salePricePaise === undefined ? {} : {salePricePaise}),
      ...(body.confirmLargeChange === undefined ? {} : {confirmLargeChange:body.confirmLargeChange as boolean}),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder: sortOrder.value,
    },
  };
}

/* ----------------------------------------------------------------- stock */

export const MANUAL_STOCK_REASONS = ['receipt', 'adjustment', 'damage'] as const;
export type ManualStockReason = (typeof MANUAL_STOCK_REASONS)[number];

export function isManualStockReason(value: unknown): value is ManualStockReason {
  return typeof value === 'string' && (MANUAL_STOCK_REASONS as readonly string[]).includes(value);
}

export interface StockAdjustmentInput {
  delta: number;
  reason: ManualStockReason;
  note: string;
}

export function validateStockAdjustment(input: unknown): FieldResult<StockAdjustmentInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the adjustment as a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  const delta = boundedInt(body.delta, -100_000, 100_000, 'The change');
  if (!delta.ok) return delta;
  if (delta.value === 0) return { ok: false, error: 'The change cannot be zero.' };

  if (!isManualStockReason(body.reason)) {
    return { ok: false, error: 'Pick a reason: receipt, adjustment or damage.' };
  }

  const note = optionalText(body.note, 200, 'The note');
  if (!note.ok) return note;

  return { ok: true, value: { delta: delta.value, reason: body.reason, note: note.value } };
}

export interface StockSettingsInput {
  trackInventory: boolean;
  lowStockThreshold: number;
  /**
   * The opening count when tracking is switched on for a product that has no
   * stock row yet. Null when the caller did not send one. Ignored once a row
   * exists — later changes go through `adjustStock` so they are recorded as
   * movements rather than overwriting the count.
   */
  onHand: number | null;
}

export function validateStockSettings(input: unknown): FieldResult<StockSettingsInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the stock settings as a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  const threshold = boundedInt(body.lowStockThreshold ?? 0, 0, 1_000_000, 'The low-stock threshold');
  if (!threshold.ok) return threshold;

  const rawOnHand = body.onHand;
  const onHand = rawOnHand === undefined || rawOnHand === null || rawOnHand === ''
    ? { ok: true as const, value: null }
    : boundedInt(rawOnHand, 0, 1_000_000, 'The on-hand count');
  if (!onHand.ok) return onHand;

  return {
    ok: true,
    value: {
      trackInventory: body.trackInventory === true,
      lowStockThreshold: threshold.value,
      onHand: onHand.value,
    },
  };
}

/** A sale is unavailable when tracking is on and nothing is left to sell. */
export function stockAvailable(onHand: number, reserved: number): number {
  return Math.max(0, Math.trunc(onHand) - Math.trunc(reserved));
}

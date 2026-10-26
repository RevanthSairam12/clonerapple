/** Pure validation for catalogue writes. No database, no framework. */

import { slugify } from './catalog-rules';

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

export interface NewProductInput {
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
  trackInventory: boolean;
  initialOnHand: number;
}

export const PRICE_MAX_PAISE = 1_000_000_00; // ₹10,00,000

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

  const pricePaise = boundedInt(body.pricePaise, 1, PRICE_MAX_PAISE, 'The selling price');
  if (!pricePaise.ok) return pricePaise;

  let compareAtPaise: number | null = null;
  if (body.compareAtPaise !== undefined && body.compareAtPaise !== null && body.compareAtPaise !== '') {
    const parsed = boundedInt(body.compareAtPaise, 0, PRICE_MAX_PAISE, 'The compare-at price');
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
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      trackInventory: body.trackInventory === true,
      initialOnHand: initialOnHand.value,
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
}

export function validatePricePatch(input: unknown): FieldResult<PricePatch> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the price fields as a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  const value: PricePatch = {};

  if (body.pricePaise !== undefined) {
    const price = boundedInt(body.pricePaise, 1, PRICE_MAX_PAISE, 'The selling price');
    if (!price.ok) return price;
    value.pricePaise = price.value;
  }

  if (body.compareAtPaise !== undefined) {
    if (body.compareAtPaise === null || body.compareAtPaise === '') {
      value.compareAtPaise = null;
    } else {
      const compareAt = boundedInt(body.compareAtPaise, 0, PRICE_MAX_PAISE, 'The compare-at price');
      if (!compareAt.ok) return compareAt;
      value.compareAtPaise = compareAt.value;
    }
  }

  if (value.pricePaise === undefined && value.compareAtPaise === undefined) {
    return { ok: false, error: 'Send a selling price, a compare-at price, or both.' };
  }
  return { ok: true, value };
}

/* -------------------------------------------------------------- variants */

export interface VariantInput {
  id?: string;
  sku: string | null;
  optionName: string;
  optionValue: string;
  optionHex: string | null;
  priceOverridePaise: number | null;
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

  const rawHex = trimmed(body.optionHex);
  if (rawHex && !HEX_RE.test(rawHex)) {
    return { ok: false, error: 'The colour must be a hex value such as #1f2937.' };
  }

  let priceOverridePaise: number | null = null;
  if (body.priceOverridePaise !== undefined && body.priceOverridePaise !== null && body.priceOverridePaise !== '') {
    const parsed = boundedInt(body.priceOverridePaise, 1, PRICE_MAX_PAISE, 'The price override');
    if (!parsed.ok) return parsed;
    priceOverridePaise = parsed.value;
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
      priceOverridePaise,
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
}

export function validateStockSettings(input: unknown): FieldResult<StockSettingsInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the stock settings as a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  const threshold = boundedInt(body.lowStockThreshold ?? 0, 0, 1_000_000, 'The low-stock threshold');
  if (!threshold.ok) return threshold;
  return { ok: true, value: { trackInventory: body.trackInventory === true, lowStockThreshold: threshold.value } };
}

/** A sale is unavailable when tracking is on and nothing is left to sell. */
export function stockAvailable(onHand: number, reserved: number): number {
  return Math.max(0, Math.trunc(onHand) - Math.trunc(reserved));
}

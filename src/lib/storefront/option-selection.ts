/**
 * Customer option rules: the two-step model → colour selector, the exact price
 * and availability of one row, the colour gallery and the shareable URL state.
 *
 * Pure and framework-free. The server catalogue decides which rows exist; this
 * module never invents a model × colour combination, never substitutes a
 * sibling row and never treats presentation as a stock permission. The locked
 * rules live here so the page and its tests share one implementation:
 *
 * - normal mode: a sold-out exact row is offered, disabled, "Stock not available";
 * - sale mode: nothing is disabled or marked unavailable; the check happens at
 *   Add to Bag, Buy Now and Pay, and the message names the exact option.
 */

import { STOCK_NOT_AVAILABLE, stockBlocked } from './availability-rules';

/** The subset of a purchasable variant these rules read. */
export interface OptionVariant {
  id: string;
  sku?: string | null;
  /** The stored row label, e.g. "iPhone 16 / Red". */
  label?: string | null;
  deviceModelId?: string | null;
  deviceModelName?: string | null;
  optionName?: string | null;
  optionValue?: string | null;
  colourId?: string | null;
  colourName?: string | null;
  colourHex?: string | null;
  pricePaise: number;
  regularPricePaise?: number;
  salePricePaise?: number | null;
  onSale?: boolean;
  inStock: boolean;
}

export interface StorefrontPhoto {
  url: string;
  alt?: string;
  colourId?: string | null;
  role?: string;
  sortOrder?: number;
}

export interface OptionSelection {
  modelKey: string | null;
  colourKey: string | null;
}

export interface OptionColour {
  key: string;
  label: string;
  hex: string;
}

export interface OptionModel {
  key: string;
  label: string;
  colours: OptionColour[];
  /** Variant rows this model actually has, linked and unlinked alike. */
  rowCount: number;
  /**
   * Whether a customer can name exactly one row for this model.
   *
   * A model with colours is chosen through its colour step. A model with a
   * single row is that row. A model with several rows and no colour links
   * cannot be resolved without guessing, so it is not selectable: the
   * catalogue data is incomplete and must be corrected by the owner.
   */
  selectable: boolean;
}

export interface OptionSteps {
  models: OptionModel[];
  /** Colours when the product has no model step (colour-only products). */
  colours: OptionColour[];
  /** "Model", or the option's own name such as "Wattage". */
  modelLabel: string;
  showModel: boolean;
  showColour: boolean;
}

export interface OptionPrice {
  unitPaise: number;
  regularPaise: number | null;
  onSale: boolean;
}

export interface OptionStock {
  blocked: boolean;
  selectable: boolean;
  low: boolean;
  label: string | null;
}

export interface GalleryPhoto {
  url: string;
  alt: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeHex(value: unknown): string {
  const hex = clean(value);
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : '#D2D2D7';
}

function isColourName(name: string): boolean {
  return name === 'colour' || name === 'color';
}

/**
 * The stable key of the first step.
 *
 * A device model uses its shared id. "By another option" (wattage, size) uses
 * `option:<name>:<value>`. A colour-only product has no first step at all.
 */
export function optionModelKey(variant: OptionVariant): string | null {
  const deviceModelId = clean(variant.deviceModelId);
  if (deviceModelId) return deviceModelId;
  const optionName = clean(variant.optionName).toLowerCase();
  const optionValue = clean(variant.optionValue);
  if (optionName && !isColourName(optionName) && optionValue) return `option:${optionName}:${optionValue}`;
  return null;
}

export function optionModelLabel(variant: OptionVariant): string {
  if (clean(variant.deviceModelId)) {
    return clean(variant.deviceModelName) || clean(variant.optionValue) || clean(variant.deviceModelId);
  }
  return clean(variant.optionValue) || clean(variant.deviceModelName) || 'Standard';
}

/** The shared colour id; free-text option values are never a colour identity. */
export function optionColourKey(variant: OptionVariant): string | null {
  return clean(variant.colourId) || null;
}

function colourOf(variant: OptionVariant): OptionColour | null {
  const key = optionColourKey(variant);
  if (!key) return null;
  return {
    key,
    // The shared colour record supplies the name. The option's free text is
    // never a stand-in for it, because that text is not colour identity.
    label: clean(variant.colourName) || 'Colour',
    hex: normalizeHex(variant.colourHex),
  };
}

function pushColour(into: OptionColour[], colour: OptionColour | null): void {
  if (colour && !into.some((entry) => entry.key === colour.key)) into.push(colour);
}

/**
 * The steps a product actually has. Only the supplied (active, configured)
 * rows contribute: a combination that does not exist is never offered.
 */
export function optionSteps(variants: readonly OptionVariant[]): OptionSteps {
  const models: OptionModel[] = [];
  const looseColours: OptionColour[] = [];
  let optionName = '';

  for (const variant of variants) {
    const modelKey = optionModelKey(variant);
    const colour = colourOf(variant);
    if (modelKey) {
      let model = models.find((entry) => entry.key === modelKey);
      if (!model) {
        model = { key: modelKey, label: optionModelLabel(variant), colours: [], rowCount: 0, selectable: false };
        models.push(model);
      }
      model.rowCount += 1;
      pushColour(model.colours, colour);
      if (!optionName && !clean(variant.deviceModelId)) optionName = clean(variant.optionName);
    } else {
      pushColour(looseColours, colour);
    }
  }
  // Only a model the customer can name exactly one row for is offered. Colours
  // carry shared-colour identity, so they are the only discriminator; a lone
  // row needs none. Several rows with no colour links are an incomplete
  // catalogue, never an invitation to pick the first row.
  for (const model of models) model.selectable = model.colours.length > 0 || model.rowCount === 1;

  const showModel = models.length > 0;
  const showColour = showModel
    ? models.some((model) => model.colours.length > 0)
    : looseColours.length > 0;

  const modelLabel = optionName
    ? `${optionName.charAt(0).toUpperCase()}${optionName.slice(1).toLowerCase()}`
    : 'Model';

  return { models, colours: looseColours, modelLabel, showModel, showColour };
}

/**
 * The one variant a completed selection names, or undefined.
 *
 * A variant without a first-step key participates regardless of the model
 * choice; a variant that has one must match exactly. The same holds for the
 * colour. That is what keeps Add to Bag from substituting a sibling option.
 */
export function resolveOptionVariant(
  variants: readonly OptionVariant[],
  selection: OptionSelection,
): OptionVariant | undefined {
  const modelKey = selection.modelKey ?? null;
  const colourKey = selection.colourKey ?? null;
  // Both identities must match exactly, and the match must be unique. A
  // selection that names no colour must never fall through to "whichever row
  // came first": two rows sharing a model are told apart only by their shared
  // colour, so an unlinked pair is ambiguous and resolves to nothing.
  const matches = variants.filter((variant) =>
    optionModelKey(variant) === modelKey && optionColourKey(variant) === colourKey);
  return matches.length === 1 ? matches[0] : undefined;
}

export function optionSelectionComplete(
  variants: readonly OptionVariant[],
  selection: OptionSelection,
): boolean {
  return Boolean(resolveOptionVariant(variants, selection));
}

/**
 * What the page starts with.
 *
 * A product with one real row is already chosen. A product with one model
 * shows its colours immediately; if that model has one colour the row is
 * complete. Everything else waits for the customer, so the price can say
 * "From" instead of guessing a row.
 */
export function defaultOptionSelection(variants: readonly OptionVariant[]): OptionSelection {
  if (variants.length === 0) return { modelKey: null, colourKey: null };
  if (variants.length === 1) {
    return { modelKey: optionModelKey(variants[0]), colourKey: optionColourKey(variants[0]) };
  }
  const steps = optionSteps(variants);
  if (steps.models.length === 1) {
    const model = steps.models[0];
    return {
      modelKey: model.key,
      colourKey: model.colours.length === 1 ? model.colours[0].key : null,
    };
  }
  if (!steps.showModel && steps.colours.length === 1) {
    return { modelKey: null, colourKey: steps.colours[0].key };
  }
  return { modelKey: null, colourKey: null };
}

/** Parse `?model=` / `?colour=`; unknown values fall back instead of guessing. */
export function optionSelectionFromSearch(
  variants: readonly OptionVariant[],
  search: string,
): OptionSelection {
  const raw = clean(search);
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const steps = optionSteps(variants);
  let modelKey: string | null = clean(params.get('model')) || null;
  let colourKey: string | null = clean(params.get('colour')) || null;

  if (modelKey && !steps.models.some((model) => model.key === modelKey && model.selectable)) {
    modelKey = null;
    colourKey = null;
  }
  if (colourKey) {
    const carrying = modelKey
      ? steps.models.filter((model) => model.key === modelKey && model.selectable)
      : steps.models.filter((model) => model.selectable && model.colours.some((colour) => colour.key === colourKey));
    const colours = modelKey
      ? carrying[0]?.colours ?? []
      : steps.showModel ? carrying.flatMap((model) => model.colours) : steps.colours;
    if (!colours.some((colour) => colour.key === colourKey)) {
      colourKey = null;
    } else if (!modelKey && carrying.length === 1) {
      // A colour link without a model restores the step when exactly one
      // model carries that colour; otherwise it stays a partial selection.
      modelKey = carrying[0].key;
    }
  }

  if (!modelKey && !colourKey) return defaultOptionSelection(variants);
  // A partial link is kept as partial: it must not silently complete a row.
  return { modelKey, colourKey };
}

export function optionQuery(selection: OptionSelection): string {
  const params = new URLSearchParams();
  if (selection.modelKey) params.set('model', selection.modelKey);
  if (selection.colourKey) params.set('colour', selection.colourKey);
  return params.toString();
}

/** Changing the first step always clears a colour that does not belong to it. */
export function selectModel(
  variants: readonly OptionVariant[],
  selection: OptionSelection,
  modelKey: string | null,
): OptionSelection {
  const steps = optionSteps(variants);
  const model = steps.models.find((entry) => entry.key === modelKey);
  // A model whose rows cannot be told apart is not a choice the customer can
  // make; keep the previous selection rather than record an unresolvable one.
  if (model && !model.selectable) return selection;
  if (model) {
    if (selection.colourKey && model.colours.some((colour) => colour.key === selection.colourKey)) {
      return { modelKey, colourKey: selection.colourKey };
    }
    // A model with one colour has only one row; choose it rather than leave a
    // dead end. Two or more colours always wait for an explicit choice.
    return { modelKey, colourKey: model.colours.length === 1 ? model.colours[0].key : null };
  }
  return { modelKey: steps.showModel ? null : modelKey, colourKey: steps.showModel ? null : selection.colourKey };
}

/**
 * The amount to show before and after a choice.
 *
 * Before a choice the headline is the cheapest exact row's amount — the same
 * price the catalogue shows on the card — never a "From" range, so the price a
 * customer first sees is a real buyable amount. Once a row is chosen the amount
 * and any strike-through come from that row alone.
 */
export function optionPrice(
  variants: readonly OptionVariant[],
  selection: OptionSelection,
  fallbackPaise = 0,
): OptionPrice {
  const selected = resolveOptionVariant(variants, selection)
    ?? variants.reduce<OptionVariant | undefined>((best, variant) =>
      !best || variant.pricePaise < best.pricePaise ? variant : best, undefined);
  if (!selected) {
    const unitPaise = Math.max(0, Math.round(fallbackPaise));
    return { unitPaise, regularPaise: null, onSale: false };
  }
  const unitPaise = Math.max(0, Math.round(selected.pricePaise));
  const regular = Math.round(Number(selected.regularPricePaise ?? 0));
  const onSale = selected.onSale === true && Number.isFinite(regular) && regular > unitPaise;
  return { unitPaise, regularPaise: onSale ? regular : null, onSale };
}

/**
 * Low stock is a server-side purchase decision. Exact per-option counts are
 * deliberately not part of the storefront payload, so the page never guesses.
 */
export function isLowOptionStock(_variant: OptionVariant): boolean {
  return false;
}

/**
 * The locked availability rule, from the catalogue read.
 * Sale mode never blocks presentation; the exact check runs at purchase.
 */
export function optionStock(variant: OptionVariant | undefined, saleLive: boolean): OptionStock {
  if (!variant) return { blocked: false, selectable: false, low: false, label: null };
  const blocked = stockBlocked(variant.inStock, saleLive);
  if (blocked) return { blocked: true, selectable: false, low: false, label: STOCK_NOT_AVAILABLE };
  return { blocked: false, selectable: true, low: isLowOptionStock(variant), label: null };
}

/**
 * The message for a rejected purchase of the exact selected row.
 *
 * Only called after Add to Bag / Buy Now / Pay refused, so sale mode never
 * shows it pre-emptively.
 */
export function optionStockMessage(variant: OptionVariant | undefined): string {
  return variant ? 'Out of stock for this option.' : STOCK_NOT_AVAILABLE;
}

function galleryRank(role: unknown): number {
  return clean(role) === 'primary' ? 0 : 1;
}

/**
 * The gallery for the chosen colour.
 *
 * Colour photos first (main first, then their order); a colour with no photos
 * keeps the product's default gallery; no colour shows the defaults. Hover
 * photos are never part of the customer gallery.
 */
export function galleryForSelection(
  images: readonly StorefrontPhoto[] | undefined,
  fallbackUrls: readonly string[],
  selection: OptionSelection,
  productName: string,
  colourLabel?: string | null,
): GalleryPhoto[] {
  const usable = (images ?? []).filter((photo) => clean(photo.url) && clean(photo.role) !== 'hover');
  const colourPhotos = selection.colourKey
    ? usable.filter((photo) => clean(photo.colourId) === selection.colourKey)
    : [];
  const defaults = usable.filter((photo) => !clean(photo.colourId));
  const chosen = colourPhotos.length > 0 ? colourPhotos : defaults;
  const sorted = [...chosen].sort((a, b) =>
    galleryRank(a.role) - galleryRank(b.role)
    || (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
    || clean(a.url).localeCompare(clean(b.url)));

  const altFallback = colourLabel ? `${productName} — ${colourLabel}` : productName;
  if (sorted.length > 0) {
    return sorted.map((photo) => ({ url: clean(photo.url), alt: clean(photo.alt) || altFallback }));
  }
  return [...new Set(fallbackUrls.map(clean).filter(Boolean))]
    .map((url) => ({ url, alt: altFallback }));
}

/** The colour name the screen reader announces for the selected row. */
export function selectedColourLabel(
  variants: readonly OptionVariant[],
  selection: OptionSelection,
): string | null {
  if (!selection.colourKey) return null;
  for (const variant of variants) {
    if (optionColourKey(variant) === selection.colourKey) {
      return colourOf(variant)?.label ?? null;
    }
  }
  return null;
}

/** Rupee display matching the storefront catalogue (`₹1,00,000.00`). */
export function formatOptionPaise(paise: number): string {
  const safe = Number.isFinite(paise) ? Math.max(0, Math.round(paise)) : 0;
  return `₹${(safe / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

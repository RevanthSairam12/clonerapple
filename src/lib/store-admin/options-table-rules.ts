/**
 * Pure rules for the one Options, price and stock table.
 *
 * No database and no framework: the product editor, the draft parser and the
 * tests all call these same functions, so the preview a person reviews is the
 * plan the server applies.
 */

import { normalizeOptionIdentity } from './product-option-combinations';

export type SellBy = 'single' | 'colour' | 'model' | 'model_colour' | 'other';

export const OPTION_ROW_CAP = 60;

export const SELL_BY_OPTIONS: ReadonlyArray<{ value: SellBy; label: string; help: string }> = [
  { value: 'single', label: 'One item', help: 'A single price and stock count, as today.' },
  { value: 'colour', label: 'By colour', help: 'One row for each colour you actually sell.' },
  { value: 'model', label: 'By model', help: 'One row for each phone model you actually sell.' },
  { value: 'model_colour', label: 'By model and colour', help: 'One row for each real model and colour pair.' },
  { value: 'other', label: 'By another option', help: 'A name of your own, such as Wattage, with its values.' },
];

export function isSellBy(value: unknown): value is SellBy {
  return typeof value === 'string' && SELL_BY_OPTIONS.some((option) => option.value === value);
}

export function sellByUsesColour(sellBy: SellBy): boolean {
  return sellBy === 'colour' || sellBy === 'model_colour';
}

export function sellByUsesModel(sellBy: SellBy): boolean {
  return sellBy === 'model' || sellBy === 'model_colour';
}

export interface OptionModel {
  id: string;
  name: string;
  brandId?: string;
  brandName?: string;
  isActive?: boolean;
}

export interface OptionColour {
  id: string;
  name: string;
  hex: string;
  isActive?: boolean;
}

export interface GeneratedOptionRow {
  deviceModelId: string | null;
  colourId: string | null;
  optionName: string;
  optionValue: string;
  optionIdentity: string;
}

function labelFor(models: OptionModel[], model: OptionModel): string {
  const ambiguous = models.some(
    (other) => other.id !== model.id && normalizeOptionIdentity(other.name) === normalizeOptionIdentity(model.name),
  );
  return ambiguous && model.brandName ? `${model.brandName} ${model.name}` : model.name;
}

function valueFromOther(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  return (values ?? [])
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .filter((value) => {
      const identity = normalizeOptionIdentity(value);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

/**
 * Build the rows a selection would create. The result is a plan only: it is
 * never applied until the owner reviews it, and only missing rows are added.
 */
export function generateOptionRows(input: {
  sellBy: SellBy;
  models?: OptionModel[];
  colours?: OptionColour[];
  otherName?: string;
  otherValues?: string[];
}): GeneratedOptionRow[] {
  const models = (input.models ?? []).filter((model) => model.isActive !== false);
  const colours = (input.colours ?? []).filter((colour) => colour.isActive !== false);
  let rows: GeneratedOptionRow[] = [];

  if (input.sellBy === 'colour') {
    rows = colours.map((colour) => ({
      deviceModelId: null,
      colourId: colour.id,
      optionName: 'Colour',
      optionValue: colour.name,
      optionIdentity: normalizeOptionIdentity(colour.name),
    }));
  } else if (input.sellBy === 'model') {
    rows = models.map((model) => ({
      deviceModelId: model.id,
      colourId: null,
      optionName: 'Model',
      optionValue: labelFor(models, model),
      optionIdentity: normalizeOptionIdentity(model.name),
    }));
  } else if (input.sellBy === 'model_colour') {
    rows = models.flatMap((model) =>
      colours.map((colour) => ({
        deviceModelId: model.id,
        colourId: colour.id,
        optionName: 'Model / Colour',
        optionValue: `${labelFor(models, model)} / ${colour.name}`,
        optionIdentity: normalizeOptionIdentity(colour.name),
      })),
    );
  } else if (input.sellBy === 'other') {
    const name = (input.otherName ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Enter the option name, such as Wattage.');
    if (name.length > 40) throw new Error('Keep the option name within 40 characters.');
    rows = valueFromOther(input.otherValues).map((value) => {
      if (value.length > 60) throw new Error('Keep each option value within 60 characters.');
      return {
        deviceModelId: null,
        colourId: null,
        optionName: name,
        optionValue: value,
        optionIdentity: normalizeOptionIdentity(value),
      };
    });
  }

  if (rows.length > OPTION_ROW_CAP) {
    throw new Error(`That would create ${rows.length} rows. Generate at most ${OPTION_ROW_CAP} at a time.`);
  }
  return rows;
}

export interface ExistingOptionKey {
  deviceModelId?: string | null;
  colourId?: string | null;
  optionName: string;
  optionValue: string;
  optionIdentity?: string | null;
}

function semanticKey(row: ExistingOptionKey): string {
  const identity = row.optionIdentity
    ? normalizeOptionIdentity(row.optionIdentity)
    : normalizeOptionIdentity(row.optionValue);
  return JSON.stringify([row.deviceModelId ?? '', normalizeOptionIdentity(row.optionName), identity]);
}

/**
 * Only combinations that do not already exist, including inactive rows.
 * Adding a colour or model later therefore proposes just the missing rows.
 */
export function missingOptionRows(
  existing: ExistingOptionKey[],
  generated: GeneratedOptionRow[],
): GeneratedOptionRow[] {
  const seen = new Set(existing.map(semanticKey));
  return generated.filter((row) => {
    const key = semanticKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Reason to ask for confirmation, or null. Never a block: the caller confirms
 * and saves. A drop over 50%, a rise over 100%, or a price below cost asks.
 */
export function largePriceChange(args: {
  oldPricePaise: number | null;
  newPricePaise: number;
  costPaise: number | null;
}): string | null {
  const { oldPricePaise, newPricePaise, costPaise } = args;
  const reasons: string[] = [];
  if (Number.isInteger(costPaise) && (costPaise as number) >= 0 && newPricePaise < (costPaise as number)) {
    reasons.push('the new price is below cost');
  }
  if (Number.isInteger(oldPricePaise) && (oldPricePaise as number) > 0 && newPricePaise !== oldPricePaise) {
    const old = oldPricePaise as number;
    if (newPricePaise < old && (old - newPricePaise) * 100 > old * 50) {
      reasons.push('the price drops by more than 50%');
    }
    if (newPricePaise > old && (newPricePaise - old) * 100 > old * 100) {
      reasons.push('the price rises by more than 100%');
    }
  }
  if (!reasons.length) return null;
  return `Please confirm this price change: ${reasons.join(' and ')}. It will still be saved once confirmed.`;
}

/** The price a row effectively uses: its own price, else the base price. */
export function effectiveOptionPaise(optionPricePaise: number | null, basePricePaise: number): number {
  const value = optionPricePaise === null || optionPricePaise === undefined ? basePricePaise : optionPricePaise;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : basePricePaise;
}

function skuPart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

/**
 * Suggest a SKU from an editable pattern. `{product}`, `{model}`, `{colour}`
 * and `{value}` are replaced; anything else is kept. The caller still checks
 * uniqueness — a suggestion is never assumed to be unique.
 */
export function suggestedSku(pattern: string, parts: {
  product?: string | null;
  model?: string | null;
  colour?: string | null;
  value?: string | null;
}): string {
  const source = pattern.trim() || '{product}-{model}-{colour}-{value}';
  const rendered = source
    .replace(/\{product\}/gi, skuPart(parts.product))
    .replace(/\{model\}/gi, skuPart(parts.model))
    .replace(/\{colour\}/gi, skuPart(parts.colour))
    .replace(/\{value\}/gi, skuPart(parts.value));
  const cleaned = rendered
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 64);
}

export interface OptionRowWarningInput {
  sku: string;
  pricePaise: number | null;
  basePricePaise: number;
  stockOnHand: number;
  trackInventory: boolean;
  isPurchasable: boolean;
}

/** Plain-word warnings shown on the row; none of them block a draft save. */
export function optionRowWarnings(row: OptionRowWarningInput, seenSkus: Set<string>): string[] {
  const warnings: string[] = [];
  const sku = row.sku.trim().toUpperCase();
  if (row.isPurchasable && !sku) warnings.push('No SKU yet.');
  else if (sku && seenSkus.has(sku)) warnings.push('This SKU is used by another row.');
  if (sku) seenSkus.add(sku);
  if (row.pricePaise === null || row.pricePaise === undefined) {
    warnings.push(`No price — uses the base price (${formatPaisePlain(row.basePricePaise)}).`);
  }
  if (row.isPurchasable && row.trackInventory && row.stockOnHand <= 0) {
    warnings.push('No stock available.');
  }
  return warnings;
}

function formatPaisePlain(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Colour swatches always carry their name, never colour alone. */
export function colourText(colour: { name: string; hex: string } | null | undefined): string {
  return colour ? `${colour.name} (${colour.hex})` : 'No colour';
}

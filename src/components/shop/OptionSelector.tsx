'use client';

import type { StorefrontPurchasableVariant } from '@/lib/catalog/storefront';
import {
  optionColourKey,
  optionModelKey,
  optionPrice,
  optionSteps,
  resolveOptionVariant,
  selectModel,
  selectedColourLabel,
  formatOptionPaise,
  type OptionModel,
  type OptionSelection,
  type OptionVariant,
} from '@/lib/storefront/option-selection';
import { STOCK_NOT_AVAILABLE, stockBlocked } from '@/lib/storefront/availability-rules';

/** Shown when several rows share a model but no shared colour tells them apart. */
const OPTIONS_INCOMPLETE = 'Option unavailable';

/**
 * The two-step customer selector: model first, then colour.
 *
 * Only the active rows the catalogue supplied are offered. A sold-out exact
 * row stays visible, is disabled and says "Stock not available" in normal
 * mode; sale mode never disables anything, because the exact stock check
 * happens at Add to Bag, Buy Now and Pay. A colour swatch always shows its
 * name, and the selected row is announced as text, never by colour alone.
 */
export function OptionSelector({ variants, selection, onChange, saleLive, liveStock }: {
  variants: StorefrontPurchasableVariant[];
  selection: OptionSelection;
  onChange: (selection: OptionSelection) => void;
  saleLive: boolean;
  liveStock?: Record<string, boolean>;
}) {
  const steps = optionSteps(variants);
  const stock = liveStock ?? {};
  const blockedFor = (variant: OptionVariant | undefined) =>
    Boolean(variant) && stockBlocked(stock[variant!.id] ?? variant!.inStock, saleLive);

  if (variants.length === 0) {
    return <p className="text-sm text-[#6e6e73] mb-6">No purchasable options are configured.</p>;
  }
  if (!steps.showModel && !steps.showColour) return null;

  const selectedVariant = resolveOptionVariant(variants, selection);
  const price = optionPrice(variants, selection);
  const colourLabel = selectedColourLabel(variants, selection);
  const chosenModel = steps.showModel ? steps.models.find((model) => model.key === selection.modelKey) ?? null : null;
  // Only the colours the chosen model's own rows carry. A model whose single
  // row has no colour link has no colour step at all.
  const colourChoices = steps.showModel ? chosenModel?.colours ?? [] : steps.colours;
  const announcement = selectedVariant
    ? [
        steps.showModel ? chosenModel?.label : null,
        colourLabel,
        formatOptionPaise(selectedVariant.pricePaise),
        blockedFor(selectedVariant) ? STOCK_NOT_AVAILABLE : 'in stock',
      ].filter(Boolean).join(', ')
    : `${steps.showModel && !selection.modelKey ? `Choose a ${steps.modelLabel.toLowerCase()}` : 'Choose a colour'}, ${formatOptionPaise(price.unitPaise)}`;

  const modelIsBlocked = (model: OptionModel) => {
    const rows = variants.filter((variant) => optionModelKey(variant) === model.key);
    return rows.length > 0 && rows.every((variant) => blockedFor(variant));
  };

  const colourButton = (model: OptionModel | null, key: string, label: string, hex: string) => {
    const modelKey = model ? model.key : null;
    const variant = resolveOptionVariant(variants, { modelKey, colourKey: key });
    const checked = selection.colourKey === key && (model === null || selection.modelKey === modelKey);
    const blocked = blockedFor(variant);
    return (
      <button
        key={`${modelKey ?? 'all'}:${key}`}
        type="button"
        role="radio"
        aria-checked={checked}
        disabled={blocked}
        aria-label={`${label}${blocked ? ` — ${STOCK_NOT_AVAILABLE}` : ''}`}
        onClick={() => onChange({ modelKey, colourKey: key })}
        className={`group relative flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all min-h-10 ${
          checked
            ? 'border-[#0071e3] bg-[#0071e3]/5 text-[#1d1d1f] ring-1 ring-[#0071e3]'
            : blocked
              ? 'border-[#e5e5ea] text-[#a1a1a6] cursor-not-allowed'
              : 'border-[#d2d2d7] hover:border-[#86868b] text-[#6e6e73]'
        }`}
      >
        <span className="w-4 h-4 rounded-full border border-black/10 shrink-0 shadow-xs" style={{ backgroundColor: hex }} aria-hidden="true" />
        <span>{label}</span>
        {blocked ? <span className="text-[11px] text-[#a1a1a6]">· {STOCK_NOT_AVAILABLE}</span> : null}
      </button>
    );
  };

  return (
    <div className="mb-6 space-y-5">
      {steps.showModel ? (
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-[#1d1d1f] mb-3">
            {steps.modelLabel}
            {selection.modelKey ? <span className="normal-case tracking-normal font-normal text-[#0071e3]"> — {chosenModel?.label}</span> : null}
          </legend>
          <div role="radiogroup" aria-label={steps.modelLabel} className="flex flex-wrap gap-2.5">
            {steps.models.map((model) => {
              const checked = selection.modelKey === model.key;
              // Two rows with no shared colour cannot be told apart. Offering
              // the model would silently buy whichever row sorted first, so it
              // stays disabled and says the option is being set up.
              const unavailable = !model.selectable;
              const blocked = unavailable || modelIsBlocked(model);
              const note = unavailable ? OPTIONS_INCOMPLETE : STOCK_NOT_AVAILABLE;
              return (
                <button
                  key={model.key}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={blocked}
                  aria-label={`${model.label}${blocked ? ` — ${note}` : ''}`}
                  onClick={() => onChange(selectModel(variants, selection, model.key))}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-medium transition-all min-h-10 ${
                    checked
                      ? 'border-[#0071e3] bg-[#0071e3]/5 text-[#1d1d1f] ring-1 ring-[#0071e3]'
                      : blocked
                        ? 'border-[#e5e5ea] text-[#a1a1a6] cursor-not-allowed'
                        : 'border-[#d2d2d7] hover:border-[#86868b] text-[#6e6e73]'
                  }`}
                >
                  {model.label}
                  {blocked ? <span className="block text-[11px] text-[#a1a1a6] mt-0.5">{note}</span> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {colourChoices.length > 0 && (!steps.showModel || selection.modelKey) ? (
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-[#1d1d1f] mb-3">
            Colour
            {colourLabel ? <span className="normal-case tracking-normal font-normal text-[#0071e3]"> — {colourLabel}</span> : null}
          </legend>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2.5">
            {(steps.showModel ? chosenModel?.colours ?? [] : steps.colours)
              .map((colour) => colourButton(steps.showModel ? chosenModel : null, colour.key, colour.label, colour.hex))}
          </div>
        </fieldset>
      ) : null}

      <p className="sr-only" aria-live="polite">{announcement}</p>
      {steps.showModel && !selection.modelKey ? (
        <p className="text-xs text-[#86868b]">Choose a {steps.modelLabel.toLowerCase()} to see its colours and stock.</p>
      ) : null}
      {steps.showColour && selection.modelKey && !selection.colourKey ? (
        <p className="text-xs text-[#86868b]">Choose a colour to see its photo and price.</p>
      ) : null}
    </div>
  );
}

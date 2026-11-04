/**
 * The one place that decides what a product costs right now.
 *
 * Every surface that shows or charges a price calls this resolver. A sale
 * price is used only when sale mode is live (the caller passes that in after
 * comparing the sale window against the database clock) **and** the stored
 * sale price is a genuinely lower positive amount. Anything else falls back to
 * the regular price — never to a sale price by accident.
 *
 * Pure and database-free so tests can call it directly.
 */

export interface PriceSource {
  pricePaise: number | null | undefined;
  salePricePaise?: number | null;
}

export interface EffectivePrice {
  /** What a customer pays today. */
  unitPaise: number;
  /** `products.price_paise`, always shown as the struck-through price on sale. */
  regularPaise: number;
  /** The stored sale price, whether or not it applies. */
  salePaise: number | null;
  /** True only when the sale price applies right now. */
  onSale: boolean;
}

export function resolveEffectivePrice(
  product: PriceSource,
  saleLive: boolean,
  option?: PriceSource | null,
): EffectivePrice {
  const hasOverride = option?.pricePaise !== null && option?.pricePaise !== undefined;
  const regularPaise = toPaise(hasOverride ? option!.pricePaise : product.pricePaise);
  const rawSale = option?.salePricePaise ?? (hasOverride ? null : product.salePricePaise);
  const salePaise =
    rawSale === null || rawSale === undefined ? null : toPaise(rawSale);

  const applies =
    saleLive
    && salePaise !== null
    && salePaise > 0
    && regularPaise > 0
    && salePaise < regularPaise;

  return {
    unitPaise: applies ? (salePaise as number) : regularPaise,
    regularPaise,
    salePaise,
    onSale: applies,
  };
}

function toPaise(value: unknown): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Whole-percent discount, floored, for badges and the admin table. */
export function discountPercent(regularPaise: number, unitPaise: number): number {
  if (regularPaise <= 0 || unitPaise >= regularPaise) return 0;
  return Math.floor(((regularPaise - unitPaise) * 100) / regularPaise);
}

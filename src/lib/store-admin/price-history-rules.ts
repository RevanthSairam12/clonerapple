/**
 * How a `price_history` row should be read and shown. Pure, shared by the
 * server mapping, the admin tables and the API export so no reader can render
 * a cleared sale as a price of zero.
 *
 * `new_price_paise` is NOT NULL, so a sale clear is stored as 0. That zero is a
 * sentinel, never a real price: a price of zero cannot be sold. Legacy
 * `option_*` kinds are accepted defensively but are no longer written; the
 * database check constraint only allows `regular`, `sale` and `sale_cleared`.
 */

export type PriceHistoryKind = 'regular' | 'sale' | 'sale_cleared';

export function normalizePriceKind(value: string | null | undefined): PriceHistoryKind {
  if (value === 'sale') return 'sale';
  if (value === 'sale_cleared' || value === 'option_sale_cleared') return 'sale_cleared';
  return 'regular';
}

/** Human label for the Kind column. Unknown kinds read as a regular price, never as a zero. */
export function priceHistoryKindLabel(value: string | null | undefined): string {
  const kind = normalizePriceKind(value);
  return kind === 'sale' ? 'Sale price' : kind === 'sale_cleared' ? 'Sale cleared' : 'Regular price';
}

/** True when the row records removing a sale price. */
export function priceHistoryIsCleared(value: string | null | undefined): boolean {
  return normalizePriceKind(value) === 'sale_cleared';
}

/**
 * A value safe to format as money. Cleared rows and any stored 0 read as `null`
 * (shown as an em dash), while real prices pass through unchanged.
 */
export function priceHistoryAmount(paise: number | null | undefined): number | null {
  if (paise === null || paise === undefined) return null;
  return paise === 0 ? null : paise;
}

/** Which price this row changed, used beside the amount. */
export function priceHistoryScopeLabel(variantId: string | null | undefined): string {
  return variantId ? 'Option' : 'Product';
}

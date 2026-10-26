/**
 * Pure decision logic for the checkout page.
 *
 * Kept free of React, the router and the database so `node --test` can cover
 * every bag/productId combination directly.
 */

export type CheckoutView = 'loading' | 'bag' | 'product' | 'empty' | 'unavailable';

export interface CheckoutDecisionInput {
  /** True once the client cart has been read from localStorage. */
  isHydrated: boolean;
  /** Number of lines in the live bag. */
  bagItemCount: number;
  /** `?productId=` from the URL, if any. */
  productId?: string | null;
  /** Lines the server resolved from a valid `?productId=`. */
  initialItemCount: number;
  /** True when the server could not resolve the `?productId=`. */
  productUnavailable: boolean;
}

export interface CheckoutDecision {
  view: CheckoutView;
  /** Replace the URL with plain `/checkout` because the bag wins. */
  clearProductQueryFromUrl: boolean;
}

/**
 * Decide what checkout should render.
 *
 * The live bag always wins: a bad or stale `?productId=` must never hide
 * items the customer already has. The unavailable panel is reserved for the
 * case where the URL named a product AND the bag is empty. Nothing is decided
 * until the cart has hydrated, because before that the bag is unknown.
 */
export function decideCheckoutView(input: CheckoutDecisionInput): CheckoutDecision {
  const { isHydrated, bagItemCount, productId, initialItemCount, productUnavailable } = input;
  const hasProductId = Boolean(productId);

  if (!isHydrated) {
    return { view: 'loading', clearProductQueryFromUrl: false };
  }

  if (bagItemCount > 0) {
    return { view: 'bag', clearProductQueryFromUrl: hasProductId };
  }

  if (hasProductId && productUnavailable) {
    return { view: 'unavailable', clearProductQueryFromUrl: false };
  }

  if (initialItemCount > 0) {
    return { view: 'product', clearProductQueryFromUrl: false };
  }

  return { view: 'empty', clearProductQueryFromUrl: false };
}

/** Parse `?qty=` as an integer, clamped to 1..50; missing or NaN becomes 1. */
export function parseCheckoutQuantity(value: string | null | undefined): number {
  if (typeof value !== 'string') return 1;

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) return 1;

  return Math.min(50, Math.max(1, parsed));
}

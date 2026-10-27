/**
 * Pure availability rules shared by the detail pages, the cart, checkout and
 * the click-time endpoint. No database, no framework.
 *
 * Normal mode lets stock block a purchase. Sale mode deliberately never
 * blocks on stock in the UI: a flash sale is expected to be raced, and the
 * authoritative check still happens at Pay under the stock row lock.
 */

export interface ProductAvailability {
  id: string;
  /** The storefront stock state at read time. */
  inStock: boolean;
  /** True only for a tracked stock row. */
  tracked: boolean;
  /** Units available (`on_hand - reserved`); null when untracked or unknown. */
  available: number | null;
  lowStockThreshold: number | null;
}

export interface AvailabilityRead {
  saleLive: boolean;
  /** The database clock used for the sale decision, ISO-8601. */
  databaseNow: string;
  products: ProductAvailability[];
}

/**
 * The one rule for "does stock block this purchase right now?".
 * Sale mode ignores stock; normal mode respects the storefront state.
 */
export function stockBlocked(inStock: boolean, saleLive: boolean): boolean {
  return !saleLive && !inStock;
}

/** The label a normal-mode detail page shows instead of "In Stock". */
export const STOCK_NOT_AVAILABLE = 'Stock not available';

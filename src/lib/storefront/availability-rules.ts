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

/** The only product fields the public click-time endpoint may return. */
export interface PublicProductAvailability {
  id: string;
  inStock: boolean;
  /** True only for a tracked product above zero but at/below its threshold. */
  low: boolean;
}

export interface PublicAvailabilityRead {
  saleLive: boolean;
  products: PublicProductAvailability[];
}

/** Low stock is a shelf state, never a count: out of stock is not low. */
export function isLowStock(product: ProductAvailability): boolean {
  return (
    product.inStock
    && product.tracked
    && product.available !== null
    && product.available > 0
    && product.lowStockThreshold !== null
    && product.available <= product.lowStockThreshold
  );
}

/**
 * Strip exact quantities before the click-time read leaves the server.
 *
 * The endpoint only needs to answer "can this be bought?" and "is it low?".
 * `on_hand - reserved`, the threshold and the tracking flag stay internal so a
 * public caller cannot use the endpoint to count the store's stock.
 */
export function toPublicAvailability(read: AvailabilityRead): PublicAvailabilityRead {
  return {
    saleLive: read.saleLive,
    products: read.products.map((product) => ({
      id: product.id,
      inStock: product.inStock,
      low: isLowStock(product),
    })),
  };
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

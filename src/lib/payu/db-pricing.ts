import { normalizeCartLineId } from '@/lib/cart/cart-id';

/**
 * Pure cart-pricing rules for database-backed checkout.
 *
 * The database row is the only price input: `price_paise` is read as an
 * integer and divided by 100 once, at the end, so the amount sent to PayU
 * cannot be influenced by a client-supplied price, a stale cart total, or a
 * floating-point round-trip per line.
 */

/** Text IDs include legacy seeded product/colour IDs, not just generated var_* IDs. */
export const MAX_CHECKOUT_VARIANT_ID_LENGTH = 256;
export const MAX_CHECKOUT_LINES = 50;

export function isValidCheckoutVariantId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_CHECKOUT_VARIANT_ID_LENGTH);
}

/** Only an exact eligible lookup miss is recoverable as a stale selection. */
export class SelectionUnavailableError extends Error {
  readonly selection: { id: string; variantId: string | null };

  constructor(id: string, variantId?: string | null) {
    super('This selection is no longer available. Review your bag or choose options.');
    this.name = 'SelectionUnavailableError';
    // The response describes one selection, never the catalogue or database error.
    this.selection = { id: id.slice(0, 256), variantId: variantId?.slice(0, MAX_CHECKOUT_VARIANT_ID_LENGTH) ?? null };
  }
}

export interface CartPricingInput {
  id: string;
  quantity: number;
  /**
   * The unit price the customer was shown, in paise. Advisory only: it is
   * never charged. A mismatch against the database price is reported as a
   * `price_changed` conflict so the customer re-confirms the new price.
   */
  expectedUnitPaise?: number | null;
  variantId?: string | null;
}

export interface CatalogPriceRow {
  id: string;
  inventory_mode?: string;
  variant_id?: string | null;
  variant_sku?: string | null;
  variant_label?: string | null;
  name: string;
  subtitle?: string | null;
  price_paise: number | string;
  /** The pre-sale price, only when the resolved price is a sale price. */
  regular_price_paise?: number | string | null;
  image_url?: string | null;
  /** Scope metadata for coupon matching. */
  category_id?: string | null;
  brand_id?: string | null;
  /** True when this row is charged at a live sale price. */
  on_sale?: boolean;
}

export interface PricedCartItem {
  id: string;
  variantId?: string | null;
  variantSku?: string | null;
  variantLabel?: string | null;
  name: string;
  quantity: number;
  /** Rupees, matching the PayU amount unit. */
  unitPrice: number;
  /** Integer paise, the exact unit price before the one division by 100. */
  unitPaise: number;
  /** Rupees. */
  totalPrice: number;
  /** The pre-sale unit price in paise, when this line is on sale. */
  regularPricePaise?: number;
  image?: string;
  /** Scope metadata for coupon matching. */
  categoryId?: string | null;
  brandId?: string | null;
  /** True when this line is charged at a live sale price. */
  onSale?: boolean;
}

/** One line whose displayed price no longer matches the database price. */
export interface PriceChange {
  id: string;
  variantId?: string | null;
  name: string;
  expectedPaise: number;
  actualPaise: number;
}

export interface PricedCart {
  items: PricedCartItem[];
  /** Rupees, two-decimal safe. */
  totalAmount: number;
  /** Integer paise, the exact value the total is derived from. */
  totalPaise: number;
  productSummary: string;
  /**
   * Lines the client showed at a different price. Empty when the client sent
   * no expectation. The caller decides what a change means; pricing itself
   * always uses the database value.
   */
  priceChanges: PriceChange[];
}

function displayName(row: CatalogPriceRow): string {
  return `${row.name} - ${row.subtitle || ''}`.trim();
}

/**
 * Turn cart lines and database rows into an immutable priced snapshot.
 *
 * Throws for anything that cannot be priced exactly:
 * - an empty cart;
 * - an id that does not match a live database row;
 * - a quantity that is not a whole number between 1 and 50;
 * - a price that is not a non-negative integer number of paise.
 */
export function priceCartLines(
  cartItems: ReadonlyArray<CartPricingInput>,
  rows: ReadonlyArray<CatalogPriceRow>,
): PricedCart {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error('Cart is empty.');
  }

  if (cartItems.length > MAX_CHECKOUT_LINES) throw new Error('Cart has too many items.');

  const byId = new Map<string, CatalogPriceRow>();
  for (const row of rows) {
    if (row && typeof row.id === 'string' && row.id.trim()) {
      byId.set(JSON.stringify([row.id.trim().toLowerCase(), row.variant_id || null]), row);
    }
  }
  const knownIds = [...byId.values()].map((row) => row.id);

  const items: PricedCartItem[] = [];
  const priceChanges: PriceChange[] = [];
  let totalPaise = 0;

  for (const cartItem of cartItems) {
    const rawId = cartItem && typeof cartItem.id === 'string' ? cartItem.id : '';
    if (!rawId) throw new Error('Invalid cart item id.');

    const quantity = Number(cartItem.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
      throw new Error(`Invalid quantity for item '${rawId}'. Must be between 1 and 50.`);
    }

    if (!isValidCheckoutVariantId(cartItem.variantId)) throw new Error('Invalid variant id.');

    const normalized = normalizeCartLineId(rawId, knownIds);
    const row = normalized.baseId
      ? byId.get(JSON.stringify([normalized.baseId.toLowerCase(), cartItem.variantId || null]))
      : undefined;
    if (!row || (row.inventory_mode === 'variant' && !cartItem.variantId) ||
      (row.inventory_mode === 'product' && Boolean(cartItem.variantId))) {
      throw new SelectionUnavailableError(normalizeCartLineId(rawId).baseId || rawId, cartItem.variantId);
    }

    const unitPaise = Math.round(Number(row.price_paise));
    if (!Number.isSafeInteger(unitPaise) || unitPaise < 0) {
      throw new Error(`Product '${rawId}' has an invalid price.`);
    }

    const rawRegularPaise = row.regular_price_paise === null || row.regular_price_paise === undefined
      ? null
      : Math.round(Number(row.regular_price_paise));
    const regularPricePaise =
      rawRegularPaise !== null && Number.isSafeInteger(rawRegularPaise) && rawRegularPaise > unitPaise
        ? rawRegularPaise
        : undefined;

    const linePaise = unitPaise * quantity;
    totalPaise += linePaise;

    const name = displayName(row);
    items.push({
      id: row.id,
      ...(row.variant_id ? { variantId: row.variant_id, variantSku: row.variant_sku, variantLabel: row.variant_label } : {}),
      name,
      quantity,
      unitPrice: unitPaise / 100,
      unitPaise,
      totalPrice: linePaise / 100,
      ...(regularPricePaise !== undefined ? { regularPricePaise } : {}),
      image:
        typeof row.image_url === 'string' && row.image_url.trim()
          ? row.image_url
          : undefined,
      categoryId: row.category_id ? String(row.category_id) : null,
      brandId: row.brand_id ? String(row.brand_id) : null,
      onSale: row.on_sale === true,
    });

    // Same order as the input array: priceCartLines pushes exactly one item
    // per valid input line.
    const expected = cartItem.expectedUnitPaise == null ? Number.NaN : Number(cartItem.expectedUnitPaise);
    if (Number.isSafeInteger(expected) && expected >= 0 && expected !== unitPaise) {
      priceChanges.push({ id: row.id, ...(row.variant_id ? { variantId: row.variant_id } : {}), name, expectedPaise: expected, actualPaise: unitPaise });
    }
  }

  const names = items.map((item) => `${item.name} (x${item.quantity})`).join(', ');
  const productSummary = names.length > 90 ? `${names.slice(0, 87)}...` : names;

  return {
    items,
    // Division by 100 happens once, from integer paise. toFixed(2) at the
    // PayU boundary is therefore never rounding an accumulated float error.
    totalAmount: totalPaise / 100,
    totalPaise,
    productSummary: productSummary.replace(/[^a-zA-Z0-9\s,.-]/g, ' ').trim(),
    priceChanges,
  };
}

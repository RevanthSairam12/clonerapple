import { normalizeCartLineId } from '@/lib/cart/cart-id';

/**
 * Pure cart-pricing rules for database-backed checkout.
 *
 * The database row is the only price input: `price_paise` is read as an
 * integer and divided by 100 once, at the end, so the amount sent to PayU
 * cannot be influenced by a client-supplied price, a stale cart total, or a
 * floating-point round-trip per line.
 */

export interface CartPricingInput {
  id: string;
  quantity: number;
}

export interface CatalogPriceRow {
  id: string;
  name: string;
  subtitle?: string | null;
  price_paise: number | string;
  image_url?: string | null;
}

export interface PricedCartItem {
  id: string;
  name: string;
  quantity: number;
  /** Rupees, matching the PayU amount unit. */
  unitPrice: number;
  /** Rupees. */
  totalPrice: number;
  image?: string;
}

export interface PricedCart {
  items: PricedCartItem[];
  /** Rupees, two-decimal safe. */
  totalAmount: number;
  /** Integer paise, the exact value the total is derived from. */
  totalPaise: number;
  productSummary: string;
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

  const byId = new Map<string, CatalogPriceRow>();
  for (const row of rows) {
    if (row && typeof row.id === 'string' && row.id.trim()) {
      byId.set(row.id.trim().toLowerCase(), row);
    }
  }
  const knownIds = [...byId.values()].map((row) => row.id);

  const items: PricedCartItem[] = [];
  let totalPaise = 0;

  for (const cartItem of cartItems) {
    const rawId = cartItem && typeof cartItem.id === 'string' ? cartItem.id : '';
    if (!rawId) throw new Error('Invalid cart item id.');

    const quantity = Number(cartItem.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
      throw new Error(`Invalid quantity for item '${rawId}'. Must be between 1 and 50.`);
    }

    const normalized = normalizeCartLineId(rawId, knownIds);
    const row = normalized.baseId
      ? byId.get(normalized.baseId.toLowerCase())
      : undefined;
    if (!row) {
      throw new Error(`Product '${rawId}' not found in catalog.`);
    }

    const unitPaise = Math.round(Number(row.price_paise));
    if (!Number.isSafeInteger(unitPaise) || unitPaise < 0) {
      throw new Error(`Product '${rawId}' has an invalid price.`);
    }

    const linePaise = unitPaise * quantity;
    totalPaise += linePaise;

    items.push({
      id: row.id,
      name: displayName(row),
      quantity,
      unitPrice: unitPaise / 100,
      totalPrice: linePaise / 100,
      image:
        typeof row.image_url === 'string' && row.image_url.trim()
          ? row.image_url
          : undefined,
    });
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
  };
}

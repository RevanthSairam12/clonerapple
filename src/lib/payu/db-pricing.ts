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
export const SALE_ONE_UNIT_ERROR_MESSAGE =
  'Only 1 quantity per item can be purchased per order during a sale.';

export function isValidCheckoutVariantId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_CHECKOUT_VARIANT_ID_LENGTH);
}

/** Raised when aggregated paid quantity for a product/variant exceeds 1 during Sale Mode. */
export class SaleQuantityLimitError extends Error {
  readonly code = 'sale_quantity_limit' as const;
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;

  constructor(productId: string, variantId: string | null = null, quantity: number = 2) {
    super(SALE_ONE_UNIT_ERROR_MESSAGE);
    this.name = 'SaleQuantityLimitError';
    this.productId = productId.slice(0, 256);
    this.variantId = variantId ? variantId.slice(0, MAX_CHECKOUT_VARIANT_ID_LENGTH) : null;
    this.quantity = quantity;
  }
}

/** Raised when authoritative sale state cannot be read (fail-closed enforcement). */
export class SaleStateUnavailableError extends Error {
  readonly code = 'sale_state_unavailable' as const;

  constructor(message = 'Checkout sale settings are temporarily unavailable. Please try again.') {
    super(message);
    this.name = 'SaleStateUnavailableError';
  }
}

export function isSaleQuantityLimitError(error: unknown): error is SaleQuantityLimitError {
  return error instanceof SaleQuantityLimitError
    || (error instanceof Error
      && error.name === 'SaleQuantityLimitError'
      && (error as { code?: unknown }).code === 'sale_quantity_limit');
}

export function isSaleStateUnavailableError(error: unknown): error is SaleStateUnavailableError {
  return error instanceof SaleStateUnavailableError
    || (error instanceof Error
      && error.name === 'SaleStateUnavailableError'
      && (error as { code?: unknown }).code === 'sale_state_unavailable');
}

export interface SaleQuantityLine {
  id?: string;
  productId?: string;
  variantId?: string | null;
  quantity: number;
  isFreeGift?: boolean;
}

/**
 * Aggregates quantities per canonical (productId, variantId) across lines,
 * ignoring free gifts. Preserves distinct products and distinct variants of
 * the same product as independent entries.
 */
export function aggregateQuantitiesByItem(
  lines: ReadonlyArray<SaleQuantityLine>,
): Array<{ productId: string; variantId: string | null; quantity: number }> {
  const counts = new Map<string, { productId: string; variantId: string | null; quantity: number }>();

  for (const line of lines) {
    if (!line || line.isFreeGift) continue;
    const rawId = typeof line.productId === 'string'
      ? line.productId
      : typeof line.id === 'string'
        ? line.id
        : '';
    const baseId = (normalizeCartLineId(rawId).baseId || rawId).trim().toLowerCase();
    if (!baseId) continue;
    const variantId = typeof line.variantId === 'string' && line.variantId.trim()
      ? line.variantId.trim()
      : null;
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const key = JSON.stringify([baseId, variantId]);
    const existing = counts.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      counts.set(key, { productId: baseId, variantId, quantity: qty });
    }
  }

  return [...counts.values()];
}

export function hasAggregatedQuantityOverOne(lines: ReadonlyArray<SaleQuantityLine>): boolean {
  return aggregateQuantitiesByItem(lines).some((entry) => entry.quantity > 1);
}

/**
 * Enforces the Sale Mode one-unit-per-product/variant-per-order rule.
 * When Sale Mode is inactive (`saleLive === false`), multi-quantity orders are permitted.
 */
export function validateSaleModeQuantities(
  lines: ReadonlyArray<SaleQuantityLine>,
  saleLive: boolean,
): void {
  if (!saleLive) return;
  for (const entry of aggregateQuantitiesByItem(lines)) {
    if (entry.quantity > 1) {
      throw new SaleQuantityLimitError(entry.productId, entry.variantId, entry.quantity);
    }
  }
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
  /** The chosen photo's alt text, stored with the order line. */
  image_alt?: string | null;
  /** The exact option this row sells, snapshotted onto the order line. */
  variant_device_model_id?: string | null;
  variant_device_model_name?: string | null;
  variant_colour_id?: string | null;
  variant_colour_name?: string | null;
  variant_colour_hex?: string | null;
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
  imageAlt?: string | null;
  /** The exact option this line sold, as read from the database. */
  deviceModelId?: string | null;
  deviceModelName?: string | null;
  colourId?: string | null;
  colourName?: string | null;
  colourHex?: string | null;
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
      imageAlt: row.image_alt ? String(row.image_alt) : null,
      // Snapshotted at order time: renaming or replacing an option or photo
      // must never change what an old order says it sold.
      deviceModelId: row.variant_device_model_id ? String(row.variant_device_model_id) : null,
      deviceModelName: row.variant_device_model_name ? String(row.variant_device_model_name) : null,
      colourId: row.variant_colour_id ? String(row.variant_colour_id) : null,
      colourName: row.variant_colour_name ? String(row.variant_colour_name) : null,
      colourHex: row.variant_colour_hex ? String(row.variant_colour_hex) : null,
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

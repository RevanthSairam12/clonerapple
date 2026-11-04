/**
 * The boundary between the legacy CMS and the commerce catalogue.
 *
 * The legacy editor (/admin) owns design and marketing content: layout, copy,
 * imagery, theme and the Education Store (which is deferred and exempt).
 * Products, prices, SKUs, stock, orders, customers, shipping and payments
 * belong to the Store Admin (/store-admin).
 *
 * The editor's generic JSON editor can technically submit any shape. This
 * module is the server-side gate: a legacy save that carries a commerce field
 * is rejected with a clear message instead of being stored. It is deliberately
 * pure (no database or React imports) so tests and the boundary checker can
 * exercise it directly.
 */

import { homepageSlotCount, validateHomepageSlots } from './homepage-products';

/** Education Store keys are deferred by project rule; do not police them. */
const EXEMPT_PREFIXES = ['edu.'] as const;

/**
 * Field names that may only live in the commerce catalogue. Matching is by
 * exact name (case-insensitive), never by substring, so a marketing field
 * such as `buyLabel` or `productHref` is not mistaken for commerce data.
 */
const COMMERCE_FIELD_NAMES = new Set(
  [
    'price',
    'prices',
    'price_paise',
    'pricePaise',
    'compare_at',
    'compare_at_paise',
    'compareAtPaise',
    'cost',
    'cost_paise',
    'sku',
    'variant',
    'variants',
    'product',
    'products',
    'product_id',
    'productId',
    'stock',
    'stock_status',
    'stockStatus',
    'in_stock',
    'inStock',
    'inventory',
    'quantity',
    'qty',
    'discount',
    'discount_percent',
    'discountPercent',
    'order',
    'orders',
    'order_id',
    'orderId',
    'customer',
    'customers',
    'customer_id',
    'customerId',
    'shipping',
    'shipping_method',
    'shippingMethod',
    'payment',
    'payments',
    'payment_method',
    'paymentMethod',
    'tax',
    'gst',
    'subtotal',
    'total',
    'total_paise',
    'currency',
  ].map((name) => name.toLowerCase()),
);

export interface CommerceFieldHit {
  /** Dot/bracket path of the offending field, e.g. `items[0].price`. */
  path: string;
  /** The field name that matched. */
  field: string;
}

/** True when a collection key is exempt from the boundary (Education Store). */
export function isExemptCollectionKey(key: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** True when a single field name is commerce data. */
export function isCommerceFieldName(field: string): boolean {
  return COMMERCE_FIELD_NAMES.has(field.trim().toLowerCase());
}

/**
 * Walk a submitted content value and list every commerce-shaped field.
 * Keys are checked; string values are not, because marketing copy is allowed
 * to mention the word "price" without storing a price.
 */
export function findCommerceFields(
  value: unknown,
  path = '',
  depth = 0,
): CommerceFieldHit[] {
  if (depth > 12 || value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findCommerceFields(entry, `${path}[${index}]`, depth + 1),
    );
  }

  if (typeof value !== 'object') return [];

  const hits: CommerceFieldHit[] = [];
  for (const [field, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${field}` : field;
    if (isCommerceFieldName(field)) {
      hits.push({ path: nextPath, field });
    }
    hits.push(...findCommerceFields(entry, nextPath, depth + 1));
  }
  return hits;
}

export type LegacyContentValidation =
  | { ok: true }
  | { ok: false; error: string; fields: CommerceFieldHit[] };

/**
 * Gate one legacy content-collection write.
 *
 * Exempt (Education Store) keys pass through untouched. Every other key is
 * rejected when the value contains a commerce field, wherever it is nested.
 */
export function validateLegacyContentWrite(
  key: string,
  value: unknown,
  allowHomepageReferences = false,
): LegacyContentValidation {
  if (isExemptCollectionKey(key)) return { ok: true };

  const allowReferences = allowHomepageReferences && homepageSlotCount(key) > 0 && validateHomepageSlots(key, value) === null;
  const fields = findCommerceFields(value).filter(hit =>
    !(allowReferences && /^items\[\d+\]\.productId$/.test(hit.path)),
  );
  if (fields.length === 0) return { ok: true };

  const list = fields
    .slice(0, 5)
    .map((hit) => hit.path)
    .join(', ');
  return {
    ok: false,
    fields,
    error:
      `This collection cannot store commerce data (${list}). ` +
      'Products, prices, stock, orders, customers and shipping are edited in ' +
      'Store Admin, not the content editor.',
  };
}

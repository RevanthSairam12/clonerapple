import { PRODUCTS } from '@/components/sites/cases-protection/data/products';
import { ALL_ACCESSORY_PRODUCTS } from '@/lib/products/registry';
import { normalizeCartLineId } from '@/lib/cart/cart-id';

export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  image?: string;
}

// Fallback/standard items map for quick O(1) lookup
const catalogMap = new Map<string, CatalogItem>();

for (const p of PRODUCTS) {
  catalogMap.set(p.id, {
    id: p.id,
    name: `${p.name} - ${p.subtitle || ''}`.trim(),
    price: p.price,
    image: p.image,
  });
}

// Generic accessory catalog (power adapters, earphones, cable cases, AirPods
// cases, mobile cases) — authoritative server-side prices for checkout.
for (const a of ALL_ACCESSORY_PRODUCTS) {
  catalogMap.set(a.id, {
    id: a.id,
    name: `${a.name} - ${a.subtitle || ''}`.trim(),
    price: a.price,
    image: a.image,
  });
}

export function getProductImage(id: string): string | null {
  const normalized = normalizeCartLineId(id, [...catalogMap.keys()]);
  return normalized.baseId ? catalogMap.get(normalized.baseId)?.image || null : null;
}

/**
 * Resolves a product by ID from the authoritative server catalog.
 * NEVER trusts prices supplied from the client.
 */
export function getProductFromCatalog(id: string): CatalogItem | null {
  const normalized = normalizeCartLineId(id, [...catalogMap.keys()]);
  const item = normalized.baseId ? catalogMap.get(normalized.baseId) : null;
  if (!item) return null;
  return { ...item };
}

/**
 * Computes authoritative cart totals and creates an immutable snapshot of items.
 */
export function resolveCartItems(cartItems: Array<{ id: string; quantity: number }>): {
  items: Array<{ id: string; name: string; quantity: number; unitPrice: number; totalPrice: number }>;
  totalAmount: number;
  productSummary: string;
} {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error('Cart is empty.');
  }

  const items: Array<{ id: string; name: string; quantity: number; unitPrice: number; totalPrice: number }> = [];
  let totalAmount = 0;

  for (const cItem of cartItems) {
    if (!cItem.id || typeof cItem.id !== 'string') {
      throw new Error('Invalid cart item id.');
    }
    const qty = Math.floor(Number(cItem.quantity));
    if (!Number.isFinite(qty) || qty <= 0 || qty > 50) {
      throw new Error(`Invalid quantity for item '${cItem.id}'. Must be between 1 and 50.`);
    }

    const normalized = normalizeCartLineId(cItem.id, [...catalogMap.keys()]);
    const catalogItem = normalized.baseId ? getProductFromCatalog(normalized.baseId) : null;
    if (!catalogItem) {
      throw new Error(`Product '${cItem.id}' not found in catalog.`);
    }

    const lineTotal = catalogItem.price * qty;
    totalAmount += lineTotal;

    items.push({
      id: catalogItem.id,
      name: catalogItem.name,
      quantity: qty,
      unitPrice: catalogItem.price,
      totalPrice: lineTotal,
    });
  }

  // Create a clean product info string for PayU (max 100 chars, no special characters)
  const names = items.map((i) => `${i.name} (x${i.quantity})`).join(', ');
  const productSummary = names.length > 90 ? names.substring(0, 87) + '...' : names;

  return {
    items,
    totalAmount,
    productSummary: productSummary.replace(/[^a-zA-Z0-9\s,.-]/g, ' ').trim(),
  };
}

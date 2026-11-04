import { getCartLineBaseId } from '../cart/cart-id';
import type { ShippingPolicy } from './shipping-rules';

export interface PriceRef {
  inventoryMode?: 'product' | 'variant';
  purchasableVariants?: import('@/lib/catalog/storefront').StorefrontPurchasableVariant[];
  id: string;
  pricePaise: number;
  regularPricePaise?: number | null;
  inStock: boolean;
}
export interface QuoteLine { id: string; productId?: string; variantId?: string; quantity: number }
export interface QuoteTotals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
}
export interface PriceChangedQuote {
  items: { id: string; variantId?: string; variantSku?: string; variantLabel?: string; name: string; quantity: number; unitPaise: number; totalPaise: number; regularPricePaise: number | null }[];
  totals: QuoteTotals;
  shippingPolicy: ShippingPolicy;
}

export function baseProductId(line: Pick<QuoteLine, 'id' | 'productId'>): string {
  return (getCartLineBaseId(line.productId || line.id) || '').trim().toLowerCase();
}

/** Never use a local-storage price when the live catalogue has no matching row. */
export function priceCartLines<T extends QuoteLine>(items: T[], products: PriceRef[], saleLive: boolean) {
  const byId = new Map(products.map((product) => [product.id.trim().toLowerCase(), product]));
  return items.map((item) => {
    const product = byId.get(baseProductId(item));
    const variant = item.variantId ? product?.purchasableVariants?.find((entry) => entry.id === item.variantId) : undefined;
    const selectionValid = product?.inventoryMode === 'variant' ? Boolean(variant) : !item.variantId;
    const selected = variant ?? product;
    const available = Boolean(selectionValid && selected && Number.isSafeInteger(selected.pricePaise) && selected.pricePaise > 0 &&
      (selected.inStock || saleLive));
    const unitPaise = selected?.pricePaise ?? 0;
    return { ...item, available, unitPaise, totalPaise: unitPaise * item.quantity,
      price: unitPaise / 100, regularPrice: selected?.regularPricePaise && selected.regularPricePaise > unitPaise ? selected.regularPricePaise / 100 : undefined };
  });
}

export function shippingNudge(subtotalPaise: number, policy: ShippingPolicy | null, shippingPaise: number): string | null {
  if (!policy?.enabled || policy.freeShippingThresholdPaise === null || shippingPaise <= 0 || subtotalPaise <= 0) return null;
  const remaining = policy.freeShippingThresholdPaise - subtotalPaise;
  return remaining > 0 ? `Add ₹${(remaining / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} more for free shipping.` : null;
}

export function validTotals(value: unknown): value is QuoteTotals {
  if (!value || typeof value !== 'object') return false;
  const totals = value as QuoteTotals;
  return [totals.subtotalPaise, totals.discountPaise, totals.shippingPaise, totals.totalPaise]
    .every((n) => Number.isSafeInteger(n) && n >= 0) &&
    totals.discountPaise <= totals.subtotalPaise &&
    totals.totalPaise === totals.subtotalPaise - totals.discountPaise + totals.shippingPaise;
}

/** Reject incomplete recovery payloads instead of displaying invented free shipping. */
export function parsePriceChangedQuote(value: unknown): PriceChangedQuote | null {
  if (!value || typeof value !== 'object') return null;
  const quote = value as PriceChangedQuote;
  const policy = quote.shippingPolicy;
  if (!policy || typeof policy.enabled !== 'boolean' || !Number.isSafeInteger(policy.chargePaise) || policy.chargePaise < 0 ||
      !(policy.freeShippingThresholdPaise === null || (Number.isSafeInteger(policy.freeShippingThresholdPaise) && policy.freeShippingThresholdPaise >= 0)) ||
      !validTotals(quote.totals) || !Array.isArray(quote.items) || !quote.items.length) return null;
  if (!quote.items.every((item) => typeof item.id === 'string' && typeof item.name === 'string' &&
      (item.variantId == null || (typeof item.variantId === 'string' && item.variantId.length > 0)) &&
      (item.variantSku == null || typeof item.variantSku === 'string') &&
      (item.variantLabel == null || typeof item.variantLabel === 'string') &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 && Number.isSafeInteger(item.unitPaise) && item.unitPaise > 0 &&
      item.totalPaise === item.unitPaise * item.quantity &&
      (item.regularPricePaise === null || (Number.isSafeInteger(item.regularPricePaise) && item.regularPricePaise > 0)))) return null;
  if (quote.items.reduce((sum, item) => sum + item.totalPaise, 0) !== quote.totals.subtotalPaise) return null;
  if (!quote.items.some((item) => item.variantId === null || item.variantSku === null || item.variantLabel === null)) return quote;
  return { ...quote, items: quote.items.map((item) => {
    const normalized = { ...item };
    if (normalized.variantId === null) delete normalized.variantId;
    if (normalized.variantSku === null) delete normalized.variantSku;
    if (normalized.variantLabel === null) delete normalized.variantLabel;
    return normalized;
  }) };
}

/** A price recovery cannot replace the customer's selected SKU with a sibling. */
export function quoteMatchesLines(quote: PriceChangedQuote, lines: QuoteLine[]): boolean {
  const quantities = (values: { id: string; productId?: string; variantId?: string; quantity: number }[]) => {
    const result = new Map<string, number>();
    for (const line of values) {
      const key = JSON.stringify([baseProductId(line), line.variantId || null]);
      result.set(key, (result.get(key) ?? 0) + line.quantity);
    }
    return result;
  };
  const expected = quantities(lines), actual = quantities(quote.items);
  return expected.size === actual.size && [...expected].every(([key, quantity]) => actual.get(key) === quantity);
}

export function applyQuotePrices(products: PriceRef[], quote: PriceChangedQuote): PriceRef[] {
  return products.map((product) => {
    const lines = quote.items.filter((line) => line.id.toLowerCase() === product.id.toLowerCase());
    const parent = lines.find((line) => !line.variantId);
    return { ...product, ...(parent ? { pricePaise: parent.unitPaise, regularPricePaise: parent.regularPricePaise } : {}),
      purchasableVariants: product.purchasableVariants?.map((variant) => {
        const line = lines.find((entry) => entry.variantId === variant.id);
        return line ? { ...variant, pricePaise: line.unitPaise, regularPricePaise: line.regularPricePaise ?? line.unitPaise } : variant;
      }) };
  });
}

/** A render-time generation gate also rejects an old A response after A → B → A. */
export function createQuoteGeneration() {
  let signature = '';
  let generation = 0;
  return {
    update(next: string) { if (next !== signature) { signature = next; generation += 1; } },
    invalidate() { generation += 1; },
    capture() { return { signature, generation }; },
    current(ticket: { signature: string; generation: number }) {
      return ticket.signature === signature && ticket.generation === generation;
    },
  };
}

export interface SaleRefreshClock {
  enabled: boolean;
  databaseNow: string;
  startsAt: string | null;
  endsAt: string | null;
}

/** Delay is relative to the DB clock, never the customer's wall clock. */
export function nextSaleRefreshDelay(clock?: SaleRefreshClock): number | null {
  if (!clock?.enabled) return null;
  const now = Date.parse(clock.databaseNow);
  const delays = [clock.startsAt, clock.endsAt].filter(Boolean)
    .map((date) => Date.parse(date!) - now).filter((delay) => Number.isFinite(delay) && delay > 0);
  return delays.length ? Math.min(Math.min(...delays) + 100, 2_147_483_647) : null;
}

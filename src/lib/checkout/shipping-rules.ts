/**
 * Pure shipping-quote rules.
 *
 * The amount is always computed on the server from `shipping_methods` plus the
 * order settings; the client only renders the same function's result. No
 * client-sent rate, threshold or total is accepted anywhere.
 *
 * Order of precedence:
 *   1. Shipping off                     → no charge
 *   2. No active method                 → no charge (today's behaviour)
 *   3. Store-wide free-shipping threshold met → no charge
 *   4. The chosen method's own threshold met  → no charge
 *   5. Otherwise the method's rate
 *
 * Pickup is read but not selectable: checkout has no delivery-method selector,
 * so pickup never changes the amount. See the Phase 2 report.
 */

export interface ShippingMethodLike {
  id: string;
  name: string;
  ratePaise: number;
  freeOverPaise: number;
  isActive: boolean;
  sortOrder: number;
}

export interface ShippingPolicy {
  /** Orders → "Shipping enabled". */
  enabled: boolean;
  /** Orders → "Free shipping over (₹)", converted to paise; 0 disables it. */
  freeShippingOverPaise: number;
  /** Rows from `shipping_methods`, including inactive ones. */
  methods: readonly ShippingMethodLike[];
}

export const EMPTY_SHIPPING_POLICY: ShippingPolicy = {
  enabled: false,
  freeShippingOverPaise: 0,
  methods: [],
};

export type ShippingQuoteReason =
  | 'disabled'
  | 'no-method'
  | 'free-threshold'
  | 'method-free'
  | 'rate';

export interface ShippingQuote {
  shippingPaise: number;
  methodId: string | null;
  methodName: string | null;
  reason: ShippingQuoteReason;
}

function moneyPaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

/** Whole paise, never negative. */
export function normalizeSubtotalPaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

/** The method checkout uses: first active row by sort order, then name. */
export function selectShippingMethod(methods: readonly ShippingMethodLike[]): ShippingMethodLike | null {
  const active = methods
    .filter((method) => method.isActive)
    .filter((method) => moneyPaise(method.ratePaise) >= 0)
    .slice()
    .sort((a, b) => {
      const order = Number(a.sortOrder) - Number(b.sortOrder);
      if (order !== 0) return order;
      return String(a.name).localeCompare(String(b.name));
    });
  return active[0] ?? null;
}

export function quoteShipping(subtotalPaiseInput: unknown, policy: ShippingPolicy): ShippingQuote {
  const subtotalPaise = normalizeSubtotalPaise(subtotalPaiseInput);
  const none = (reason: ShippingQuoteReason): ShippingQuote => ({
    shippingPaise: 0,
    methodId: null,
    methodName: null,
    reason,
  });

  if (!policy.enabled) return none('disabled');

  const method = selectShippingMethod(policy.methods);
  if (!method) return none('no-method');

  const threshold = moneyPaise(policy.freeShippingOverPaise);
  if (threshold > 0 && subtotalPaise >= threshold) {
    return { shippingPaise: 0, methodId: method.id, methodName: method.name, reason: 'free-threshold' };
  }

  const methodThreshold = moneyPaise(method.freeOverPaise);
  if (methodThreshold > 0 && subtotalPaise >= methodThreshold) {
    return { shippingPaise: 0, methodId: method.id, methodName: method.name, reason: 'method-free' };
  }

  return {
    shippingPaise: moneyPaise(method.ratePaise),
    methodId: method.id,
    methodName: method.name,
    reason: 'rate',
  };
}

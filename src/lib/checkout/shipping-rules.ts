/** Pure checkout shipping rules. Compare the sale-priced subtotal BEFORE coupons. */
export interface ShippingPolicy {
  enabled: boolean;
  /** Whole paise. Zero is free shipping. */
  chargePaise: number;
  /** null disables threshold-based free shipping; zero qualifies every nonempty cart. */
  freeShippingThresholdPaise: number | null;
}

export const EMPTY_SHIPPING_POLICY: ShippingPolicy = {
  enabled: false,
  chargePaise: 0,
  freeShippingThresholdPaise: null,
};

export type ShippingQuoteReason = 'disabled' | 'free-coupon' | 'free-threshold' | 'rate';

export interface ShippingQuote {
  shippingPaise: number;
  methodId: null;
  methodName: null;
  reason: ShippingQuoteReason;
}

/** Whole paise, never negative. */
export function normalizeSubtotalPaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

export function quoteShipping(
  subtotalPaiseInput: unknown,
  policy: ShippingPolicy,
  validatedFreeShippingCoupon = false,
): ShippingQuote {
  const subtotalPaise = normalizeSubtotalPaise(subtotalPaiseInput);
  const quote = (shippingPaise: number, reason: ShippingQuoteReason): ShippingQuote => ({
    shippingPaise, methodId: null, methodName: null, reason,
  });
  if (!policy.enabled) return quote(0, 'disabled');
  if (validatedFreeShippingCoupon) return quote(0, 'free-coupon');
  const threshold = policy.freeShippingThresholdPaise;
  if (threshold !== null && threshold >= 0 && subtotalPaise > 0 && subtotalPaise >= threshold) {
    return quote(0, 'free-threshold');
  }
  return quote(normalizeSubtotalPaise(policy.chargePaise), 'rate');
}

/** Legacy records are retained ONLY for cutover compatibility, never checkout. */
export interface ShippingMethodLike {
  id: string;
  name: string;
  ratePaise: number;
  freeOverPaise: number;
  isActive: boolean;
  sortOrder: number;
}

/** Exact legacy JS selector; preserve stable ties and localeCompare for backfill. */
export function selectShippingMethod(methods: readonly ShippingMethodLike[]): ShippingMethodLike | null {
  const active = methods
    .filter((method) => method.isActive)
    .filter((method) => normalizeSubtotalPaise(method.ratePaise) >= 0)
    .slice()
    .sort((a, b) => {
      const order = Number(a.sortOrder) - Number(b.sortOrder);
      if (order !== 0) return order;
      return String(a.name).localeCompare(String(b.name));
    });
  return active[0] ?? null;
}

/** Keep configured rates even when shipping is disabled. Legacy zero means no threshold. */
export function shippingPolicyFromLegacy(
  enabled: boolean,
  globalThresholdRupees: unknown,
  methods: readonly ShippingMethodLike[],
): ShippingPolicy {
  const method = selectShippingMethod(methods);
  const positiveThresholds = [
    normalizeSubtotalPaise(Number(String(globalThresholdRupees ?? '').trim()) * 100),
    normalizeSubtotalPaise(method?.freeOverPaise),
  ].filter((value) => value > 0);
  return {
    enabled,
    chargePaise: normalizeSubtotalPaise(method?.ratePaise),
    freeShippingThresholdPaise: positiveThresholds.length ? Math.min(...positiveThresholds) : null,
  };
}

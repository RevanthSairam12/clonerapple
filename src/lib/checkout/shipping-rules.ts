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

export interface EligibleSubtotalLine {
  linePaise?: number | null;
  unitPaise?: number | null;
  quantity?: number | null;
  isFreeGift?: boolean | null;
}

/**
 * Shared eligible subtotal helper used identically by free-shipping thresholds
 * and Free Gift spend thresholds: sale-priced item subtotal BEFORE coupons,
 * excluding free gifts, shipping, and taxes.
 */
export function computeEligibleSubtotalPaise(
  lines: readonly EligibleSubtotalLine[],
): number {
  let sum = 0;
  for (const line of lines) {
    if (line.isFreeGift) continue;
    const lineTotal =
      line.linePaise !== undefined && line.linePaise !== null
        ? normalizeSubtotalPaise(line.linePaise)
        : normalizeSubtotalPaise(line.unitPaise) * Math.max(0, Math.trunc(Number(line.quantity) || 0));
    sum += lineTotal;
  }
  return sum;
}

export function quoteShippingFromLines(
  lines: readonly EligibleSubtotalLine[],
  policy: ShippingPolicy,
  validatedFreeShippingCoupon = false,
): ShippingQuote {
  return quoteShipping(computeEligibleSubtotalPaise(lines), policy, validatedFreeShippingCoupon);
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

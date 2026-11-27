import { normalizeSubtotalPaise, quoteShipping, type ShippingPolicy } from './shipping-rules';

export type FreeShippingBannerStatus =
  | 'always-free'
  | 'threshold-empty'
  | 'threshold-progress'
  | 'threshold-unlocked'
  | 'coupon-unlocked';

export interface FreeShippingBannerState {
  status: FreeShippingBannerStatus;
  unlocked: boolean;
  progressPercent: number;
  thresholdPaise: number | null;
  remainingPaise: number;
  subtotalPaise: number;
  chargePaise: number;
  badgeText: string;
  headline: string;
  subtext: string;
  progressLabel: string | null;
}

/** Format whole paise in INR (`₹4,000` when whole rupees, `₹499.50` otherwise). */
export function formatBannerRupees(paise: number): string {
  const safe = Number.isFinite(paise) ? Math.max(0, Math.round(paise)) : 0;
  const hasFraction = safe % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(safe / 100);
}

/**
 * Derive the cart page free-delivery banner directly from Store Admin's
 * authoritative `ShippingPolicy` and the active bag subtotal / effective shipping.
 */
export function buildFreeShippingBanner(
  subtotalPaiseInput: unknown,
  policy: ShippingPolicy | null,
  effectiveShippingPaise?: number,
): FreeShippingBannerState | null {
  if (!policy) return null;

  const subtotalPaise = normalizeSubtotalPaise(subtotalPaiseInput);
  const chargePaise = normalizeSubtotalPaise(policy.chargePaise);
  const threshold = policy.freeShippingThresholdPaise;
  const resolvedShippingPaise =
    effectiveShippingPaise === undefined
      ? quoteShipping(subtotalPaise, policy).shippingPaise
      : normalizeSubtotalPaise(effectiveShippingPaise);

  if (!policy.enabled || chargePaise === 0 || threshold === 0) {
    return {
      status: 'always-free',
      unlocked: true,
      progressPercent: 100,
      thresholdPaise: null,
      remainingPaise: 0,
      subtotalPaise,
      chargePaise: 0,
      badgeText: 'FREE DELIVERY',
      headline: subtotalPaise > 0 ? 'Your order qualifies for FREE delivery!' : 'Free delivery on all orders!',
      subtext: 'Shipping is ₹0 — no minimum order amount required.',
      progressLabel: null,
    };
  }

  if (threshold === null || threshold < 0) {
    if (subtotalPaise > 0 && resolvedShippingPaise === 0) {
      return {
        status: 'coupon-unlocked',
        unlocked: true,
        progressPercent: 100,
        thresholdPaise: null,
        remainingPaise: 0,
        subtotalPaise,
        chargePaise,
        badgeText: 'FREE DELIVERY',
        headline: 'FREE delivery unlocked with your coupon!',
        subtext: 'Shipping charges have been waived on this order.',
        progressLabel: null,
      };
    }
    return null;
  }

  if (subtotalPaise <= 0) {
    return {
      status: 'threshold-empty',
      unlocked: false,
      progressPercent: 0,
      thresholdPaise: threshold,
      remainingPaise: threshold,
      subtotalPaise: 0,
      chargePaise,
      badgeText: 'FREE DELIVERY',
      headline: `Free delivery on orders of ${formatBannerRupees(threshold)} or more`,
      subtext: `Standard delivery is ${formatBannerRupees(chargePaise)} below ${formatBannerRupees(threshold)}. Add items to unlock free delivery.`,
      progressLabel: `${formatBannerRupees(0)} / ${formatBannerRupees(threshold)}`,
    };
  }

  if (subtotalPaise >= threshold) {
    return {
      status: 'threshold-unlocked',
      unlocked: true,
      progressPercent: 100,
      thresholdPaise: threshold,
      remainingPaise: 0,
      subtotalPaise,
      chargePaise,
      badgeText: 'FREE DELIVERY',
      headline: "You've unlocked FREE delivery!",
      subtext: `Your order meets the ${formatBannerRupees(threshold)} free delivery minimum.`,
      progressLabel: `${formatBannerRupees(threshold)} / ${formatBannerRupees(threshold)}`,
    };
  }

  if (resolvedShippingPaise === 0) {
    return {
      status: 'coupon-unlocked',
      unlocked: true,
      progressPercent: 100,
      thresholdPaise: threshold,
      remainingPaise: 0,
      subtotalPaise,
      chargePaise,
      badgeText: 'FREE DELIVERY',
      headline: 'FREE delivery unlocked with your coupon!',
      subtext: 'Shipping charges have been waived on this order.',
      progressLabel: null,
    };
  }

  const remainingPaise = threshold - subtotalPaise;
  const progressPercent = Math.min(99, Math.max(0, Math.round((subtotalPaise / threshold) * 100)));
  return {
    status: 'threshold-progress',
    unlocked: false,
    progressPercent,
    thresholdPaise: threshold,
    remainingPaise,
    subtotalPaise,
    chargePaise,
    badgeText: 'FREE DELIVERY',
    headline: `Add ${formatBannerRupees(remainingPaise)} more for FREE delivery`,
    subtext: `Free delivery on orders of ${formatBannerRupees(threshold)} or more (standard shipping ${formatBannerRupees(chargePaise)}).`,
    progressLabel: `${formatBannerRupees(subtotalPaise)} / ${formatBannerRupees(threshold)}`,
  };
}

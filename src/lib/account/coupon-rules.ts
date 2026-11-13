import {
  couponEligibilityRejection,
  normalizeEmail,
  type CouponEligibilityContext,
  type CouponEligibilityDefinition,
  type CouponScope,
  type CouponType,
} from '@/lib/coupons/rules';
import { formatPaise } from '@/lib/store-admin/amount';

export interface CustomerCouponView {
  id: string;
  code: string;
  valueDisplay: string;
  scopeDisplay: string;
  minOrderPaise: number;
  minOrderDisplay: string;
  expiresAt: string | null;
  expiryDisplay: string;
  remainingUses: number | null;
  remainingDisplay: string;
  source?: 'admin' | 'spin_wheel';
}

/** Server-side selection input, never serialized to a customer. */
export interface DiscoverableCoupon extends CouponEligibilityDefinition {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  scope: CouponScope;
  minOrderPaise: number;
  showToAllUsers: boolean;
  assignedToEmails: string[] | null;
  assignedCustomerGroups: string[] | null;
  source?: 'admin' | 'spin_wheel';
}

/** Discovery grants never override the independent AND redemption restrictions. */
export function customerCanDiscoverCoupon(
  coupon: DiscoverableCoupon,
  context: CouponEligibilityContext,
  couponsEnabled: boolean,
): boolean {
  if (!couponsEnabled || !context.customer.userId) return false;
  if (couponEligibilityRejection(coupon, context)) return false;

  const email = normalizeEmail(context.customer.email);
  const group = context.customer.group?.trim().toLowerCase() || '';
  return coupon.showToAllUsers
    || Boolean(email && coupon.assignedToEmails?.some((entry) => normalizeEmail(entry) === email))
    || Boolean(group && coupon.assignedCustomerGroups?.some((entry) => entry.trim().toLowerCase() === group));
}

/** Explicit allowlist: no raw rows, recipients, restrictions or global counts. */
export function customerCouponView(
  coupon: DiscoverableCoupon,
  customerRedemptions: number,
): CustomerCouponView {
  const remainingUses = coupon.perCustomerLimit === null
    ? null : Math.max(0, coupon.perCustomerLimit - customerRedemptions);
  const expiresAt = coupon.endsAt ? new Date(coupon.endsAt).toISOString() : null;
  const scopeLabels: Record<CouponScope, string> = {
    ORDER: 'Entire order',
    PRODUCTS: 'Selected products',
    CATEGORIES: 'Selected categories',
    BRANDS: 'Selected brands',
  };
  return {
    id: coupon.id,
    code: coupon.code,
    valueDisplay: coupon.type === 'FREE_SHIPPING' ? 'Free shipping'
      : coupon.type === 'PERCENT' ? `${coupon.value}% off` : `${formatPaise(coupon.value)} off`,
    scopeDisplay: scopeLabels[coupon.scope],
    minOrderPaise: coupon.minOrderPaise,
    minOrderDisplay: coupon.minOrderPaise > 0
      ? `${formatPaise(coupon.minOrderPaise)} min. order` : 'No minimum',
    expiresAt,
    expiryDisplay: expiresAt ? `Expires ${new Date(expiresAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    })}` : 'No expiry date',
    remainingUses,
    remainingDisplay: remainingUses === null ? 'Available'
      : `${remainingUses} use${remainingUses === 1 ? '' : 's'} remaining`,
    ...(coupon.source === 'spin_wheel' ? { source: 'spin_wheel' as const } : {}),
  };
}

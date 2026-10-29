/**
 * Pure coupon rules. No database, no clock, no request.
 *
 * The caller loads the coupon row, its targets and the customer's counts from
 * the database on the database clock, then passes them in. Everything that
 * decides whether a code is valid and how much it takes off happens here, so
 * the checkout transaction and the validation endpoint cannot disagree.
 *
 * Money is integer paise throughout. A percentage is floored to whole paise,
 * then capped. The discount never exceeds the eligible subtotal and never
 * takes the payable below PayU's accepted floor.
 */

/**
 * PayU India's documented floor for a domestic transaction is ₹1. The code
 * previously sent `0.00` without a guard; coupon evaluation never lets a
 * discount bring the payable below this, and a cart that cannot reach it is
 * rejected rather than sent to the gateway.
 */
export const MIN_PAYABLE_PAISE = 100;

export const COUPON_CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;
export const COUPON_CODE_HELP =
  'Use 3 to 32 letters, digits or hyphens.';

export type CouponType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
export type CouponScope = 'ORDER' | 'PRODUCTS' | 'CATEGORIES' | 'BRANDS';
export type CouponStatus = 'active' | 'paused' | 'archived';

export interface CouponTarget {
  productId?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
}

export interface CouponDefinition {
  id: string;
  code: string;
  name: string;
  type: CouponType;
  /** Percent for PERCENT, paise for FIXED, unused for FREE_SHIPPING. */
  value: number;
  scope: CouponScope;
  status: CouponStatus;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  totalRedemptionLimit: number | null;
  perCustomerLimit: number | null;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  onlyNewCustomers: boolean;
  allowWithSalePrice: boolean;
  allowedCustomerGroups: string[] | null;
  restrictedToEmails: string[] | null;
  targets: CouponTarget[];
}

/** One cart line, as resolved from the database, plus its scope metadata. */
export interface CouponLine {
  productId: string;
  categoryId: string | null;
  brandId: string | null;
  quantity: number;
  unitPaise: number;
  linePaise: number;
  /** True when this line is charged at a live sale price. */
  onSale: boolean;
}

export interface CouponCustomer {
  userId: string | null;
  email: string;
  group: string | null;
}

export interface CouponContext {
  /** The database clock, read with `now()` by the caller. */
  now: Date;
  /** Full cart subtotal after sale prices, before any discount. */
  subtotalPaise: number;
  shippingPaise: number;
  customer: CouponCustomer;
  /** Any earlier PAID order for this user or normalized email. */
  customerPaidOrderExists: boolean;
  /** RESERVED + CONSUMED uses by this user or normalized email. */
  customerRedemptions: number;
  /** RESERVED + CONSUMED uses across all customers. */
  totalRedemptions: number;
}

export type CouponRejectReason =
  | 'invalid_code'
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'used_up'
  | 'already_used'
  | 'not_eligible_customer'
  | 'min_order'
  | 'sale_items_excluded'
  | 'no_eligible_items'
  | 'no_discount'
  | 'below_minimum_payable';

export type CouponEvaluation =
  | {
      ok: true;
      /** Total discount in paise. Zero for FREE_SHIPPING, which cuts shipping. */
      discountPaise: number;
      /** Shipping after the coupon (0 for FREE_SHIPPING). */
      shippingPaise: number;
      /** subtotal - discount + shipping, never negative. */
      totalPaise: number;
      /** Per-cart-line discount allocation; sums to discountPaise. */
      allocations: number[];
      /** Indexes of the lines the discount was spread over. */
      eligibleLineIndexes: number[];
      /** Safe customer-facing note, or null. Never contains coupon internals. */
      message: string | null;
    }
  | {
      ok: false;
      reason: CouponRejectReason;
      /** Safe customer-facing message. Never contains coupon internals. */
      message: string;
    };

/** Uppercase, trimmed. This is the only stored form. */
export function normalizeCouponCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidCouponCode(value: unknown): boolean {
  return COUPON_CODE_PATTERN.test(normalizeCouponCode(value));
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rupees(paise: number): string {
  const safe = Number.isFinite(paise) && paise > 0 ? paise : 0;
  const whole = safe % 100 === 0;
  return `₹${(safe / 100).toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function couponRejectionMessage(
  reason: CouponRejectReason,
  minOrderPaise = 0,
): string {
  switch (reason) {
    case 'expired':
      return 'This code has expired.';
    case 'min_order':
      return minOrderPaise > 0
        ? `This code needs a minimum order of ${rupees(minOrderPaise)}.`
        : 'This code needs a minimum order.';
    case 'already_used':
      return 'You have already used this code.';
    case 'sale_items_excluded':
      return 'This code is not valid on sale items.';
    case 'no_discount':
      return 'This code does not take anything off this order.';
    case 'not_eligible_customer':
      return 'This code is not valid for this account.';
    case 'used_up':
      return 'This code is no longer available.';
    // `not_found`, `inactive`, `not_started`, a scope miss and a malformed
    // code all answer the same way, so a caller cannot probe for codes.
    default:
      return 'This code is not valid for your cart.';
  }
}

function reject(
  reason: CouponRejectReason,
  minOrderPaise = 0,
): CouponEvaluation {
  return {
    ok: false,
    reason,
    message: couponRejectionMessage(reason, minOrderPaise),
  };
}

/** Does this line fall inside the coupon's product / category / brand scope? */
export function lineMatchesScope(
  line: Pick<CouponLine, 'productId' | 'categoryId' | 'brandId'>,
  scope: CouponScope,
  targets: ReadonlyArray<CouponTarget>,
): boolean {
  if (scope === 'ORDER') return true;
  if (targets.length === 0) return false;

  const productId = normalizeId(line.productId);
  const categoryId = normalizeId(line.categoryId);
  const brandId = normalizeId(line.brandId);

  return targets.some((target) => {
    if (scope === 'PRODUCTS') {
      return Boolean(target.productId) && normalizeId(target.productId) === productId;
    }
    if (scope === 'CATEGORIES') {
      return Boolean(target.categoryId) && normalizeId(target.categoryId) === categoryId;
    }
    return Boolean(target.brandId) && normalizeId(target.brandId) === brandId;
  });
}

/**
 * Spread `discountPaise` over the eligible lines in proportion to their line
 * value, in whole paise. Floors first, then the largest fractional parts get
 * the remaining paise (Hamilton), so the allocations always sum exactly and
 * never exceed a line's own value.
 */
export function allocateDiscount(
  discountPaise: number,
  lines: ReadonlyArray<CouponLine>,
  eligibleLineIndexes: ReadonlyArray<number>,
): number[] {
  const allocations = lines.map(() => 0);
  if (!Number.isInteger(discountPaise) || discountPaise <= 0) return allocations;
  if (eligibleLineIndexes.length === 0) return allocations;

  const eligibleTotal = eligibleLineIndexes.reduce(
    (sum, index) => sum + Math.max(0, lines[index].linePaise),
    0,
  );
  if (eligibleTotal <= 0) return allocations;

  const capped = Math.min(discountPaise, eligibleTotal);
  const fractions: Array<{ index: number; remainder: number; linePaise: number }> = [];
  let assigned = 0;

  for (const index of eligibleLineIndexes) {
    const linePaise = Math.max(0, lines[index].linePaise);
    const numerator = capped * linePaise;
    const share = Math.floor(numerator / eligibleTotal);
    const remainder = numerator % eligibleTotal;
    allocations[index] = share;
    assigned += share;
    fractions.push({ index, remainder, linePaise });
  }

  let left = capped - assigned;
  fractions.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    if (b.linePaise !== a.linePaise) return b.linePaise - a.linePaise;
    return a.index - b.index;
  });
  for (const entry of fractions) {
    if (left <= 0) break;
    if (allocations[entry.index] < lines[entry.index].linePaise) {
      allocations[entry.index] += 1;
      left -= 1;
    }
  }

  return allocations;
}

/**
 * The one decision. Returns either the money to charge or a safe reason.
 *
 * Order of checks matters: cheap and definitive reasons first, then customer
 * eligibility, then limits, then the cart. No branch reveals a limit, a
 * target list or another customer's use.
 */
export function evaluateCoupon(input: {
  coupon: CouponDefinition;
  lines: ReadonlyArray<CouponLine>;
  context: CouponContext;
}): CouponEvaluation {
  const { coupon, lines, context } = input;
  const now = toDate(context.now);
  if (!now) return reject('inactive');

  if (coupon.status !== 'active') return reject('inactive');

  const startsAt = toDate(coupon.startsAt);
  const endsAt = toDate(coupon.endsAt);
  if (startsAt && now.getTime() < startsAt.getTime()) return reject('not_started');
  if (endsAt && now.getTime() >= endsAt.getTime()) return reject('expired');

  // Customer eligibility. A guest has no group; a restricted coupon needs a
  // signed-in group, so the group check fails closed for guests.
  const email = normalizeEmail(context.customer.email);
  if (coupon.restrictedToEmails && coupon.restrictedToEmails.length > 0) {
    const allowed = coupon.restrictedToEmails.map(normalizeEmail).filter(Boolean);
    if (!email || !allowed.includes(email)) return reject('not_eligible_customer');
  }
  if (coupon.allowedCustomerGroups && coupon.allowedCustomerGroups.length > 0) {
    const group = normalizeId(context.customer.group);
    const allowed = coupon.allowedCustomerGroups.map(normalizeId).filter(Boolean);
    if (!group || !allowed.includes(group)) return reject('not_eligible_customer');
  }
  if (coupon.onlyNewCustomers && context.customerPaidOrderExists) {
    return reject('not_eligible_customer');
  }

  if (
    coupon.totalRedemptionLimit !== null
    && context.totalRedemptions >= coupon.totalRedemptionLimit
  ) {
    return reject('used_up');
  }
  if (
    coupon.perCustomerLimit !== null
    && context.customerRedemptions >= coupon.perCustomerLimit
  ) {
    return reject('already_used');
  }

  if (context.subtotalPaise < Math.max(0, coupon.minOrderPaise)) {
    return reject('min_order', coupon.minOrderPaise);
  }

  // Scope, then the sale-price rule. `scopeMatched` lets the rejection say
  // "not valid on sale items" without exposing any other rule.
  const scopeMatched: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lineMatchesScope(lines[index], coupon.scope, coupon.targets)) {
      scopeMatched.push(index);
    }
  }
  const eligibleLineIndexes = coupon.allowWithSalePrice
    ? scopeMatched
    : scopeMatched.filter((index) => !lines[index].onSale);

  if (eligibleLineIndexes.length === 0) {
    if (scopeMatched.length > 0) return reject('sale_items_excluded');
    return reject('no_eligible_items');
  }

  const eligibleSubtotal = eligibleLineIndexes.reduce(
    (sum, index) => sum + Math.max(0, lines[index].linePaise),
    0,
  );
  if (eligibleSubtotal <= 0) return reject('no_eligible_items');

  let shippingPaise = Math.max(0, Math.trunc(context.shippingPaise));
  const originalShippingPaise = shippingPaise;
  let rawDiscount = 0;

  if (coupon.type === 'PERCENT') {
    const percent = Math.trunc(coupon.value);
    if (percent < 1 || percent > 100) return reject('inactive');
    rawDiscount = Math.floor((eligibleSubtotal * percent) / 100);
    if (coupon.maxDiscountPaise !== null && coupon.maxDiscountPaise >= 0) {
      rawDiscount = Math.min(rawDiscount, Math.trunc(coupon.maxDiscountPaise));
    }
  } else if (coupon.type === 'FIXED') {
    rawDiscount = Math.min(Math.max(0, Math.trunc(coupon.value)), eligibleSubtotal);
  } else if (coupon.type === 'FREE_SHIPPING') {
    shippingPaise = 0;
  } else {
    return reject('inactive');
  }

  rawDiscount = Math.min(rawDiscount, eligibleSubtotal);

  // Never send PayU less than its accepted floor. The discount is reduced,
  // not the order rejected, unless even a zero discount cannot reach ₹1.
  const payableBefore = Math.max(0, context.subtotalPaise) + shippingPaise;
  const discountCeiling = Math.max(0, payableBefore - MIN_PAYABLE_PAISE);
  const discountPaise = Math.min(rawDiscount, discountCeiling);
  const totalPaise = Math.max(
    0,
    Math.max(0, context.subtotalPaise) - discountPaise + shippingPaise,
  );

  if (totalPaise < MIN_PAYABLE_PAISE) return reject('below_minimum_payable');

  // A code that changes nothing — no line discount and no shipping saving —
  // would consume a use and show the customer no benefit. Free shipping on an
  // order that already ships free, or a percentage that floors to zero paise,
  // is refused here so the checkout never records a zero-value redemption.
  if (discountPaise === 0 && shippingPaise === originalShippingPaise) {
    return reject('no_discount');
  }

  const allocations = allocateDiscount(
    discountPaise,
    lines,
    eligibleLineIndexes,
  );

  const notes: string[] = [];
  if (rawDiscount > discountPaise) {
    notes.push('The discount was adjusted to keep the order payable.');
  }
  if (!coupon.allowWithSalePrice && scopeMatched.length > eligibleLineIndexes.length) {
    notes.push('Not valid on sale items.');
  }

  return {
    ok: true,
    discountPaise,
    shippingPaise,
    totalPaise,
    allocations,
    eligibleLineIndexes,
    message: notes.length > 0 ? notes.join(' ') : null,
  };
}

/** The part of a coupon that may be copied into an order snapshot. */
export function couponSnapshot(
  coupon: CouponDefinition,
  discountPaise: number,
): {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  scope: CouponScope;
  discountPaise: number;
} {
  return {
    id: coupon.id,
    code: normalizeCouponCode(coupon.code),
    type: coupon.type,
    value: coupon.value,
    scope: coupon.scope,
    discountPaise,
  };
}

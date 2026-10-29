/**
 * Coupon form parsing and list-state rules. Pure and database-free, so the
 * client form and the write routes validate with the same code.
 *
 * Money enters as a rupee string and leaves as integer paise through the
 * shared parser. Percentages stay whole numbers.
 */
import {
  COUPON_CODE_HELP,
  COUPON_CODE_PATTERN,
  isValidCouponCode,
  normalizeCouponCode,
  normalizeEmail,
  type CouponScope,
  type CouponStatus,
  type CouponTarget,
  type CouponType,
} from '@/lib/coupons/rules';

import { MAX_PRICE_PAISE, parseRupeesToPaise } from './money';

export const COUPON_NAME_LIMIT = 120;
export const COUPON_DESCRIPTION_LIMIT = 500;
export const COUPON_MAX_TARGETS = 200;
export const COUPON_MAX_EMAILS = 200;
export const COUPON_MAX_GROUPS = 20;
export const COUPON_CODE_HINT = COUPON_CODE_HELP;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TARGET_ID_PATTERN = /^\S{1,120}$/;

export interface CouponInput {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  type?: unknown;
  /** Percent for PERCENT, rupees for FIXED, ignored for FREE_SHIPPING. */
  value?: unknown;
  scope?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  totalRedemptionLimit?: unknown;
  perCustomerLimit?: unknown;
  minOrderRupees?: unknown;
  maxDiscountRupees?: unknown;
  onlyNewCustomers?: unknown;
  allowWithSalePrice?: unknown;
  allowedCustomerGroups?: unknown;
  restrictedToEmails?: unknown;
  productIds?: unknown;
  categoryIds?: unknown;
  brandIds?: unknown;
}

export interface CouponValues {
  code: string;
  name: string;
  description: string;
  type: CouponType;
  /** Percent (1–100) for PERCENT, paise for FIXED, 0 for FREE_SHIPPING. */
  value: number;
  scope: CouponScope;
  startsAt: Date | null;
  endsAt: Date | null;
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

export type CouponParse = { ok: true; values: CouponValues } | { ok: false; error: string };

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === 1;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id) seen.add(id);
  }
  return [...seen].slice(0, COUPON_MAX_TARGETS);
}

function optionalPositiveInt(value: unknown, label: string): number | null | string {
  const raw = stringValue(value);
  if (!raw) return null;
  if (!/^\d{1,7}$/.test(raw)) return `Enter ${label} as a whole number greater than zero.`;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return `Enter ${label} as a whole number greater than zero.`;
  }
  return parsed;
}

function parseDate(value: unknown, label: string): Date | null | string {
  const raw = stringValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return `${label} is not a valid date and time.`;
  return date;
}

/** Parse a staff form into the exact stored shape. */
export function parseCouponInput(input: CouponInput): CouponParse {
  const code = normalizeCouponCode(input.code);
  if (!isValidCouponCode(code) || !COUPON_CODE_PATTERN.test(code)) {
    return { ok: false, error: `Enter a code. ${COUPON_CODE_HINT}` };
  }

  const name = stringValue(input.name);
  if (name.length > COUPON_NAME_LIMIT) {
    return { ok: false, error: `The name must be ${COUPON_NAME_LIMIT} characters or fewer.` };
  }
  const description = stringValue(input.description);
  if (description.length > COUPON_DESCRIPTION_LIMIT) {
    return {
      ok: false,
      error: `The description must be ${COUPON_DESCRIPTION_LIMIT} characters or fewer.`,
    };
  }

  const type = stringValue(input.type).toUpperCase();
  if (type !== 'PERCENT' && type !== 'FIXED' && type !== 'FREE_SHIPPING') {
    return { ok: false, error: 'Choose a discount type.' };
  }

  const scope = stringValue(input.scope).toUpperCase() || 'ORDER';
  if (
    scope !== 'ORDER'
    && scope !== 'PRODUCTS'
    && scope !== 'CATEGORIES'
    && scope !== 'BRANDS'
  ) {
    return { ok: false, error: 'Choose what the coupon applies to.' };
  }

  let value = 0;
  if (type === 'PERCENT') {
    const raw = stringValue(input.value);
    if (!/^\d{1,3}$/.test(raw)) {
      return { ok: false, error: 'Enter a whole percentage between 1 and 100.' };
    }
    value = Number(raw);
    if (value < 1 || value > 100) {
      return { ok: false, error: 'Enter a whole percentage between 1 and 100.' };
    }
  } else if (type === 'FIXED') {
    const parsed = parseRupeesToPaise(input.value);
    if (!parsed.ok) return { ok: false, error: parsed.message };
    if (parsed.paise === null || parsed.paise <= 0) {
      return { ok: false, error: 'Enter a discount amount greater than zero.' };
    }
    if (parsed.paise > MAX_PRICE_PAISE) {
      return { ok: false, error: 'That discount is too large.' };
    }
    value = parsed.paise;
  }

  const startsAt = parseDate(input.startsAt, 'The start date');
  if (typeof startsAt === 'string') return { ok: false, error: startsAt };
  const endsAt = parseDate(input.endsAt, 'The end date');
  if (typeof endsAt === 'string') return { ok: false, error: endsAt };
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: 'The end date must be after the start date.' };
  }

  const totalRedemptionLimit = optionalPositiveInt(
    input.totalRedemptionLimit,
    'the total redemption limit',
  );
  if (typeof totalRedemptionLimit === 'string') {
    return { ok: false, error: totalRedemptionLimit };
  }
  const perCustomerLimit = optionalPositiveInt(
    input.perCustomerLimit,
    'the per-customer limit',
  );
  if (typeof perCustomerLimit === 'string') {
    return { ok: false, error: perCustomerLimit };
  }

  const minOrder = parseRupeesToPaise(input.minOrderRupees);
  if (!minOrder.ok) return { ok: false, error: minOrder.message };
  const minOrderPaise = minOrder.paise ?? 0;
  if (minOrderPaise < 0 || minOrderPaise > MAX_PRICE_PAISE) {
    return { ok: false, error: 'That minimum order amount is not valid.' };
  }

  let maxDiscountPaise: number | null = null;
  if (type === 'PERCENT') {
    const parsed = parseRupeesToPaise(input.maxDiscountRupees);
    if (!parsed.ok) return { ok: false, error: parsed.message };
    if (parsed.paise !== null) {
      if (parsed.paise <= 0) {
        return { ok: false, error: 'The maximum discount must be greater than zero, or blank.' };
      }
      if (parsed.paise > MAX_PRICE_PAISE) {
        return { ok: false, error: 'That maximum discount is too large.' };
      }
      maxDiscountPaise = parsed.paise;
    }
  }

  const groupsRaw = Array.isArray(input.allowedCustomerGroups)
    ? input.allowedCustomerGroups
    : stringValue(input.allowedCustomerGroups).split(',');
  const groups = [...new Set(groupsRaw.map(stringValue).filter(Boolean))];
  if (groups.length > COUPON_MAX_GROUPS) {
    return { ok: false, error: `Choose at most ${COUPON_MAX_GROUPS} customer groups.` };
  }
  if (groups.some((group) => group.length > 40)) {
    return { ok: false, error: 'Each customer group name must be 40 characters or fewer.' };
  }

  const emailsRaw = Array.isArray(input.restrictedToEmails)
    ? input.restrictedToEmails.map(String)
    : stringValue(input.restrictedToEmails).split(/[\s,;]+/);
  const emails = [...new Set(emailsRaw.map(normalizeEmail).filter(Boolean))];
  if (emails.length > COUPON_MAX_EMAILS) {
    return { ok: false, error: `Add at most ${COUPON_MAX_EMAILS} email addresses.` };
  }
  const badEmail = emails.find((email) => !EMAIL_PATTERN.test(email));
  if (badEmail) {
    return { ok: false, error: 'One of the restricted email addresses is not valid.' };
  }

  const productIds = idList(input.productIds);
  const categoryIds = idList(input.categoryIds);
  const brandIds = idList(input.brandIds);
  for (const id of [...productIds, ...categoryIds, ...brandIds]) {
    if (!TARGET_ID_PATTERN.test(id)) {
      return { ok: false, error: 'One of the selected targets is not valid.' };
    }
  }

  let targets: CouponTarget[] = [];
  if (scope === 'PRODUCTS') {
    if (productIds.length === 0) return { ok: false, error: 'Choose at least one product.' };
    targets = productIds.map((productId) => ({ productId }));
  } else if (scope === 'CATEGORIES') {
    if (categoryIds.length === 0) return { ok: false, error: 'Choose at least one category.' };
    targets = categoryIds.map((categoryId) => ({ categoryId }));
  } else if (scope === 'BRANDS') {
    if (brandIds.length === 0) return { ok: false, error: 'Choose at least one brand.' };
    targets = brandIds.map((brandId) => ({ brandId }));
  }

  return {
    ok: true,
    values: {
      code,
      name,
      description,
      type,
      value,
      scope,
      startsAt,
      endsAt,
      totalRedemptionLimit,
      perCustomerLimit,
      minOrderPaise,
      maxDiscountPaise,
      onlyNewCustomers: boolValue(input.onlyNewCustomers),
      allowWithSalePrice: boolValue(input.allowWithSalePrice),
      allowedCustomerGroups: groups.length > 0 ? groups : null,
      restrictedToEmails: emails.length > 0 ? emails : null,
      targets,
    },
  };
}

/**
 * The shape written to `store_admin_audit` before/after.
 *
 * The restricted email list is customer PII, so only its size is recorded.
 * Everything else is a rule setting, not personal data.
 */
export function couponAuditSnapshot(values: {
  code: string;
  name: string;
  type: string;
  value: number;
  scope: string;
  status?: string;
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
  targets: unknown[];
}): Record<string, unknown> {
  return {
    code: values.code,
    name: values.name,
    type: values.type,
    value: values.value,
    scope: values.scope,
    ...(values.status ? { status: values.status } : {}),
    startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
    endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
    totalRedemptionLimit: values.totalRedemptionLimit,
    perCustomerLimit: values.perCustomerLimit,
    minOrderPaise: values.minOrderPaise,
    maxDiscountPaise: values.maxDiscountPaise,
    onlyNewCustomers: values.onlyNewCustomers,
    allowWithSalePrice: values.allowWithSalePrice,
    customerGroups: values.allowedCustomerGroups?.length ?? 0,
    restrictedEmails: values.restrictedToEmails?.length ?? 0,
    targets: values.targets.length,
  };
}

/** The same audit shape, read from a stored row rather than a submitted form. */
export function couponAuditFromRow(row: {
  code: string;
  name: string;
  type: string;
  value: number;
  scope: string;
  status: string;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  totalRedemptionLimit: number | null;
  perCustomerLimit: number | null;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  onlyNewCustomers: boolean;
  allowWithSalePrice: boolean;
  allowedCustomerGroups: string[] | null;
  restrictedToEmails: string[] | null;
  targetCount: number;
}): Record<string, unknown> {
  return couponAuditSnapshot({
    code: row.code,
    name: row.name,
    type: row.type,
    value: row.value,
    scope: row.scope,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    totalRedemptionLimit: row.totalRedemptionLimit,
    perCustomerLimit: row.perCustomerLimit,
    minOrderPaise: row.minOrderPaise,
    maxDiscountPaise: row.maxDiscountPaise,
    onlyNewCustomers: row.onlyNewCustomers,
    allowWithSalePrice: row.allowWithSalePrice,
    allowedCustomerGroups: row.allowedCustomerGroups,
    restrictedToEmails: row.restrictedToEmails,
    targets: new Array(Math.max(0, row.targetCount)).fill(null),
  });
}

/* ------------------------------------------------------------ list state */

export type CouponBadgeTone =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'used-up'
  | 'paused'
  | 'archived';

export interface CouponBadge {
  label: string;
  tone: CouponBadgeTone;
}

export function couponBadge(input: {
  status: CouponStatus | string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
}): CouponBadge {
  const now = Date.now();
  const starts = input.startsAt ? new Date(input.startsAt).getTime() : null;
  const ends = input.endsAt ? new Date(input.endsAt).getTime() : null;

  if (input.status === 'archived') return { label: 'Archived', tone: 'archived' };
  if (input.status === 'paused') return { label: 'Paused', tone: 'paused' };
  if (ends !== null && Number.isFinite(ends) && now >= ends) {
    return { label: 'Expired', tone: 'expired' };
  }
  if (starts !== null && Number.isFinite(starts) && now < starts) {
    return { label: 'Scheduled', tone: 'scheduled' };
  }
  return { label: 'Active', tone: 'active' };
}

/** The badge plus the "used up" state, which depends on the redemption count. */
export function couponListBadge(input: {
  status: CouponStatus | string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  used: number;
  totalLimit: number | null;
}): CouponBadge {
  const base = couponBadge({
    status: input.status,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
  if (base.tone === 'active' && input.totalLimit !== null && input.used >= input.totalLimit) {
    return { label: 'Used up', tone: 'used-up' };
  }
  return base;
}

export function couponValueLabel(type: CouponType | string, value: number): string {
  if (type === 'PERCENT') return `${value}%`;
  if (type === 'FIXED') return `₹${(value / 100).toLocaleString('en-IN', {
    minimumFractionDigits: value % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
  return 'Free shipping';
}

export function couponScopeLabel(scope: CouponScope | string): string {
  if (scope === 'PRODUCTS') return 'Products';
  if (scope === 'CATEGORIES') return 'Categories';
  if (scope === 'BRANDS') return 'Brands';
  return 'Whole order';
}

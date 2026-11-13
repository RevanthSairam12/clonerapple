/**
 * Pure Free Gift promotion rules.
 *
 * No database, no React, no Next.js imports, no wall-clock calls.
 * Shares `computeEligibleSubtotalPaise` with shipping rules so free-shipping
 * thresholds and Free Gift thresholds can never diverge.
 */

import {
  computeEligibleSubtotalPaise,
  type EligibleSubtotalLine,
} from '@/lib/checkout/shipping-rules';
import { formatRupees, parseRupeesToPaise } from '@/lib/store-admin/money';

export { computeEligibleSubtotalPaise };

export type FreeGiftCouponInteraction = 'allow' | 'disallow';

export interface FreeGiftRuleRecord {
  id: string;
  name: string;
  giftProductId: string;
  giftVariantId: string | null;
  targetPaise: number;
  iconUrl: string;
  badgeText: string;
  unlockMessage: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  showOnProductPage: boolean;
  maxGiftsTotal: number | null;
  claimedCount: number;
  perCustomerLimit: number | null;
  customerClaimedCount: number;
  priority: number;
  couponInteraction: FreeGiftCouponInteraction;
  minPostCouponPaise: number;
  unavailableCheckoutCount: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface FreeGiftCatalogSnapshot {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  variantSku: string | null;
  regularPricePaise: number;
  imageUrl: string | null;
  imageAlt: string | null;
  productActive: boolean;
  variantActive: boolean;
  isGiftOnly: boolean;
  trackInventory: boolean;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  categoryId: string | null;
  brandId: string | null;
  variantDeviceModelId: string | null;
  variantDeviceModelName: string | null;
  variantColourId: string | null;
  variantColourName: string | null;
  variantColourHex: string | null;
}

export interface FreeGiftRuleWithSnapshot {
  rule: FreeGiftRuleRecord;
  gift: FreeGiftCatalogSnapshot | null;
}

export interface UnlockedFreeGift {
  source: 'threshold';
  ruleId: string;
  ruleName: string;
  targetPaise: number;
  badgeText: string;
  unlockMessage: string;
  iconUrl: string | null;
  gift: FreeGiftCatalogSnapshot;
}

export interface FreeGiftProgressNudge {
  ruleId: string;
  ruleName: string;
  targetPaise: number;
  remainingPaise: number;
  progressPercent: number;
  giftName: string;
  giftVariantLabel: string | null;
  iconUrl: string | null;
  badgeText: string;
  message: string;
}

export type FreeGiftConflictReason =
  | 'out_of_stock'
  | 'cap_reached'
  | 'customer_limit'
  | 'coupon_disallowed'
  | 'below_post_coupon_minimum';

export interface FreeGiftConflict {
  ruleId: string;
  ruleName: string;
  giftName: string;
  reason: FreeGiftConflictReason;
  message: string;
}

export interface FreeGiftEvaluation {
  eligibleSubtotalPaise: number;
  paidSubtotalAfterCouponPaise: number;
  unlockedGift: UnlockedFreeGift | null;
  nextNudge: FreeGiftProgressNudge | null;
  conflict: FreeGiftConflict | null;
  /** True when a higher threshold matched but coupon/post-coupon rules blocked it. */
  blockedByCouponMessage: string | null;
}

export interface CouponFreeGiftPreview {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  regularPricePaise: number;
  imageUrl: string | null;
  badge: string;
  source: 'spin_wheel';
}

export interface UnlockedThresholdGiftPreview {
  ruleId: string;
  ruleName: string;
  targetPaise: number;
  badgeText: string;
  unlockMessage: string;
  iconUrl: string | null;
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  regularPricePaise: number;
  imageUrl: string | null;
}

export interface ProductPageGiftPromo {
  ruleId: string;
  targetPaise: number;
  giftName: string;
  badgeText: string;
  iconUrl: string | null;
  unlockMessage: string;
}

export interface CartFreeGiftEvaluateResponse {
  ok: true;
  eligibleSubtotalPaise: number;
  paidSubtotalAfterCouponPaise: number;
  unlockedGift: UnlockedThresholdGiftPreview | null;
  spinFreeGift: CouponFreeGiftPreview | null;
  nextNudge: FreeGiftProgressNudge | null;
  conflict: FreeGiftConflict | null;
  blockedByCouponMessage: string | null;
}

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export function isGiftSnapshotInStock(gift: FreeGiftCatalogSnapshot | null): boolean {
  if (!gift) return false;
  if (!gift.productActive || !gift.variantActive) return false;
  if (!gift.trackInventory) return true;
  return gift.onHand - gift.reserved >= 1;
}

export function isFreeGiftRuleRunning(rule: FreeGiftRuleRecord, now: Date): boolean {
  if (!rule.isActive || rule.archivedAt) return false;
  const nowMs = now.getTime();
  if (rule.startsAt) {
    const starts = Date.parse(rule.startsAt);
    if (Number.isFinite(starts) && nowMs < starts) return false;
  }
  if (rule.endsAt) {
    const ends = Date.parse(rule.endsAt);
    if (Number.isFinite(ends) && nowMs >= ends) return false;
  }
  return true;
}

function ruleSortDesc(a: FreeGiftRuleWithSnapshot, b: FreeGiftRuleWithSnapshot): number {
  if (b.rule.targetPaise !== a.rule.targetPaise) {
    return b.rule.targetPaise - a.rule.targetPaise;
  }
  if (b.rule.priority !== a.rule.priority) {
    return b.rule.priority - a.rule.priority;
  }
  const aCreated = Date.parse(a.rule.createdAt) || 0;
  const bCreated = Date.parse(b.rule.createdAt) || 0;
  if (aCreated !== bCreated) {
    return aCreated - bCreated;
  }
  return a.rule.id.localeCompare(b.rule.id);
}

function isRuleAvailable(entry: FreeGiftRuleWithSnapshot): {
  ok: true;
} | {
  ok: false;
  reason: 'cap_reached' | 'customer_limit' | 'out_of_stock';
} {
  const { rule, gift } = entry;
  if (rule.maxGiftsTotal !== null && rule.claimedCount >= rule.maxGiftsTotal) {
    return { ok: false, reason: 'cap_reached' };
  }
  if (rule.perCustomerLimit !== null && rule.customerClaimedCount >= rule.perCustomerLimit) {
    return { ok: false, reason: 'customer_limit' };
  }
  if (!isGiftSnapshotInStock(gift)) {
    return { ok: false, reason: 'out_of_stock' };
  }
  return { ok: true };
}

function resolveGiftIconUrl(rule: FreeGiftRuleRecord, gift: FreeGiftCatalogSnapshot | null): string | null {
  const custom = rule.iconUrl.trim();
  if (custom) return custom;
  return gift?.imageUrl ?? null;
}

/**
 * Evaluate which single threshold Free Gift (if any) unlocks for the given bag,
 * and which next spend tier to show as a progress nudge.
 *
 * Rules:
 * - Eligible subtotal uses sale-priced items BEFORE coupons, excluding free gifts,
 *   shipping, and tax.
 * - Maximum 1 threshold gift per order.
 * - Highest qualifying threshold wins; ties break by priority desc, then oldest rule.
 * - No automatic fallback if the highest qualifying rule is out of stock or capped:
 *   surface a clear conflict so checkout can warn the customer to continue without
 *   the gift instead of quietly substituting another gift.
 */
export function evaluateFreeGiftRules(input: {
  now: Date;
  lines: readonly EligibleSubtotalLine[];
  discountPaise: number;
  couponApplied: boolean;
  rules: readonly FreeGiftRuleWithSnapshot[];
}): FreeGiftEvaluation {
  const eligibleSubtotalPaise = computeEligibleSubtotalPaise(input.lines);
  const discountPaise = Math.max(0, Math.trunc(input.discountPaise));
  const paidSubtotalAfterCouponPaise = Math.max(0, eligibleSubtotalPaise - discountPaise);

  const running = input.rules.filter((entry) => isFreeGiftRuleRunning(entry.rule, input.now));

  // Find the next achievable threshold above the current subtotal for progress nudging.
  const nextCandidates = running
    .filter((entry) => entry.rule.targetPaise > eligibleSubtotalPaise)
    .filter((entry) => !(input.couponApplied && entry.rule.couponInteraction === 'disallow'))
    .filter((entry) => isRuleAvailable(entry).ok)
    .sort((a, b) => {
      if (a.rule.targetPaise !== b.rule.targetPaise) {
        return a.rule.targetPaise - b.rule.targetPaise;
      }
      return b.rule.priority - a.rule.priority;
    });

  const nextEntry = nextCandidates[0] ?? null;
  const nextNudge: FreeGiftProgressNudge | null = nextEntry && nextEntry.gift
    ? {
        ruleId: nextEntry.rule.id,
        ruleName: nextEntry.rule.name,
        targetPaise: nextEntry.rule.targetPaise,
        remainingPaise: Math.max(1, nextEntry.rule.targetPaise - eligibleSubtotalPaise),
        progressPercent:
          nextEntry.rule.targetPaise > 0
            ? Math.min(100, Math.round((eligibleSubtotalPaise / nextEntry.rule.targetPaise) * 100))
            : 0,
        giftName: nextEntry.gift.productName,
        giftVariantLabel: nextEntry.gift.variantLabel,
        iconUrl: resolveGiftIconUrl(nextEntry.rule, nextEntry.gift),
        badgeText: nextEntry.rule.badgeText,
        message: `Add ${formatRupees(Math.max(1, nextEntry.rule.targetPaise - eligibleSubtotalPaise))} more to unlock a FREE ${nextEntry.gift.productName}`,
      }
    : null;

  if (eligibleSubtotalPaise <= 0) {
    return {
      eligibleSubtotalPaise: 0,
      paidSubtotalAfterCouponPaise: 0,
      unlockedGift: null,
      nextNudge,
      conflict: null,
      blockedByCouponMessage: null,
    };
  }

  const reachedThreshold = running
    .filter((entry) => eligibleSubtotalPaise >= entry.rule.targetPaise)
    .sort(ruleSortDesc);

  const qualifiedAfterCoupon: FreeGiftRuleWithSnapshot[] = [];
  let topBlockedByCoupon: { entry: FreeGiftRuleWithSnapshot; reason: 'coupon_disallowed' | 'below_post_coupon_minimum' } | null = null;

  for (const entry of reachedThreshold) {
    if (input.couponApplied && entry.rule.couponInteraction === 'disallow') {
      if (!topBlockedByCoupon) topBlockedByCoupon = { entry, reason: 'coupon_disallowed' };
      continue;
    }
    if (
      entry.rule.minPostCouponPaise > 0
      && paidSubtotalAfterCouponPaise < entry.rule.minPostCouponPaise
    ) {
      if (!topBlockedByCoupon) topBlockedByCoupon = { entry, reason: 'below_post_coupon_minimum' };
      continue;
    }
    qualifiedAfterCoupon.push(entry);
  }

  const topRule = qualifiedAfterCoupon[0] ?? null;
  const blockedByCouponMessage = topBlockedByCoupon
    ? topBlockedByCoupon.reason === 'coupon_disallowed'
      ? `The free gift "${topBlockedByCoupon.entry.gift?.productName ?? topBlockedByCoupon.entry.rule.name}" does not combine with coupon codes.`
      : `After coupons, at least ${formatRupees(topBlockedByCoupon.entry.rule.minPostCouponPaise)} must remain payable to keep the free gift.`
    : null;

  if (!topRule) {
    return {
      eligibleSubtotalPaise,
      paidSubtotalAfterCouponPaise,
      unlockedGift: null,
      nextNudge,
      conflict:
        topBlockedByCoupon && reachedThreshold[0]?.rule.id === topBlockedByCoupon.entry.rule.id
          ? {
              ruleId: topBlockedByCoupon.entry.rule.id,
              ruleName: topBlockedByCoupon.entry.rule.name,
              giftName: topBlockedByCoupon.entry.gift?.productName ?? topBlockedByCoupon.entry.rule.name,
              reason: topBlockedByCoupon.reason,
              message: blockedByCouponMessage!,
            }
          : null,
      blockedByCouponMessage,
    };
  }

  // Strictly NO automatic fallback when the top qualifying rule lacks stock or hit a cap.
  const availability = isRuleAvailable(topRule);
  if (!availability.ok || !topRule.gift) {
    const giftName = topRule.gift?.productName ?? topRule.rule.name;
    const message =
      availability.ok === false && availability.reason === 'customer_limit'
        ? `Free gift "${giftName}" has reached its per-customer limit for your account.`
        : `Sorry, the free gift "${giftName}" just went out of stock. You can continue checking out without the gift.`;
    return {
      eligibleSubtotalPaise,
      paidSubtotalAfterCouponPaise,
      unlockedGift: null,
      nextNudge: null,
      conflict: {
        ruleId: topRule.rule.id,
        ruleName: topRule.rule.name,
        giftName,
        reason: availability.ok ? 'out_of_stock' : availability.reason,
        message,
      },
      blockedByCouponMessage,
    };
  }

  return {
    eligibleSubtotalPaise,
    paidSubtotalAfterCouponPaise,
    unlockedGift: {
      source: 'threshold',
      ruleId: topRule.rule.id,
      ruleName: topRule.rule.name,
      targetPaise: topRule.rule.targetPaise,
      badgeText: topRule.rule.badgeText,
      unlockMessage: topRule.rule.unlockMessage,
      iconUrl: resolveGiftIconUrl(topRule.rule, topRule.gift),
      gift: topRule.gift,
    },
    nextNudge,
    conflict: null,
    blockedByCouponMessage,
  };
}

/** Determine whether a partial/full refund drops net retained paid items below a gift threshold. */
export function checkFreeGiftReturnThresholdNote(input: {
  orderPaidItemSubtotalPaise: number;
  refundedPaiseTotalAfter: number;
  giftThresholdPaise: number;
  giftProductName: string;
}): string | null {
  if (input.giftThresholdPaise <= 0) return null;
  const remainingPaid = Math.max(
    0,
    Math.trunc(input.orderPaidItemSubtotalPaise) - Math.trunc(input.refundedPaiseTotalAfter),
  );
  if (remainingPaid < input.giftThresholdPaise) {
    return `Free gift (${input.giftProductName}) may need to be returned: remaining paid amount (${formatRupees(remainingPaid)}) fell below the ${formatRupees(input.giftThresholdPaise)} threshold.`;
  }
  return null;
}

export interface ValidatedFreeGiftRuleInput {
  id?: string;
  name: string;
  giftProductId: string;
  giftVariantId: string | null;
  targetPaise: number;
  iconUrl: string;
  badgeText: string;
  unlockMessage: string;
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  isActive: boolean;
  showOnProductPage: boolean;
  maxGiftsTotal: number | null;
  perCustomerLimit: number | null;
  priority: number;
  couponInteraction: FreeGiftCouponInteraction;
  minPostCouponPaise: number;
}

function parseOptionalInt(
  value: unknown,
  min: number,
  max: number,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false, error: `${label} must be a whole number between ${min} and ${max}.` };
  }
  return { ok: true, value: parsed };
}

function parseLocalDate(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !LOCAL_DATETIME_RE.test(value.trim()) || !Number.isFinite(Date.parse(value.trim()))) {
    return { ok: false, error: `${label} must be a valid date and time.` };
  }
  return { ok: true, value: value.trim() };
}

export function isValidFreeGiftIconUrl(value: string): boolean {
  if (!value) return true;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function validateFreeGiftRuleInput(
  rawInput: unknown,
): { ok: true; value: ValidatedFreeGiftRuleInput } | { ok: false; error: string } {
  if (!rawInput || typeof rawInput !== 'object') {
    return { ok: false, error: 'Send free gift rule settings as a JSON object.' };
  }
  const body = rawInput as Record<string, unknown>;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return { ok: false, error: 'Rule name must be between 1 and 80 characters.' };
  }

  const giftProductId = typeof body.giftProductId === 'string' ? body.giftProductId.trim() : '';
  if (!giftProductId || !/^[a-zA-Z0-9_-]{1,128}$/.test(giftProductId)) {
    return { ok: false, error: 'Select a valid gift item from your catalog.' };
  }

  const giftVariantId =
    typeof body.giftVariantId === 'string' && body.giftVariantId.trim()
      ? body.giftVariantId.trim()
      : null;

  const targetParsed = parseRupeesToPaise(body.targetRupees as string | number | null | undefined);
  if (!targetParsed.ok || targetParsed.paise === null || targetParsed.paise <= 0) {
    return { ok: false, error: 'Target amount must be above ₹0.' };
  }

  const iconUrl = typeof body.iconUrl === 'string' ? body.iconUrl.trim() : '';
  if (iconUrl.length > 500 || !isValidFreeGiftIconUrl(iconUrl)) {
    return { ok: false, error: 'Gift icon URL must be blank, a relative path (/...), or an https URL.' };
  }

  const badgeText = (typeof body.badgeText === 'string' ? body.badgeText.trim() : '') || 'FREE';
  if (badgeText.length > 24) {
    return { ok: false, error: 'Badge label must be 24 characters or fewer.' };
  }

  const unlockMessage =
    (typeof body.unlockMessage === 'string' ? body.unlockMessage.trim() : '')
    || 'You unlocked a free gift!';
  if (unlockMessage.length > 160) {
    return { ok: false, error: 'Unlock message must be 160 characters or fewer.' };
  }

  const startsAtLocal = parseLocalDate(body.startsAt, 'Start time');
  if (!startsAtLocal.ok) return startsAtLocal;
  const endsAtLocal = parseLocalDate(body.endsAt, 'End time');
  if (!endsAtLocal.ok) return endsAtLocal;
  if (
    startsAtLocal.value !== null
    && endsAtLocal.value !== null
    && Date.parse(startsAtLocal.value) >= Date.parse(endsAtLocal.value)
  ) {
    return { ok: false, error: 'End time must be after start time.' };
  }

  const maxGiftsTotal = parseOptionalInt(body.maxGiftsTotal, 1, 1_000_000, 'Maximum gifts');
  if (!maxGiftsTotal.ok) return maxGiftsTotal;

  const perCustomerLimit = parseOptionalInt(body.perCustomerLimit, 1, 1000, 'Per-customer limit');
  if (!perCustomerLimit.ok) return perCustomerLimit;

  const priorityRaw = body.priority === undefined || body.priority === '' ? 0 : body.priority;
  const priorityNum = typeof priorityRaw === 'string' ? Number(priorityRaw.trim()) : Number(priorityRaw);
  if (!Number.isInteger(priorityNum) || priorityNum < -9999 || priorityNum > 9999) {
    return { ok: false, error: 'Priority must be a whole number between -9999 and 9999.' };
  }

  const couponInteraction: FreeGiftCouponInteraction =
    body.couponInteraction === 'disallow' ? 'disallow' : 'allow';

  const minPostParsed = parseRupeesToPaise(body.minPostCouponRupees as string | number | null | undefined);
  if (!minPostParsed.ok) {
    return { ok: false, error: `Minimum amount after coupons: ${minPostParsed.message}` };
  }
  const minPostCouponPaise = minPostParsed.paise ?? 0;

  return {
    ok: true,
    value: {
      ...(typeof body.id === 'string' && body.id.trim() ? { id: body.id.trim() } : {}),
      name,
      giftProductId,
      giftVariantId,
      targetPaise: targetParsed.paise,
      iconUrl,
      badgeText,
      unlockMessage,
      startsAtLocal: startsAtLocal.value,
      endsAtLocal: endsAtLocal.value,
      isActive: body.isActive !== false,
      showOnProductPage: Boolean(body.showOnProductPage),
      maxGiftsTotal: maxGiftsTotal.value,
      perCustomerLimit: perCustomerLimit.value,
      priority: priorityNum,
      couponInteraction,
      minPostCouponPaise,
    },
  };
}

export interface FreeGiftAdminWarning {
  key: 'untracked_stock' | 'out_of_stock' | 'inactive_product' | 'cap_reached' | 'overlapping_rule' | 'low_threshold';
  message: string;
}

export function collectFreeGiftAdminWarnings(input: {
  rule: FreeGiftRuleRecord;
  gift: FreeGiftCatalogSnapshot | null;
  otherActiveRules: readonly FreeGiftRuleRecord[];
  cheapestProductPaise: number | null;
}): FreeGiftAdminWarning[] {
  const warnings: FreeGiftAdminWarning[] = [];
  const { rule, gift, otherActiveRules, cheapestProductPaise } = input;

  if (!gift || !gift.productActive || !gift.variantActive) {
    warnings.push({
      key: 'inactive_product',
      message: 'This gift item is inactive, retired, or missing in the catalog.',
    });
  } else {
    if (!gift.trackInventory) {
      warnings.push({
        key: 'untracked_stock',
        message: 'Stock is not limited for this gift SKU, so free gifts could be given without limit.',
      });
    } else if (gift.onHand - gift.reserved <= 0) {
      warnings.push({
        key: 'out_of_stock',
        message: `Gift item "${gift.productName}" currently has 0 available stock.`,
      });
    }
  }

  if (rule.maxGiftsTotal !== null && rule.claimedCount >= rule.maxGiftsTotal) {
    warnings.push({
      key: 'cap_reached',
      message: `Maximum gift cap (${rule.maxGiftsTotal}) has been reached.`,
    });
  }

  const sameThreshold = otherActiveRules.find(
    (other) =>
      other.id !== rule.id
      && other.isActive
      && !other.archivedAt
      && other.targetPaise === rule.targetPaise
      && other.priority === rule.priority,
  );
  if (sameThreshold) {
    warnings.push({
      key: 'overlapping_rule',
      message: `Shares exact threshold (${formatRupees(rule.targetPaise)}) and priority (${rule.priority}) with "${sameThreshold.name}". Oldest rule will win ties.`,
    });
  }

  if (cheapestProductPaise !== null && cheapestProductPaise > 0 && rule.targetPaise < cheapestProductPaise) {
    warnings.push({
      key: 'low_threshold',
      message: `Threshold (${formatRupees(rule.targetPaise)}) is below your cheapest active product (${formatRupees(cheapestProductPaise)}), so every order will qualify.`,
    });
  }

  return warnings;
}

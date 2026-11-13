/**
 * Pure unit tests for Free Gift promotion rules:
 * - Eligible subtotal identity with shipping calculation (`computeEligibleSubtotalPaise`)
 * - Highest threshold wins (max 1 gift), priority/age tie-breaking
 * - Strict no-fallback on out-of-stock / cap reached + conflict details
 * - Coupon interaction ('allow' vs 'disallow') + minPostCouponPaise
 * - Input validation, admin warnings, and return-threshold advisory notes
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { computeEligibleSubtotalPaise, quoteShippingFromLines } = await jiti.import(
  path.join(root, 'src', 'lib', 'checkout', 'shipping-rules.ts'),
);

const {
  checkFreeGiftReturnThresholdNote,
  collectFreeGiftAdminWarnings,
  evaluateFreeGiftRules,
  validateFreeGiftRuleInput,
} = await jiti.import(path.join(root, 'src', 'lib', 'free-gifts', 'rules.ts'));

function makeGiftSnapshot(overrides = {}) {
  return {
    productId: overrides.productId ?? 'gift_prod_1',
    variantId: overrides.variantId ?? null,
    productName: overrides.productName ?? 'MagSafe Travel Pouch',
    variantLabel: overrides.variantLabel ?? null,
    variantSku: overrides.variantSku ?? null,
    regularPricePaise: overrides.regularPricePaise ?? 99900,
    imageUrl: overrides.imageUrl ?? null,
    imageAlt: overrides.imageAlt ?? null,
    productActive: overrides.productActive ?? true,
    variantActive: overrides.variantActive ?? true,
    isGiftOnly: overrides.isGiftOnly ?? true,
    trackInventory: overrides.trackInventory ?? true,
    onHand: overrides.onHand ?? 10,
    reserved: overrides.reserved ?? 2,
    lowStockThreshold: overrides.lowStockThreshold ?? 2,
    categoryId: null,
    brandId: null,
    variantDeviceModelId: null,
    variantDeviceModelName: null,
    variantColourId: null,
    variantColourName: null,
    variantColourHex: null,
  };
}

function makeRule(overrides = {}) {
  return {
    id: overrides.id ?? 'rule_1',
    name: overrides.name ?? 'Orders ₹2,500+ gift',
    giftProductId: overrides.giftProductId ?? 'gift_prod_1',
    giftVariantId: overrides.giftVariantId ?? null,
    targetPaise: overrides.targetPaise ?? 250000,
    iconUrl: overrides.iconUrl ?? '',
    badgeText: overrides.badgeText ?? 'FREE GIFT',
    unlockMessage: overrides.unlockMessage ?? 'You unlocked a free travel pouch!',
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    isActive: overrides.isActive ?? true,
    showOnProductPage: overrides.showOnProductPage ?? true,
    maxGiftsTotal: overrides.maxGiftsTotal ?? null,
    claimedCount: overrides.claimedCount ?? 0,
    perCustomerLimit: overrides.perCustomerLimit ?? null,
    customerClaimedCount: overrides.customerClaimedCount ?? 0,
    priority: overrides.priority ?? 0,
    couponInteraction: overrides.couponInteraction ?? 'allow',
    minPostCouponPaise: overrides.minPostCouponPaise ?? 0,
    unavailableCheckoutCount: overrides.unavailableCheckoutCount ?? 0,
    createdAt: overrides.createdAt ?? '2026-11-10T00:00:00.000Z',
    archivedAt: overrides.archivedAt ?? null,
  };
}

test('computeEligibleSubtotalPaise excludes gift lines and matches shipping threshold basis', () => {
  const lines = [
    { linePaise: 149900, isFreeGift: false },
    { linePaise: 100000, isFreeGift: false },
    { linePaise: 99900, isFreeGift: true },
  ];
  assert.equal(computeEligibleSubtotalPaise(lines), 249900);

  const shippingQuote = quoteShippingFromLines(lines, {
    enabled: true,
    chargePaise: 9900,
    freeShippingThresholdPaise: 250000,
  });
  assert.equal(shippingQuote.reason, 'rate');
  assert.equal(shippingQuote.shippingPaise, 9900);

  const unlockedQuote = quoteShippingFromLines(
    [...lines, { linePaise: 100, isFreeGift: false }],
    {
      enabled: true,
      chargePaise: 9900,
      freeShippingThresholdPaise: 250000,
    },
  );
  assert.equal(unlockedQuote.reason, 'free-threshold');
  assert.equal(unlockedQuote.shippingPaise, 0);
});

test('evaluateFreeGiftRules picks highest tier, breaks ties by priority/age, and never awards 2 threshold gifts', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const rules = [
    {
      rule: makeRule({ id: 'tier_low', targetPaise: 150000, priority: 10 }),
      gift: makeGiftSnapshot({ productId: 'g_low', productName: 'Cable Tie' }),
    },
    {
      rule: makeRule({ id: 'tier_high_lowprio', targetPaise: 300000, priority: 1, createdAt: '2026-11-01T00:00:00.000Z' }),
      gift: makeGiftSnapshot({ productId: 'g_a', productName: 'Card Wallet' }),
    },
    {
      rule: makeRule({ id: 'tier_high_win', targetPaise: 300000, priority: 5 }),
      gift: makeGiftSnapshot({ productId: 'g_b', productName: 'Braided Cable' }),
    },
    {
      rule: makeRule({ id: 'tier_next', targetPaise: 500000, priority: 0 }),
      gift: makeGiftSnapshot({ productId: 'g_next', productName: 'Stand' }),
    },
  ];

  // Below lowest tier -> progress nudge points to 150000 tier
  const below = evaluateFreeGiftRules({
    now,
    lines: [{ linePaise: 100000 }],
    discountPaise: 0,
    couponApplied: false,
    rules,
  });
  assert.equal(below.unlockedGift, null);
  assert.equal(below.nextNudge?.ruleId, 'tier_low');
  assert.equal(below.nextNudge?.remainingPaise, 50000);

  // At ₹3,000 -> highest qualifying threshold wins by priority, next nudge shows ₹5,000 tier
  const hitHigh = evaluateFreeGiftRules({
    now,
    lines: [{ linePaise: 300000 }],
    discountPaise: 0,
    couponApplied: false,
    rules,
  });
  assert.equal(hitHigh.unlockedGift?.ruleId, 'tier_high_win');
  assert.equal(hitHigh.unlockedGift?.gift.productName, 'Braided Cable');
  assert.equal(hitHigh.nextNudge?.ruleId, 'tier_next');
  assert.equal(hitHigh.nextNudge?.remainingPaise, 200000);
});

test('evaluateFreeGiftRules does NOT fall back to lower gift when qualifying gift is OOS or capped', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const rules = [
    {
      rule: makeRule({ id: 'tier_1000', targetPaise: 100000 }),
      gift: makeGiftSnapshot({ productId: 'g_low', productName: 'Sticker Pack', onHand: 5, reserved: 0 }),
    },
    {
      rule: makeRule({ id: 'tier_3000_oos', targetPaise: 300000 }),
      gift: makeGiftSnapshot({ productId: 'g_oos', productName: 'Power Bank', onHand: 2, reserved: 2 }),
    },
  ];

  const evalRes = evaluateFreeGiftRules({
    now,
    lines: [{ linePaise: 350000 }],
    discountPaise: 0,
    couponApplied: false,
    rules,
  });
  assert.equal(evalRes.unlockedGift, null);
  assert.equal(evalRes.conflict?.ruleId, 'tier_3000_oos');
  assert.equal(evalRes.conflict?.reason, 'out_of_stock');
});

test('coupon interaction (disallow / minPostCouponPaise) uses pre-coupon trigger and blocks cleanly', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const rules = [
    {
      rule: makeRule({
        id: 'rule_disallow',
        targetPaise: 200000,
        couponInteraction: 'disallow',
      }),
      gift: makeGiftSnapshot({ productName: 'Lens Cloth' }),
    },
    {
      rule: makeRule({
        id: 'rule_post_min',
        targetPaise: 300000,
        couponInteraction: 'allow',
        minPostCouponPaise: 260000,
      }),
      gift: makeGiftSnapshot({ productName: 'Armor Sleeve' }),
    },
  ];

  // ₹3,000 subtotal with ₹600 discount -> ₹2,400 post-coupon
  const blockedPostMin = evaluateFreeGiftRules({
    now,
    lines: [{ linePaise: 300000 }],
    discountPaise: 60000,
    couponApplied: true,
    rules,
  });
  assert.equal(blockedPostMin.unlockedGift, null);
  assert.ok(blockedPostMin.blockedByCouponMessage);

  // ₹3,000 subtotal with ₹200 discount -> ₹2,800 post-coupon satisfies 260000
  const allowedPostMin = evaluateFreeGiftRules({
    now,
    lines: [{ linePaise: 300000 }],
    discountPaise: 20000,
    couponApplied: true,
    rules,
  });
  assert.equal(allowedPostMin.unlockedGift?.ruleId, 'rule_post_min');
});

test('validateFreeGiftRuleInput, admin warnings, and return threshold check enforce safety rules', () => {
  const valid = validateFreeGiftRuleInput({
    name: 'Diwali pouch gift',
    giftProductId: 'gift_prod_1',
    targetRupees: '2500',
    badgeText: 'FREE GIFT',
    unlockMessage: 'Unlocked free pouch!',
    isActive: true,
    showOnProductPage: true,
    maxGiftsTotal: '50',
    perCustomerLimit: '1',
    priority: '2',
    couponInteraction: 'disallow',
    minPostCouponRupees: '1999',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.targetPaise, 250000);
  assert.equal(valid.value.maxGiftsTotal, 50);
  assert.equal(valid.value.minPostCouponPaise, 199900);

  const badTarget = validateFreeGiftRuleInput({
    name: 'Too small',
    giftProductId: 'gift_prod_1',
    targetRupees: '0',
  });
  assert.equal(badTarget.ok, false);

  const warnings = collectFreeGiftAdminWarnings({
    rule: makeRule({ maxGiftsTotal: 5, claimedCount: 5, targetPaise: 50000 }),
    gift: makeGiftSnapshot({ isGiftOnly: true, trackInventory: true, onHand: 1, reserved: 1 }),
    otherActiveRules: [makeRule({ id: 'other_rule', name: 'Duplicate tier', targetPaise: 50000, priority: 0 })],
    cheapestProductPaise: 99900,
  });
  assert.ok(warnings.some((w) => w.key === 'out_of_stock' && /0 available stock/i.test(w.message)));
  assert.ok(warnings.some((w) => w.key === 'cap_reached' && /Maximum gift cap/i.test(w.message)));
  assert.ok(warnings.some((w) => w.key === 'overlapping_rule' && /Duplicate tier/.test(w.message)));
  assert.ok(warnings.some((w) => w.key === 'low_threshold' && /cheapest active product/i.test(w.message)));

  const returnNote = checkFreeGiftReturnThresholdNote({
    orderPaidItemSubtotalPaise: 300000,
    refundedPaiseTotalAfter: 100000,
    giftThresholdPaise: 250000,
    giftProductName: 'MagSafe Travel Pouch',
  });
  assert.match(returnNote || '', /Free gift \(MagSafe Travel Pouch\) may need to be returned/);

  const noNoteAbove = checkFreeGiftReturnThresholdNote({
    orderPaidItemSubtotalPaise: 400000,
    refundedPaiseTotalAfter: 100000,
    giftThresholdPaise: 250000,
    giftProductName: 'MagSafe Travel Pouch',
  });
  assert.equal(noNoteAbove, null);
});

test('is_gift_only hiding and free-gift sales/report exclusion are enforced in storefront, reports, and returns', async () => {
  const readRel = (rel) => fs.readFile(path.join(root, rel), 'utf8');

  const [storefrontSrc, payuCatalogSrc, availSrc, accOrdersSrc, browsingSrc, analyticsSrc, reportsSrc, returnsSrc, attentionSrc] = await Promise.all([
    readRel('src/lib/catalog/storefront.ts'),
    readRel('src/lib/payu/db-catalog.ts'),
    readRel('src/lib/storefront/availability-server.ts'),
    readRel('src/lib/account/orders.ts'),
    readRel('src/lib/account/browsing-history.ts'),
    readRel('src/lib/store-admin/analytics.ts'),
    readRel('src/lib/store-admin/reports.ts'),
    readRel('src/lib/store-admin/returns.ts'),
    readRel('src/lib/store-admin/needs-attention.ts'),
  ]);

  assert.match(storefrontSrc, /is_gift_only, false\) = false/);
  assert.match(payuCatalogSrc, /is_gift_only, false\) = false/);
  assert.match(availSrc, /row\.is_gift_only !== true/);
  assert.match(accOrdersSrc, /getStorefrontProducts/);
  assert.match(accOrdersSrc, /is_free_gift'\)::boolean, false\) = false/);
  assert.match(browsingSrc, /is_free_gift', 'false'\)::boolean = false/);
  assert.match(browsingSrc, /is_gift_only', 'false'\)::boolean = false/);

  assert.match(analyticsSrc, /is_free_gift'\)::boolean, false\) = false/);
  assert.match(reportsSrc, /is_free_gift'\)::boolean, false\) = false/);
  assert.match(returnsSrc, /appendFreeGiftReturnThresholdNoteInTx/);
  assert.match(attentionSrc, /free_gift_alerts/);
  assert.match(attentionSrc, /unavailable_checkout_count/);
});


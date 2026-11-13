/**
 * Pure unit tests for Spin and Win rules:
 * - weighted randomness distribution accuracy across thousands of draws
 * - cap & inactive filtering without distorting remaining odds
 * - high-contrast label foreground selection
 * - store-timezone midnight reset calculation (IST and DST zones)
 * - validation rules (2..12 segments, enablement requires terms & active prize)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  CHANCE_BASIS_POINTS_TOTAL,
  DEFAULT_SPIN_WHEEL_SETTINGS,
  chancePercentToWeight,
  computeSegmentOdds,
  computeSpinCooldownState,
  computeStoreDayInfo,
  contrastTextForHex,
  drawWeightedSegment,
  formatChancePercent,
  formatPrizeSummary,
  isWheelWindowOpen,
  segmentAvailableForDraw,
  validateSpinWheelConfigInput,
  weightToChancePercent,
} = await jiti.import(path.join(root, 'src', 'lib', 'spin-wheel', 'rules.ts'));

function makeSegment(overrides = {}) {
  return {
    id: overrides.id ?? 'seg_1',
    label: overrides.label ?? '10% off',
    colorHex: overrides.colorHex ?? '#ffe100',
    textColorHex: contrastTextForHex(overrides.colorHex ?? '#ffe100'),
    segmentType: overrides.segmentType ?? 'COUPON',
    weight: overrides.weight ?? 10,
    dailyCap: overrides.dailyCap ?? null,
    totalCap: overrides.totalCap ?? null,
    totalAwarded: overrides.totalAwarded ?? 0,
    dailyAwarded: overrides.dailyAwarded ?? 0,
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    couponType: overrides.couponType ?? 'PERCENT',
    couponValue: overrides.couponValue ?? 10,
    couponMaxDiscountPaise: overrides.couponMaxDiscountPaise ?? null,
    couponMinOrderPaise: overrides.couponMinOrderPaise ?? 0,
    couponScope: overrides.couponScope ?? 'ORDER',
    couponTargetIds: overrides.couponTargetIds ?? [],
    couponValidDays: overrides.couponValidDays ?? 7,
    couponAllowWithSalePrice: overrides.couponAllowWithSalePrice ?? false,
  };
}

test('contrastTextForHex chooses readable foregrounds for light and dark hex colours', () => {
  assert.equal(contrastTextForHex('#ffe100'), '#111111');
  assert.equal(contrastTextForHex('#ffffff'), '#111111');
  assert.equal(contrastTextForHex('#111111'), '#ffffff');
  assert.equal(contrastTextForHex('#0f172a'), '#ffffff');
});

test('weighted draw obeys configured probability weights over 20,000 draws using crypto.randomInt', () => {
  const segments = [
    makeSegment({ id: 'a', label: 'A', weight: 10 }),
    makeSegment({ id: 'b', label: 'B', weight: 30 }),
    makeSegment({ id: 'c', label: 'C', weight: 60, segmentType: 'NO_PRIZE', couponType: null, couponValue: 0 }),
  ];

  const counts = { a: 0, b: 0, c: 0 };
  const iterations = 20000;
  for (let i = 0; i < iterations; i += 1) {
    const result = drawWeightedSegment(segments);
    assert.ok(result);
    counts[result.segment.id] += 1;
  }

  // Expected ratios: a = 0.10, b = 0.30, c = 0.60 (+/- 2.5% tolerance)
  assert.ok(Math.abs(counts.a / iterations - 0.1) < 0.025, `Unexpected A ratio: ${counts.a / iterations}`);
  assert.ok(Math.abs(counts.b / iterations - 0.3) < 0.025, `Unexpected B ratio: ${counts.b / iterations}`);
  assert.ok(Math.abs(counts.c / iterations - 0.6) < 0.025, `Unexpected C ratio: ${counts.c / iterations}`);
});

test('exhausted caps and inactive slices are excluded without skewing remaining odds', () => {
  const segments = [
    makeSegment({ id: 'capped_daily', weight: 80, dailyCap: 5, dailyAwarded: 5 }),
    makeSegment({ id: 'capped_total', weight: 80, totalCap: 10, totalAwarded: 10 }),
    makeSegment({ id: 'inactive', weight: 80, isActive: false }),
    makeSegment({ id: 'rem_1', weight: 1 }),
    makeSegment({ id: 'rem_2', weight: 3 }),
  ];

  assert.equal(segmentAvailableForDraw(segments[0]), false);
  assert.equal(segmentAvailableForDraw(segments[1]), false);
  assert.equal(segmentAvailableForDraw(segments[2]), false);
  assert.equal(segmentAvailableForDraw(segments[3]), true);

  // Configured odds exclude inactive segments cleanly
  const odds = computeSegmentOdds([segments[2], segments[3], segments[4]]);
  assert.equal(odds.get('inactive'), 0);
  assert.equal(odds.get('rem_1'), 25);
  assert.equal(odds.get('rem_2'), 75);

  // Actual draw excludes daily-capped, total-capped, and inactive slices before weighting
  const counts = { rem_1: 0, rem_2: 0 };
  for (let i = 0; i < 4000; i += 1) {
    const draw = drawWeightedSegment(segments);
    assert.ok(draw);
    assert.ok(draw.segment.id === 'rem_1' || draw.segment.id === 'rem_2');
    counts[draw.segment.id] += 1;
  }
  assert.ok(Math.abs(counts.rem_1 / 4000 - 0.25) < 0.04);
  assert.ok(Math.abs(counts.rem_2 / 4000 - 0.75) < 0.04);

  // Boundary roll checks: totalWeight = 4 -> roll 0 = rem_1, roll 1..3 = rem_2
  const first = drawWeightedSegment(segments, () => 0);
  const second = drawWeightedSegment(segments, () => 1);
  assert.equal(first?.segment.id, 'rem_1');
  assert.equal(second?.segment.id, 'rem_2');
  assert.equal(first?.totalWeight, 4);
});

test('computeStoreDayInfo resets cleanly at midnight in Asia/Kolkata and other store timezones', () => {
  // 2026-11-13 18:29:59 UTC == 2026-11-13 23:59:59 IST (+05:30)
  const justBeforeMidnightIst = new Date('2026-11-13T18:29:59.000Z');
  const justAfterMidnightIst = new Date('2026-11-13T18:30:01.000Z');

  const before = computeStoreDayInfo(justBeforeMidnightIst, 'Asia/Kolkata');
  const after = computeStoreDayInfo(justAfterMidnightIst, 'Asia/Kolkata');

  assert.equal(before.storeDay, '2026-11-13');
  assert.equal(after.storeDay, '2026-11-14');
  assert.ok(before.secondsUntilReset <= 2 && before.secondsUntilReset >= 1);
  assert.equal(before.nextResetAt.getTime(), new Date('2026-11-13T18:30:00.000Z').getTime());

  // America/New_York (EST -05:00 in mid-November) -> 2026-11-14T04:59:00Z is still 2026-11-13 23:59:00
  const nyBeforeMidnight = new Date('2026-11-14T04:59:00.000Z');
  const nyAfterMidnight = new Date('2026-11-14T05:01:00.000Z');
  assert.equal(computeStoreDayInfo(nyBeforeMidnight, 'America/New_York').storeDay, '2026-11-13');
  assert.equal(computeStoreDayInfo(nyAfterMidnight, 'America/New_York').storeDay, '2026-11-14');
});

test('validateSpinWheelConfigInput enforces segment bounds, prize rules, and enablement checklist', () => {
  const twoSegments = [
    {
      id: 's1',
      label: '10% off',
      colorHex: '#ffe100',
      segmentType: 'COUPON',
      weight: 2000,
      dailyCap: 10,
      totalCap: null,
      isActive: true,
      sortOrder: 0,
      couponType: 'PERCENT',
      couponValueInput: '10',
      couponMaxDiscountRupees: '250',
      couponMinOrderRupees: '499',
      couponScope: 'ORDER',
      couponTargetIds: [],
      couponValidDays: 7,
      couponAllowWithSalePrice: false,
    },
    {
      id: 's2',
      label: 'Try again',
      colorHex: '#111111',
      segmentType: 'NO_PRIZE',
      weight: 8000,
      dailyCap: null,
      totalCap: null,
      isActive: true,
      sortOrder: 1,
      couponType: null,
      couponValueInput: '0',
      couponMaxDiscountRupees: null,
      couponMinOrderRupees: null,
      couponScope: 'ORDER',
      couponTargetIds: [],
      couponValidDays: 7,
      couponAllowWithSalePrice: false,
    },
  ];

  // Enabling without terms fails
  const missingTerms = validateSpinWheelConfigInput({
    settings: { enabled: true, termsText: '   ', spinsPerCustomerPerDay: 1 },
    segments: twoSegments,
  });
  assert.equal(missingTerms.ok, false);

  // Enabling with only NO_PRIZE active fails
  const noActivePrize = validateSpinWheelConfigInput({
    settings: { enabled: true, termsText: 'One spin per customer per day.', spinsPerCustomerPerDay: 1 },
    segments: [
      { ...twoSegments[0], isActive: false },
      twoSegments[1],
    ],
  });
  assert.equal(noActivePrize.ok, false);

  // Valid configuration passes and defaults IP limit to 1
  const valid = validateSpinWheelConfigInput({
    settings: { enabled: true, title: 'Spin and Win', subtitle: '', termsText: 'One spin per customer per day.' },
    segments: twoSegments,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.settings.maxSpinsPerIpPerDay, 1);
  assert.equal(valid.value.segments[0].couponMaxDiscountPaise, 25000);
  assert.equal(valid.value.segments[0].couponMinOrderPaise, 49900);

  // Fewer than 2 segments rejected
  const tooFew = validateSpinWheelConfigInput({
    settings: { enabled: false, title: 'Spin and Win', subtitle: '', termsText: 'Terms' },
    segments: [twoSegments[0]],
  });
  assert.equal(tooFew.ok, false);
});

test('window and summary helpers behave consistently', () => {
  const now = new Date('2026-11-13T10:00:00.000Z');
  assert.deepEqual(
    isWheelWindowOpen(
      { enabled: true, startsAt: '2026-11-13T09:00:00.000Z', endsAt: '2026-11-13T11:00:00.000Z', termsText: 'Terms apply' },
      now,
    ),
    { open: true, reason: null },
  );
  assert.deepEqual(
    isWheelWindowOpen(
      { enabled: true, startsAt: '2026-11-13T12:00:00.000Z', endsAt: null, termsText: 'Terms apply' },
      now,
    ),
    { open: false, reason: 'not_started' },
  );
  assert.equal(
    formatPrizeSummary(makeSegment({ segmentType: 'NO_PRIZE', couponType: null })),
    'No prize',
  );
  assert.match(
    formatPrizeSummary(makeSegment({ couponType: 'FIXED', couponValue: 15000 })),
    /150/,
  );
});

test('computeSpinCooldownState enforces until_coupon_expires and custom_days while exempting NO_PRIZE', () => {
  const day1 = new Date('2026-11-13T10:00:00.000Z');
  const midnight = new Date('2026-11-13T18:30:00.000Z');
  const couponEnds = new Date('2026-11-20T10:00:00.000Z');
  const latestWin = {
    createdAt: day1,
    couponEndsAt: couponEnds,
    couponCode: 'SPINABCD1234',
    couponSummary: '15% off',
    segmentLabel: '15% off',
  };

  // Disabled mode never blocks after daily reset
  const disabledRes = computeSpinCooldownState({
    dbNow: new Date('2026-11-14T10:00:00.000Z'),
    nextDailyResetAt: new Date('2026-11-14T18:30:00.000Z'),
    latestCouponWin: latestWin,
    rewardCooldownMode: 'disabled',
    rewardCooldownDays: 7,
  });
  assert.equal(disabledRes.blockedByCooldown, false);

  // NO_PRIZE customer (null latestCouponWin) is never blocked even in strict mode
  const noPrizeRes = computeSpinCooldownState({
    dbNow: day1,
    nextDailyResetAt: midnight,
    latestCouponWin: null,
    rewardCooldownMode: 'until_coupon_expires',
    rewardCooldownDays: 7,
  });
  assert.equal(noPrizeRes.blockedByCooldown, false);

  // until_coupon_expires blocks while coupon is still active, unblocks on/after couponEnds
  const blockedUntilExpiry = computeSpinCooldownState({
    dbNow: new Date('2026-11-16T10:00:00.000Z'),
    nextDailyResetAt: new Date('2026-11-16T18:30:00.000Z'),
    latestCouponWin: latestWin,
    rewardCooldownMode: 'until_coupon_expires',
    rewardCooldownDays: 7,
  });
  assert.equal(blockedUntilExpiry.blockedByCooldown, true);
  assert.equal(blockedUntilExpiry.nextSpinAt.getTime(), couponEnds.getTime());
  assert.equal(blockedUntilExpiry.activeReward?.couponCode, 'SPINABCD1234');

  const unblockedAtExpiry = computeSpinCooldownState({
    dbNow: couponEnds,
    nextDailyResetAt: new Date('2026-11-20T18:30:00.000Z'),
    latestCouponWin: latestWin,
    rewardCooldownMode: 'until_coupon_expires',
    rewardCooldownDays: 7,
  });
  assert.equal(unblockedAtExpiry.blockedByCooldown, false);

  // custom_days blocks for exactly N days after spin creation
  const customBlocked = computeSpinCooldownState({
    dbNow: new Date('2026-11-15T09:59:59.000Z'),
    nextDailyResetAt: new Date('2026-11-15T18:30:00.000Z'),
    latestCouponWin: latestWin,
    rewardCooldownMode: 'custom_days',
    rewardCooldownDays: 3,
  });
  assert.equal(customBlocked.blockedByCooldown, true);
  assert.equal(customBlocked.nextSpinAt.getTime(), new Date('2026-11-16T10:00:00.000Z').getTime());

  const customUnblocked = computeSpinCooldownState({
    dbNow: new Date('2026-11-16T10:00:00.000Z'),
    nextDailyResetAt: new Date('2026-11-16T18:30:00.000Z'),
    latestCouponWin: latestWin,
    rewardCooldownMode: 'custom_days',
    rewardCooldownDays: 3,
  });
  assert.equal(customUnblocked.blockedByCooldown, false);
});

test('validateSpinWheelConfigInput validates cooldown mode, custom days, and countdown flag', () => {
  const twoSegments = [
    {
      id: 's1',
      label: '10% off',
      colorHex: '#f25c3b',
      segmentType: 'COUPON',
      weight: 2000,
      dailyCap: null,
      totalCap: null,
      isActive: true,
      sortOrder: 0,
      couponType: 'PERCENT',
      couponValueInput: '10',
      couponMaxDiscountRupees: null,
      couponMinOrderRupees: null,
      couponScope: 'ORDER',
      couponTargetIds: [],
      couponValidDays: 7,
      couponAllowWithSalePrice: false,
    },
    {
      id: 's2',
      label: 'Try again',
      colorHex: '#e8c6ff',
      segmentType: 'NO_PRIZE',
      weight: 8000,
      dailyCap: null,
      totalCap: null,
      isActive: true,
      sortOrder: 1,
      couponType: null,
      couponValueInput: '0',
      couponMaxDiscountRupees: null,
      couponMinOrderRupees: null,
      couponScope: 'ORDER',
      couponTargetIds: [],
      couponValidDays: 7,
      couponAllowWithSalePrice: false,
    },
  ];

  const badMode = validateSpinWheelConfigInput({
    settings: { enabled: false, title: 'Spin to Win', termsText: 'Terms', rewardCooldownMode: 'forever' },
    segments: twoSegments,
  });
  assert.equal(badMode.ok, false);

  const customValid = validateSpinWheelConfigInput({
    settings: {
      enabled: true,
      title: 'Spin to Win',
      termsText: 'Terms',
      rewardCooldownMode: 'custom_days',
      rewardCooldownDays: 14,
      showNextSpinCountdown: false,
    },
    segments: twoSegments,
  });
  assert.equal(customValid.ok, true);
  assert.equal(customValid.value.settings.rewardCooldownMode, 'custom_days');
  assert.equal(customValid.value.settings.rewardCooldownDays, 14);
  assert.equal(customValid.value.settings.showNextSpinCountdown, false);
  assert.equal(customValid.value.settings.popupEnabled, true);
  assert.equal(customValid.value.settings.popupDelaySeconds, 10);
  assert.equal(customValid.value.settings.popupRequireScroll, true);
  assert.equal(customValid.value.settings.popupMobileFloatingButton, true);

  // Default cooldown is 'disabled' (1 spin per store day) with accessible popup controls
  assert.equal(DEFAULT_SPIN_WHEEL_SETTINGS.rewardCooldownMode, 'disabled');
  assert.equal(DEFAULT_SPIN_WHEEL_SETTINGS.popupEnabled, true);
  assert.equal(DEFAULT_SPIN_WHEEL_SETTINGS.popupDelaySeconds, 10);
  assert.equal(DEFAULT_SPIN_WHEEL_SETTINGS.popupRequireScroll, true);
  assert.equal(DEFAULT_SPIN_WHEEL_SETTINGS.popupMobileFloatingButton, true);

  // Popup delay bounds (0..120)
  const badPopupDelayLow = validateSpinWheelConfigInput({
    settings: { enabled: false, title: 'Spin to Win', termsText: 'Terms', popupDelaySeconds: -1 },
    segments: twoSegments,
  });
  assert.equal(badPopupDelayLow.ok, false);

  const badPopupDelayHigh = validateSpinWheelConfigInput({
    settings: { enabled: false, title: 'Spin to Win', termsText: 'Terms', popupDelaySeconds: 121 },
    segments: twoSegments,
  });
  assert.equal(badPopupDelayHigh.ok, false);

  const customPopupValid = validateSpinWheelConfigInput({
    settings: {
      enabled: true,
      title: 'Spin to Win',
      termsText: 'Terms',
      popupEnabled: false,
      popupDelaySeconds: 25,
      popupRequireScroll: false,
      popupMobileFloatingButton: false,
    },
    segments: twoSegments,
  });
  assert.equal(customPopupValid.ok, true);
  assert.equal(customPopupValid.value.settings.popupEnabled, false);
  assert.equal(customPopupValid.value.settings.popupDelaySeconds, 25);
  assert.equal(customPopupValid.value.settings.popupRequireScroll, false);
  assert.equal(customPopupValid.value.settings.popupMobileFloatingButton, false);
});

test('chancePercentToWeight and exact 100.00% sum + FREE_GIFT validation + strict NO_PRIZE redirect work accurately', () => {
  assert.equal(CHANCE_BASIS_POINTS_TOTAL, 10000);
  const halfPct = chancePercentToWeight('12.5', 'Chance');
  assert.equal(halfPct.ok, true);
  assert.equal(halfPct.weight, 1250);
  assert.equal(weightToChancePercent(1250), 12.5);
  assert.equal(formatChancePercent(1250), '12.50');
  assert.equal(formatChancePercent(1234), '12.34');

  assert.equal(chancePercentToWeight('0', 'Chance').ok, false);
  assert.equal(chancePercentToWeight('100.01', 'Chance').ok, false);
  assert.equal(chancePercentToWeight('12.345', 'Chance').ok, false);

  // Sum !== 100.00% rejected
  const sum99 = validateSpinWheelConfigInput({
    settings: { enabled: false, title: 'Spin', termsText: 'Terms' },
    segments: [
      { id: 's1', label: 'A', colorHex: '#ffe100', segmentType: 'COUPON', chancePercent: '49.99', isActive: true, couponType: 'PERCENT', couponValueInput: '10', couponScope: 'ORDER', couponValidDays: 7 },
      { id: 's2', label: 'B', colorHex: '#111111', segmentType: 'NO_PRIZE', chancePercent: '50.00', isActive: true },
    ],
  });
  assert.equal(sum99.ok, false);
  assert.match(sum99.error, /100\.00%/);

  // FREE_GIFT requires giftProductId and uncapped NO_PRIZE fallback
  const missingGiftSku = validateSpinWheelConfigInput({
    settings: { enabled: true, title: 'Spin', termsText: 'Terms' },
    segments: [
      { id: 's1', label: 'Free Case', colorHex: '#ffe100', segmentType: 'FREE_GIFT', chancePercent: '12.5', isActive: true, giftValidDays: 5 },
      { id: 's2', label: 'Try again', colorHex: '#111111', segmentType: 'NO_PRIZE', chancePercent: '87.5', isActive: true },
    ],
  });
  assert.equal(missingGiftSku.ok, false);

  const giftValid = validateSpinWheelConfigInput({
    settings: { enabled: true, title: 'Spin', termsText: 'Terms' },
    segments: [
      { id: 's1', label: 'Free Case', colorHex: '#ffe100', segmentType: 'FREE_GIFT', chancePercent: '12.5', isActive: true, giftProductId: 'prod_gift', giftMinOrderRupees: '499', giftValidDays: 5 },
      { id: 's2', label: 'Try again', colorHex: '#111111', segmentType: 'NO_PRIZE', chancePercent: '87.5', isActive: true },
    ],
  });
  assert.equal(giftValid.ok, true);
  assert.equal(giftValid.value.segments[0].weight, 1250);
  assert.equal(giftValid.value.segments[0].giftProductId, 'prod_gift');
  assert.equal(giftValid.value.segments[0].giftMinOrderPaise, 49900);
  assert.equal(giftValid.value.segments[0].giftValidDays, 5);

  // Strict capped redirect: exhausted slice keeps other paid prize at configured 10%, never inflated
  const segments = [
    makeSegment({ id: 'capped', label: 'Capped Gift', segmentType: 'FREE_GIFT', weight: 8000, dailyCap: 1, dailyAwarded: 1 }),
    makeSegment({ id: 'paid', label: '10% Off', segmentType: 'COUPON', weight: 1000 }),
    makeSegment({ id: 'noprize', label: 'No Prize', segmentType: 'NO_PRIZE', weight: 1000, dailyCap: null, totalCap: null }),
  ];
  const rollInCapped = drawWeightedSegment(segments, () => 0);
  assert.equal(rollInCapped?.segment.id, 'noprize');
  assert.equal(rollInCapped?.originalSegment.id, 'capped');
  assert.equal(rollInCapped?.redirectedToNoPrize, true);

  const rollInPaid = drawWeightedSegment(segments, () => 8000);
  assert.equal(rollInPaid?.segment.id, 'paid');
  assert.equal(rollInPaid?.redirectedToNoPrize, false);
});

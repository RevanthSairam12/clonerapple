/**
 * Pure Spin and Win rules: validation, contrast calculation, odds, store-day
 * reset math, and cryptographically weighted drawing.
 *
 * No database, no React, no Next.js imports so unit tests can run directly.
 */

import { randomInt } from 'node:crypto';

import { formatRupees, parseRupeesToPaise } from '@/lib/store-admin/money';
import { safeThemeColor } from '@/lib/website/theme-rules';

import { contrastTextForHex, sanitizeHexColor } from './colors';

export { contrastTextForHex, sanitizeHexColor };

export type SpinSegmentType = 'COUPON' | 'NO_PRIZE';
export type SpinCouponType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
export type SpinCouponScope = 'ORDER' | 'PRODUCTS' | 'CATEGORIES';
export type SpinRewardCooldownMode = 'disabled' | 'until_coupon_expires' | 'custom_days';

export const REWARD_COOLDOWN_MODES: readonly SpinRewardCooldownMode[] = [
  'disabled',
  'until_coupon_expires',
  'custom_days',
];

export interface SpinWheelSettings {
  enabled: boolean;
  title: string;
  subtitle: string;
  startsAt: string | null;
  endsAt: string | null;
  spinsPerCustomerPerDay: number;
  termsText: string;
  maxSpinsPerIpPerDay: number;
  minAccountAgeMinutes: number;
  showOnHomePage: boolean;
  rewardCooldownMode: SpinRewardCooldownMode;
  rewardCooldownDays: number;
  showNextSpinCountdown: boolean;
}

export interface SpinWheelSegment {
  id: string;
  label: string;
  colorHex: string;
  textColorHex: string;
  segmentType: SpinSegmentType;
  weight: number;
  dailyCap: number | null;
  totalCap: number | null;
  totalAwarded: number;
  dailyAwarded: number;
  isActive: boolean;
  sortOrder: number;
  couponType: SpinCouponType | null;
  couponValue: number;
  couponMaxDiscountPaise: number | null;
  couponMinOrderPaise: number;
  couponScope: SpinCouponScope;
  couponTargetIds: string[];
  couponValidDays: number;
  couponAllowWithSalePrice: boolean;
}

export interface SpinWheelSegmentInput {
  id?: string;
  label: string;
  colorHex: string;
  segmentType: SpinSegmentType;
  weight: number;
  dailyCap: number | null;
  totalCap: number | null;
  isActive: boolean;
  sortOrder: number;
  couponType: SpinCouponType | null;
  /** Whole percent (1..100) for PERCENT, or rupee string/number for FIXED; 0 for FREE_SHIPPING. */
  couponValueInput: string | number;
  couponMaxDiscountRupees: string | number | null;
  couponMinOrderRupees: string | number | null;
  couponScope: SpinCouponScope;
  couponTargetIds: string[];
  couponValidDays: number;
  couponAllowWithSalePrice: boolean;
}

export interface ValidatedSpinSegment {
  id: string;
  label: string;
  colorHex: string;
  segmentType: SpinSegmentType;
  weight: number;
  dailyCap: number | null;
  totalCap: number | null;
  isActive: boolean;
  sortOrder: number;
  couponType: SpinCouponType | null;
  couponValue: number;
  couponMaxDiscountPaise: number | null;
  couponMinOrderPaise: number;
  couponScope: SpinCouponScope;
  couponTargetIds: string[];
  couponValidDays: number;
  couponAllowWithSalePrice: boolean;
}

export interface ValidatedSpinConfig {
  settings: {
    enabled: boolean;
    title: string;
    subtitle: string;
    startsAtLocal: string | null;
    endsAtLocal: string | null;
    spinsPerCustomerPerDay: number;
    termsText: string;
    maxSpinsPerIpPerDay: number;
    minAccountAgeMinutes: number;
    showOnHomePage: boolean;
    rewardCooldownMode: SpinRewardCooldownMode;
    rewardCooldownDays: number;
    showNextSpinCountdown: boolean;
  };
  segments: ValidatedSpinSegment[];
}

export interface SpinWheelWarning {
  key: 'no_prize' | 'high_odds' | 'missing_terms' | 'cap_reached';
  message: string;
}

export interface SpinWeightSnapshotItem {
  id: string;
  label: string;
  weight: number;
}

export interface SpinDrawResult<T extends SpinWheelSegment = SpinWheelSegment> {
  segment: T;
  rollValue: number;
  totalWeight: number;
  weightsSnapshot: SpinWeightSnapshotItem[];
}

export const DEFAULT_SPIN_WHEEL_SETTINGS: SpinWheelSettings = {
  enabled: false,
  title: 'Spin to Win',
  subtitle: 'Love a sneaky surprise? Spin the wheel to reveal your exclusive discount!',
  startsAt: null,
  endsAt: null,
  spinsPerCustomerPerDay: 1,
  termsText: '',
  maxSpinsPerIpPerDay: 1,
  minAccountAgeMinutes: 0,
  showOnHomePage: false,
  rewardCooldownMode: 'until_coupon_expires',
  rewardCooldownDays: 7,
  showNextSpinCountdown: true,
};

export interface SpinCooldownWinInput {
  createdAt: Date;
  couponEndsAt: Date | null;
  couponCode: string | null;
  couponSummary: string | null;
  segmentLabel: string;
}

export interface SpinCooldownEvaluation {
  blockedByCooldown: boolean;
  cooldownMode: SpinRewardCooldownMode;
  cooldownUntil: Date | null;
  nextSpinAt: Date;
  secondsUntilReset: number;
  activeReward: {
    couponCode: string | null;
    couponSummary: string | null;
    couponExpiresAt: string | null;
    segmentLabel: string;
  } | null;
}

/**
 * Determine whether a customer who previously won a coupon must wait before spinning again.
 *
 * When the customer did not win a coupon (`latestCouponWin` is null) or mode is `'disabled'`,
 * normal daily midnight reset applies cleanly.
 */
export function computeSpinCooldownState(input: {
  dbNow: Date;
  nextDailyResetAt: Date;
  latestCouponWin: SpinCooldownWinInput | null;
  rewardCooldownMode: SpinRewardCooldownMode;
  rewardCooldownDays: number;
}): SpinCooldownEvaluation {
  const { dbNow, nextDailyResetAt, latestCouponWin, rewardCooldownMode, rewardCooldownDays } = input;
  const dailySecs = Math.max(0, Math.floor((nextDailyResetAt.getTime() - dbNow.getTime()) / 1000));

  if (rewardCooldownMode === 'disabled' || !latestCouponWin) {
    return {
      blockedByCooldown: false,
      cooldownMode: rewardCooldownMode,
      cooldownUntil: null,
      nextSpinAt: nextDailyResetAt,
      secondsUntilReset: dailySecs,
      activeReward: null,
    };
  }

  const cooldownUntil =
    rewardCooldownMode === 'until_coupon_expires'
      ? (latestCouponWin.couponEndsAt ?? new Date(latestCouponWin.createdAt.getTime() + 7 * 86_400_000))
      : new Date(latestCouponWin.createdAt.getTime() + Math.max(1, rewardCooldownDays) * 86_400_000);

  if (dbNow.getTime() < cooldownUntil.getTime()) {
    const unlockAt = new Date(Math.max(nextDailyResetAt.getTime(), cooldownUntil.getTime()));
    return {
      blockedByCooldown: true,
      cooldownMode: rewardCooldownMode,
      cooldownUntil,
      nextSpinAt: unlockAt,
      secondsUntilReset: Math.max(0, Math.floor((unlockAt.getTime() - dbNow.getTime()) / 1000)),
      activeReward: {
        couponCode: latestCouponWin.couponCode,
        couponSummary: latestCouponWin.couponSummary,
        couponExpiresAt: latestCouponWin.couponEndsAt ? latestCouponWin.couponEndsAt.toISOString() : null,
        segmentLabel: latestCouponWin.segmentLabel,
      },
    };
  }

  return {
    blockedByCooldown: false,
    cooldownMode: rewardCooldownMode,
    cooldownUntil,
    nextSpinAt: nextDailyResetAt,
    secondsUntilReset: dailySecs,
    activeReward: null,
  };
}

export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 12;
export const MAX_SEGMENT_LABEL_LENGTH = 40;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/** True when a segment is active and has remaining daily and total cap capacity. */
export function segmentAvailableForDraw(
  segment: Pick<SpinWheelSegment, 'isActive' | 'weight' | 'dailyCap' | 'dailyAwarded' | 'totalCap' | 'totalAwarded'>,
): boolean {
  if (!segment.isActive) return false;
  if (!Number.isInteger(segment.weight) || segment.weight < 1) return false;
  if (segment.dailyCap !== null && segment.dailyAwarded >= segment.dailyCap) return false;
  if (segment.totalCap !== null && segment.totalAwarded >= segment.totalCap) return false;
  return true;
}

/**
 * Cryptographically weighted segment draw.
 *
 * Exhausted or inactive segments are excluded before summing weights, so the
 * relative odds among remaining eligible segments remain exact.
 */
export function drawWeightedSegment<T extends SpinWheelSegment>(
  segments: readonly T[],
  rollFn: (totalWeight: number) => number = (totalWeight) => randomInt(0, totalWeight),
): SpinDrawResult<T> | null {
  const eligible = segments.filter((seg) => segmentAvailableForDraw(seg));
  if (eligible.length === 0) return null;

  const totalWeight = eligible.reduce((sum, seg) => sum + seg.weight, 0);
  if (!Number.isInteger(totalWeight) || totalWeight <= 0) return null;

  const rawRoll = Math.trunc(rollFn(totalWeight));
  const rollValue = Math.max(0, Math.min(totalWeight - 1, rawRoll));

  const weightsSnapshot: SpinWeightSnapshotItem[] = eligible.map((seg) => ({
    id: seg.id,
    label: seg.label,
    weight: seg.weight,
  }));

  let cumulative = 0;
  for (const seg of eligible) {
    cumulative += seg.weight;
    if (rollValue < cumulative) {
      return { segment: seg, rollValue, totalWeight, weightsSnapshot };
    }
  }

  return {
    segment: eligible[eligible.length - 1],
    rollValue,
    totalWeight,
    weightsSnapshot,
  };
}

/** Effective percentage per segment (0 for inactive or exhausted-only preview). */
export function computeSegmentOdds(
  segments: ReadonlyArray<Pick<SpinWheelSegment, 'id' | 'isActive' | 'weight'>>,
): Map<string, number> {
  const activeWeight = segments.reduce(
    (sum, seg) => (seg.isActive && seg.weight > 0 ? sum + seg.weight : sum),
    0,
  );
  const map = new Map<string, number>();
  for (const seg of segments) {
    if (!seg.isActive || activeWeight <= 0 || seg.weight <= 0) {
      map.set(seg.id, 0);
    } else {
      map.set(seg.id, Math.round((seg.weight / activeWeight) * 1000) / 10);
    }
  }
  return map;
}

export function formatPrizeSummary(
  segment: Pick<
    SpinWheelSegment,
    'segmentType' | 'couponType' | 'couponValue' | 'couponMaxDiscountPaise' | 'couponMinOrderPaise' | 'couponValidDays'
  >,
): string {
  if (segment.segmentType === 'NO_PRIZE') return 'No prize';
  const base =
    segment.couponType === 'FREE_SHIPPING'
      ? 'Free shipping'
      : segment.couponType === 'PERCENT'
        ? `${segment.couponValue}% off`
        : `${formatRupees(segment.couponValue)} off`;
  const maxPart =
    segment.couponType === 'PERCENT' && segment.couponMaxDiscountPaise && segment.couponMaxDiscountPaise > 0
      ? ` (up to ${formatRupees(segment.couponMaxDiscountPaise)})`
      : '';
  const minPart =
    segment.couponMinOrderPaise > 0
      ? ` · min ${formatRupees(segment.couponMinOrderPaise)}`
      : '';
  return `${base}${maxPart}${minPart} · valid ${segment.couponValidDays}d`;
}

export function collectSpinWheelWarnings(
  settings: Pick<SpinWheelSettings, 'termsText' | 'enabled'>,
  segments: readonly SpinWheelSegment[],
): SpinWheelWarning[] {
  const warnings: SpinWheelWarning[] = [];
  const active = segments.filter((s) => s.isActive);
  const activePrizes = active.filter((s) => s.segmentType === 'COUPON');
  if (activePrizes.length === 0) {
    warnings.push({
      key: 'no_prize',
      message: 'No active prize segment exists. Customers cannot win a coupon until at least one active prize segment is added.',
    });
  } else {
    const totalActiveWeight = active.reduce((sum, s) => sum + s.weight, 0);
    const prizeWeight = activePrizes.reduce((sum, s) => sum + s.weight, 0);
    if (totalActiveWeight > 0 && prizeWeight / totalActiveWeight >= 0.85) {
      const pct = Math.round((prizeWeight / totalActiveWeight) * 100);
      warnings.push({
        key: 'high_odds',
        message: `Prize odds are ${pct}% (${prizeWeight} of ${totalActiveWeight} weight). Make sure prize budgets and caps are sustainable.`,
      });
    }
  }

  if (!settings.termsText.trim()) {
    warnings.push({
      key: 'missing_terms',
      message: 'Terms & conditions text is required before the wheel can be enabled.',
    });
  }

  const cappedOut = active.filter(
    (s) =>
      (s.dailyCap !== null && s.dailyAwarded >= s.dailyCap)
      || (s.totalCap !== null && s.totalAwarded >= s.totalCap),
  );
  if (cappedOut.length > 0) {
    warnings.push({
      key: 'cap_reached',
      message: `${cappedOut.length} active segment${cappedOut.length === 1 ? '' : 's'} ha${cappedOut.length === 1 ? 's' : 've'} reached a daily or total cap and will be skipped until reset or raised.`,
    });
  }

  return warnings;
}

export function isWheelWindowOpen(
  settings: Pick<SpinWheelSettings, 'enabled' | 'startsAt' | 'endsAt' | 'termsText'>,
  now: Date,
): { open: boolean; reason: 'disabled' | 'no_terms' | 'not_started' | 'ended' | null } {
  if (!settings.enabled) return { open: false, reason: 'disabled' };
  if (!settings.termsText.trim()) return { open: false, reason: 'no_terms' };
  const nowMs = now.getTime();
  if (settings.startsAt) {
    const startMs = new Date(settings.startsAt).getTime();
    if (Number.isFinite(startMs) && nowMs < startMs) {
      return { open: false, reason: 'not_started' };
    }
  }
  if (settings.endsAt) {
    const endMs = new Date(settings.endsAt).getTime();
    if (Number.isFinite(endMs) && nowMs >= endMs) {
      return { open: false, reason: 'ended' };
    }
  }
  return { open: true, reason: null };
}

/**
 * Given a UTC instant and an IANA timezone, returns the local store calendar
 * day (`YYYY-MM-DD`) and the UTC instant of the next midnight in that timezone.
 */
export function computeStoreDayInfo(
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): { storeDay: string; nextResetAt: Date; secondsUntilReset: number } {
  const safeZone = timeZone.trim() || DEFAULT_TIMEZONE;
  const partsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const storeDay = `${parts.year}-${parts.month}-${parts.day}`;

  // Target: next local midnight (year, month, day + 1 at 00:00:00 in safeZone).
  // Compute by finding the UTC timestamp whose formatted local wall clock equals
  // next day 00:00:00 via two-step offset refinement (handles DST cleanly too).
  const approxMidnightUtc = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  const getWallClockUtcMs = (instant: Date): number => {
    const p = Object.fromEntries(
      partsFormatter.formatToParts(instant).map((entry) => [entry.type, entry.value]),
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
  };
  const offset1 = getWallClockUtcMs(new Date(approxMidnightUtc)) - approxMidnightUtc;
  let candidate = approxMidnightUtc - offset1;
  const offset2 = getWallClockUtcMs(new Date(candidate)) - candidate;
  candidate = approxMidnightUtc - offset2;

  const nextResetAt = new Date(candidate);
  const secondsUntilReset = Math.max(1, Math.ceil((nextResetAt.getTime() - now.getTime()) / 1000));
  return { storeDay, nextResetAt, secondsUntilReset };
}

function parseOptionalInt(value: unknown, min: number, max: number, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    return { ok: false, error: `${label} must be a whole number between ${min} and ${max}.` };
  }
  return { ok: true, value: num };
}

function parseRequiredInt(value: unknown, min: number, max: number, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    return { ok: false, error: `${label} must be a whole number between ${min} and ${max}.` };
  }
  return { ok: true, value: num };
}

function parseLocalDateTimeField(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !LOCAL_DATETIME_RE.test(value.trim())) {
    return { ok: false, error: `${label} must be a valid date and time.` };
  }
  const trimmed = value.trim();
  if (!Number.isFinite(Date.parse(trimmed))) {
    return { ok: false, error: `${label} is not a valid date and time.` };
  }
  return { ok: true, value: trimmed };
}

export function validateSpinWheelConfigInput(
  input: unknown,
): { ok: true; value: ValidatedSpinConfig } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the wheel configuration as a JSON object.' };
  }
  const raw = input as Record<string, unknown>;
  const settingsRaw = (raw.settings ?? {}) as Record<string, unknown>;
  const segmentsRaw = raw.segments;

  if (typeof settingsRaw.enabled !== 'boolean') {
    return { ok: false, error: 'Choose whether the Spin and Win wheel is enabled.' };
  }
  const title = typeof settingsRaw.title === 'string' ? settingsRaw.title.trim() : '';
  if (!title || title.length > 80) {
    return { ok: false, error: 'Wheel title must be between 1 and 80 characters.' };
  }
  const subtitle = typeof settingsRaw.subtitle === 'string' ? settingsRaw.subtitle.trim() : '';
  if (subtitle.length > 240) {
    return { ok: false, error: 'Subtitle must be 240 characters or fewer.' };
  }
  const startsAtLocal = parseLocalDateTimeField(settingsRaw.startsAt, 'Start time');
  if (!startsAtLocal.ok) return startsAtLocal;
  const endsAtLocal = parseLocalDateTimeField(settingsRaw.endsAt, 'End time');
  if (!endsAtLocal.ok) return endsAtLocal;
  if (
    startsAtLocal.value !== null
    && endsAtLocal.value !== null
    && Date.parse(startsAtLocal.value) >= Date.parse(endsAtLocal.value)
  ) {
    return { ok: false, error: 'End time must be after start time.' };
  }

  const spinsPerCustomer = parseRequiredInt(
    settingsRaw.spinsPerCustomerPerDay ?? 1,
    1,
    10,
    'Spins per customer per day',
  );
  if (!spinsPerCustomer.ok) return spinsPerCustomer;

  const maxPerIp = parseRequiredInt(
    settingsRaw.maxSpinsPerIpPerDay ?? 1,
    1,
    100,
    'Maximum spins per IP per day',
  );
  if (!maxPerIp.ok) return maxPerIp;

  const minAge = parseRequiredInt(
    settingsRaw.minAccountAgeMinutes ?? 0,
    0,
    525600,
    'Minimum account age (minutes)',
  );
  if (!minAge.ok) return minAge;

  const termsText = typeof settingsRaw.termsText === 'string' ? settingsRaw.termsText.trim() : '';
  if (termsText.length > 4000) {
    return { ok: false, error: 'Terms text must be 4,000 characters or fewer.' };
  }

  const showOnHomePage = Boolean(settingsRaw.showOnHomePage);

  const rawCooldownMode = settingsRaw.rewardCooldownMode;
  if (
    rawCooldownMode !== undefined
    && rawCooldownMode !== 'disabled'
    && rawCooldownMode !== 'until_coupon_expires'
    && rawCooldownMode !== 'custom_days'
  ) {
    return { ok: false, error: 'Choose a valid reward cooldown mode.' };
  }
  const rewardCooldownMode: SpinRewardCooldownMode = rawCooldownMode ?? 'until_coupon_expires';

  const rewardCooldownDays = parseRequiredInt(
    settingsRaw.rewardCooldownDays ?? 7,
    1,
    365,
    'Custom reward cooldown days',
  );
  if (!rewardCooldownDays.ok) return rewardCooldownDays;

  const showNextSpinCountdown =
    typeof settingsRaw.showNextSpinCountdown === 'boolean' ? settingsRaw.showNextSpinCountdown : true;

  if (!Array.isArray(segmentsRaw) || segmentsRaw.length < MIN_SEGMENTS || segmentsRaw.length > MAX_SEGMENTS) {
    return {
      ok: false,
      error: `Configure between ${MIN_SEGMENTS} and ${MAX_SEGMENTS} wheel segments.`,
    };
  }

  const validatedSegments: ValidatedSpinSegment[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < segmentsRaw.length; i += 1) {
    const seg = segmentsRaw[i] as Record<string, unknown>;
    if (!seg || typeof seg !== 'object') {
      return { ok: false, error: `Segment ${i + 1} is invalid.` };
    }
    const rawId = typeof seg.id === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(seg.id.trim())
      ? seg.id.trim()
      : `seg_new_${i + 1}`;
    if (seenIds.has(rawId)) {
      return { ok: false, error: 'Duplicate segment identifier.' };
    }
    seenIds.add(rawId);

    const label = typeof seg.label === 'string' ? seg.label.trim() : '';
    if (!label || label.length > MAX_SEGMENT_LABEL_LENGTH) {
      return {
        ok: false,
        error: `Segment ${i + 1}: label must be between 1 and ${MAX_SEGMENT_LABEL_LENGTH} characters.`,
      };
    }

    const colorHex = safeThemeColor(seg.colorHex);
    if (!colorHex) {
      return {
        ok: false,
        error: `Segment "${label}": enter a valid hex colour like #ffe100.`,
      };
    }

    const segmentType = seg.segmentType === 'COUPON' || seg.segmentType === 'NO_PRIZE'
      ? seg.segmentType
      : null;
    if (!segmentType) {
      return { ok: false, error: `Segment "${label}": choose Coupon prize or No prize.` };
    }

    const weight = parseRequiredInt(seg.weight, 1, 10000, `Segment "${label}" weight`);
    if (!weight.ok) return weight;

    const dailyCap = parseOptionalInt(seg.dailyCap, 1, 1_000_000, `Segment "${label}" daily cap`);
    if (!dailyCap.ok) return dailyCap;

    const totalCap = parseOptionalInt(seg.totalCap, 1, 10_000_000, `Segment "${label}" total cap`);
    if (!totalCap.ok) return totalCap;

    const isActive = seg.isActive !== false;
    const sortOrder = i;

    if (segmentType === 'NO_PRIZE') {
      validatedSegments.push({
        id: rawId,
        label,
        colorHex,
        segmentType: 'NO_PRIZE',
        weight: weight.value,
        dailyCap: dailyCap.value,
        totalCap: totalCap.value,
        isActive,
        sortOrder,
        couponType: null,
        couponValue: 0,
        couponMaxDiscountPaise: null,
        couponMinOrderPaise: 0,
        couponScope: 'ORDER',
        couponTargetIds: [],
        couponValidDays: 7,
        couponAllowWithSalePrice: false,
      });
      continue;
    }

    const couponType =
      seg.couponType === 'PERCENT' || seg.couponType === 'FIXED' || seg.couponType === 'FREE_SHIPPING'
        ? seg.couponType
        : null;
    if (!couponType) {
      return {
        ok: false,
        error: `Segment "${label}": choose Percentage, Fixed amount, or Free shipping.`,
      };
    }

    let couponValue = 0;
    let couponMaxDiscountPaise: number | null = null;
    if (couponType === 'PERCENT') {
      const pct = parseRequiredInt(seg.couponValueInput, 1, 100, `Segment "${label}" percentage`);
      if (!pct.ok) return pct;
      couponValue = pct.value;

      const maxParsed = parseRupeesToPaise(seg.couponMaxDiscountRupees);
      if (!maxParsed.ok) {
        return { ok: false, error: `Segment "${label}" max discount: ${maxParsed.message}` };
      }
      if (maxParsed.paise !== null && maxParsed.paise <= 0) {
        return { ok: false, error: `Segment "${label}": maximum discount must be above ₹0 or blank.` };
      }
      couponMaxDiscountPaise = maxParsed.paise;
    } else if (couponType === 'FIXED') {
      const amtParsed = parseRupeesToPaise(seg.couponValueInput);
      if (!amtParsed.ok || amtParsed.paise === null || amtParsed.paise <= 0) {
        return {
          ok: false,
          error: `Segment "${label}": enter a fixed discount amount above ₹0.`,
        };
      }
      couponValue = amtParsed.paise;
    }

    const minParsed = parseRupeesToPaise(seg.couponMinOrderRupees);
    if (!minParsed.ok) {
      return { ok: false, error: `Segment "${label}" minimum order: ${minParsed.message}` };
    }
    const couponMinOrderPaise = minParsed.paise ?? 0;

    const couponScope =
      seg.couponScope === 'ORDER' || seg.couponScope === 'PRODUCTS' || seg.couponScope === 'CATEGORIES'
        ? seg.couponScope
        : 'ORDER';

    const couponTargetIds = Array.isArray(seg.couponTargetIds)
      ? [...new Set(seg.couponTargetIds.map((entry) => String(entry).trim()).filter(Boolean))]
      : [];

    if (couponScope !== 'ORDER' && couponTargetIds.length === 0) {
      return {
        ok: false,
        error: `Segment "${label}": select at least one ${couponScope === 'PRODUCTS' ? 'product' : 'category'} for this coupon scope.`,
      };
    }

    const validDays = parseRequiredInt(seg.couponValidDays ?? 7, 1, 365, `Segment "${label}" valid days`);
    if (!validDays.ok) return validDays;

    validatedSegments.push({
      id: rawId,
      label,
      colorHex,
      segmentType: 'COUPON',
      weight: weight.value,
      dailyCap: dailyCap.value,
      totalCap: totalCap.value,
      isActive,
      sortOrder,
      couponType,
      couponValue,
      couponMaxDiscountPaise,
      couponMinOrderPaise,
      couponScope,
      couponTargetIds: couponScope === 'ORDER' ? [] : couponTargetIds,
      couponValidDays: validDays.value,
      couponAllowWithSalePrice: Boolean(seg.couponAllowWithSalePrice),
    });
  }

  // Enabling gate (Phase 3C): blocked until terms text exists and at least one prize segment is active.
  if (settingsRaw.enabled === true) {
    if (!termsText) {
      return {
        ok: false,
        error: 'Add Terms & conditions text before enabling the Spin and Win wheel.',
      };
    }
    const hasActivePrize = validatedSegments.some(
      (seg) => seg.isActive && seg.segmentType === 'COUPON',
    );
    if (!hasActivePrize) {
      return {
        ok: false,
        error: 'At least one active coupon prize segment is required before enabling the wheel.',
      };
    }
  }

  return {
    ok: true,
    value: {
      settings: {
        enabled: settingsRaw.enabled,
        title,
        subtitle,
        startsAtLocal: startsAtLocal.value,
        endsAtLocal: endsAtLocal.value,
        spinsPerCustomerPerDay: spinsPerCustomer.value,
        termsText,
        maxSpinsPerIpPerDay: maxPerIp.value,
        minAccountAgeMinutes: minAge.value,
        showOnHomePage,
        rewardCooldownMode,
        rewardCooldownDays: rewardCooldownDays.value,
        showNextSpinCountdown,
      },
      segments: validatedSegments,
    },
  };
}

/**
 * Server-side Spin and Win configuration loader, customer state reader,
 * and atomic draw + coupon creation transaction.
 *
 * Security & concurrency invariants:
 * - Never runs in the browser.
 * - Configuration reads use a short (5s) per-pool TTL cache to protect the small
 *   transaction pooler; the draw reads active slices lock-free and updates any
 *   capped counters at the end of the transaction via conditional
 *   `UPDATE ... WHERE count < cap RETURNING`.
 * - Draw uses "insert-first" on `spin_wheel_spins(user_id, store_day)` so double
 *   taps, multiple tabs, and concurrent requests can never award two spins on
 *   the same store day.
 * - Never logs draw results or generated coupon codes.
 */

import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import {
  BUSY_MESSAGE,
  BUSY_RETRY_AFTER,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  isTransactionTimeout,
} from '@/lib/checkout/transaction-guards';
import { generateCouponCode } from '@/lib/coupons/codes';
import { normalizeEmail } from '@/lib/coupons/rules';
import { isGiftSnapshotInStock } from '@/lib/free-gifts/rules';
import { giftTargetKey, loadGiftCatalogSnapshotMapUsing } from '@/lib/free-gifts/store';
import { enqueueNotification } from '@/lib/notifications/enqueue';
import { getSql } from '@/lib/platform/db';
import { maskEmail, maskPhone } from '@/lib/store-admin/audit';

import {
  computeSpinCooldownState,
  computeStoreDayInfo,
  contrastTextForHex,
  DEFAULT_SPIN_WHEEL_SETTINGS,
  DEFAULT_TIMEZONE,
  drawWeightedSegment,
  formatPrizeSummary,
  isWheelWindowOpen,
  type SpinCooldownWinInput,
  type SpinCouponScope,
  type SpinCouponType,
  type SpinRewardCooldownMode,
  type SpinSegmentType,
  type SpinWheelSegment,
  type SpinWheelSettings,
} from './rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Spin wheel store must run on the server only.');
}

type SqlLike = postgres.ISql;
type Row = Record<string, unknown>;

const CONFIG_CACHE_TTL_MS = 5_000;
const configCacheBySql = new WeakMap<
  object,
  { expiresAt: number; value: SpinWheelConfigSnapshot }
>();

export interface SpinWheelConfigSnapshot {
  settings: SpinWheelSettings;
  segments: SpinWheelSegment[];
  timeZone: string;
  schemaMissing?: boolean;
}

export interface PublicSpinSegment {
  id: string;
  label: string;
  colorHex: string;
  textColorHex: string;
  sortOrder: number;
}

export interface CustomerSpinResultView {
  spinId: string;
  storeDay: string;
  segmentId: string | null;
  segmentLabel: string;
  segmentType: SpinSegmentType;
  couponCode: string | null;
  couponSummary: string | null;
  couponExpiresAt: string | null;
  giftProductId?: string | null;
  giftProductName?: string | null;
  createdAt: string;
}

export interface ActiveSpinRewardView {
  couponCode: string | null;
  couponSummary: string | null;
  couponExpiresAt: string | null;
  segmentLabel: string;
}

export interface CustomerSpinProfile {
  email: string;
  phone: string | null;
  firstName: string;
}

export interface CustomerSpinState {
  available: boolean;
  signedIn: boolean;
  isOpen: boolean;
  windowReason: 'disabled' | 'no_terms' | 'not_started' | 'ended' | null;
  title: string;
  subtitle: string;
  termsText: string;
  showOnHomePage: boolean;
  popupEnabled: boolean;
  popupDelaySeconds: number;
  popupRequireScroll: boolean;
  popupMobileFloatingButton: boolean;
  timeZone: string;
  storeDay: string;
  nextSpinAt: string;
  secondsUntilReset: number;
  dailySpinsTotal: number;
  remainingSpinsToday: number;
  showNextSpinCountdown: boolean;
  rewardCooldownMode: SpinRewardCooldownMode;
  rewardCooldownDays: number;
  cooldownBlocked: boolean;
  cooldownUntil: string | null;
  activeReward: ActiveSpinRewardView | null;
  customerProfile: CustomerSpinProfile | null;
  segments: PublicSpinSegment[];
  todaySpin: CustomerSpinResultView | null;
}

export type SpinDrawResponse =
  | {
      ok: true;
      alreadySpun: boolean;
      spin: CustomerSpinResultView;
      nextSpinAt: string;
      secondsUntilReset: number;
    }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'unauthorized'
        | 'terms_required'
        | 'closed'
        | 'account_too_new'
        | 'ip_limit'
        | 'reward_cooldown'
        | 'exhausted'
        | 'bot_check_failed'
        | 'busy';
      error: string;
      retryAfterSec?: number;
      nextSpinAt?: string;
    };

class SpinAbortError extends Error {
  readonly reason: Extract<
    SpinDrawResponse,
    { ok: false }
  >['reason'];
  readonly retryAfterSec?: number;
  readonly nextSpinAt?: string;

  constructor(
    reason: Extract<SpinDrawResponse, { ok: false }>['reason'],
    message: string,
    extra: { retryAfterSec?: number; nextSpinAt?: string } = {},
  ) {
    super(message);
    this.name = 'SpinAbortError';
    this.reason = reason;
    this.retryAfterSec = extra.retryAfterSec;
    this.nextSpinAt = extra.nextSpinAt;
  }
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '23505'
  );
}

export function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '42P01'
  );
}

function mapCooldownMode(value: unknown): SpinRewardCooldownMode {
  return value === 'disabled' || value === 'until_coupon_expires' || value === 'custom_days'
    ? value
    : DEFAULT_SPIN_WHEEL_SETTINGS.rewardCooldownMode;
}

export function invalidateSpinWheelCache(sql?: SqlLike | null): void {
  const target = sql ?? getSql();
  if (target) configCacheBySql.delete(target as unknown as object);
}

export function mapSettingsRow(row: Row | undefined): SpinWheelSettings {
  if (!row) return { ...DEFAULT_SPIN_WHEEL_SETTINGS };
  return {
    enabled: row.enabled === true,
    title: text(row.title) || DEFAULT_SPIN_WHEEL_SETTINGS.title,
    subtitle: text(row.subtitle),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    spinsPerCustomerPerDay: Math.max(1, Number(row.spins_per_customer_per_day) || 1),
    termsText: text(row.terms_text),
    maxSpinsPerIpPerDay: Math.max(1, Number(row.max_spins_per_ip_per_day) || 1),
    minAccountAgeMinutes: Math.max(0, Number(row.min_account_age_minutes) || 0),
    showOnHomePage: row.show_on_home_page === true,
    popupEnabled:
      row.popup_enabled === undefined || row.popup_enabled === null
        ? DEFAULT_SPIN_WHEEL_SETTINGS.popupEnabled
        : row.popup_enabled === true,
    popupDelaySeconds:
      row.popup_delay_seconds === undefined || row.popup_delay_seconds === null
        ? DEFAULT_SPIN_WHEEL_SETTINGS.popupDelaySeconds
        : Math.min(120, Math.max(0, Number(row.popup_delay_seconds) || 0)),
    popupRequireScroll:
      row.popup_require_scroll === undefined || row.popup_require_scroll === null
        ? DEFAULT_SPIN_WHEEL_SETTINGS.popupRequireScroll
        : row.popup_require_scroll === true,
    popupMobileFloatingButton:
      row.popup_mobile_floating_button === undefined || row.popup_mobile_floating_button === null
        ? DEFAULT_SPIN_WHEEL_SETTINGS.popupMobileFloatingButton
        : row.popup_mobile_floating_button === true,
    rewardCooldownMode: mapCooldownMode(row.reward_cooldown_mode),
    rewardCooldownDays: Math.min(
      365,
      Math.max(1, Number(row.reward_cooldown_days) || DEFAULT_SPIN_WHEEL_SETTINGS.rewardCooldownDays),
    ),
    showNextSpinCountdown:
      row.show_next_spin_countdown === undefined || row.show_next_spin_countdown === null
        ? DEFAULT_SPIN_WHEEL_SETTINGS.showNextSpinCountdown
        : row.show_next_spin_countdown === true,
  };
}

export function mapSegmentRow(row: Row): SpinWheelSegment {
  const colorHex = text(row.color_hex) || '#ffe100';
  const rawType = text(row.segment_type);
  const segmentType: SpinSegmentType =
    rawType === 'COUPON' || rawType === 'FREE_GIFT' ? rawType : 'NO_PRIZE';
  return {
    id: text(row.id),
    label: text(row.label),
    colorHex,
    textColorHex: contrastTextForHex(colorHex),
    segmentType,
    weight: Math.max(1, Number(row.weight) || 1),
    dailyCap: row.daily_cap === null || row.daily_cap === undefined ? null : Number(row.daily_cap),
    totalCap: row.total_cap === null || row.total_cap === undefined ? null : Number(row.total_cap),
    totalAwarded: Math.max(0, Number(row.total_awarded) || 0),
    dailyAwarded: Math.max(0, Number(row.daily_awarded) || 0),
    isActive: row.is_active === true,
    sortOrder: Number(row.sort_order) || 0,
    couponType: row.coupon_type ? (text(row.coupon_type) as SpinCouponType) : null,
    couponValue: Math.max(0, Number(row.coupon_value) || 0),
    couponMaxDiscountPaise:
      row.coupon_max_discount_paise === null || row.coupon_max_discount_paise === undefined
        ? null
        : Number(row.coupon_max_discount_paise),
    couponMinOrderPaise: Math.max(0, Number(row.coupon_min_order_paise) || 0),
    couponScope: (text(row.coupon_scope) || 'ORDER') as SpinCouponScope,
    couponTargetIds: Array.isArray(row.coupon_target_ids)
      ? row.coupon_target_ids.map(String).filter(Boolean)
      : [],
    couponValidDays: Math.max(1, Number(row.coupon_valid_days) || 7),
    couponAllowWithSalePrice: row.coupon_allow_with_sale_price === true,
    giftProductId: row.gift_product_id ? text(row.gift_product_id) : null,
    giftVariantId: row.gift_variant_id ? text(row.gift_variant_id) : null,
    giftProductName: row.gift_product_name ? text(row.gift_product_name) : null,
    giftMinOrderPaise: Math.max(0, Number(row.gift_min_order_paise) || 0),
    giftValidDays: Math.max(1, Number(row.gift_valid_days) || 7),
    giftAvailable: typeof row.gift_available === 'boolean' ? row.gift_available : undefined,
  };
}

export async function hydrateFreeGiftSegmentsUsing(
  sql: SqlLike,
  segments: SpinWheelSegment[],
  options: { includeInactive?: boolean } = {},
): Promise<SpinWheelSegment[]> {
  const giftTargets = segments
    .filter(
      (s) =>
        (options.includeInactive || s.isActive)
        && s.segmentType === 'FREE_GIFT'
        && Boolean(s.giftProductId),
    )
    .map((s) => ({ productId: s.giftProductId!, variantId: s.giftVariantId ?? null }));
  if (giftTargets.length === 0) return segments;
  try {
    const snapMap = await loadGiftCatalogSnapshotMapUsing(sql, giftTargets);
    return segments.map((s) => {
      if (s.segmentType !== 'FREE_GIFT' || !s.giftProductId) return s;
      const snap = snapMap.get(giftTargetKey(s.giftProductId, s.giftVariantId ?? null)) ?? null;
      return {
        ...s,
        giftProductName: snap?.productName ?? s.giftProductName ?? null,
        giftAvailable: isGiftSnapshotInStock(snap),
      };
    });
  } catch {
    return segments;
  }
}

async function readValidatedTimeZone(sql: SqlLike): Promise<string> {
  const rows = (await sql`
    select coalesce(
      (
        select p.name
        from store_settings ss
        join pg_timezone_names p on p.name = btrim(ss.value)
        where ss.key = 'timezone'
        limit 1
      ),
      ${DEFAULT_TIMEZONE}
    ) as tz
  `) as Array<{ tz: unknown }>;
  return text(rows[0]?.tz) || DEFAULT_TIMEZONE;
}

export async function getSpinWheelConfigUsing(
  sql: SqlLike,
  options: { bypassCache?: boolean; cacheKey?: object } = {},
): Promise<SpinWheelConfigSnapshot> {
  const key = (options.cacheKey ?? sql) as unknown as object;
  if (!options.bypassCache) {
    const cached = configCacheBySql.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  try {
    const [timeZone, settingsRows, segmentRows] = await Promise.all([
      readValidatedTimeZone(sql),
      sql`select * from spin_wheel_settings where id = 'default' limit 1` as Promise<Row[]>,
      sql`
        select *, 0 as daily_awarded
        from spin_wheel_segments
        order by sort_order asc, id asc
      ` as Promise<Row[]>,
    ]);

    const segments = await hydrateFreeGiftSegmentsUsing(sql, segmentRows.map(mapSegmentRow));
    const value: SpinWheelConfigSnapshot = {
      settings: mapSettingsRow(settingsRows[0]),
      segments,
      timeZone,
    };

    if (!options.bypassCache) {
      configCacheBySql.set(key, {
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
        value,
      });
    }
    return value;
  } catch (error) {
    if (isUndefinedTableError(error)) {
      console.warn('[spin-wheel] spin_wheel_settings schema missing; failing closed');
      return {
        settings: { ...DEFAULT_SPIN_WHEEL_SETTINGS },
        segments: [],
        timeZone: DEFAULT_TIMEZONE,
        schemaMissing: true,
      };
    }
    throw error;
  }
}

function couponSummaryFromJoinedRow(row: Row): string | null {
  if (!row.coupon_code || !row.c_type) return null;
  const type = text(row.c_type);
  const val = Number(row.c_value) || 0;
  if (type === 'FREE_GIFT') {
    const giftName = text(row.gift_product_name).trim();
    return giftName ? `Free gift: ${giftName}` : 'Free gift item';
  }
  if (type === 'FREE_SHIPPING') return 'Free shipping';
  if (type === 'PERCENT') return `${val}% off`;
  return `₹${(val / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} off`;
}

function mapSpinResultRow(row: Row): CustomerSpinResultView {
  const storeDayRaw = row.store_day instanceof Date
    ? row.store_day.toISOString().slice(0, 10)
    : text(row.store_day).slice(0, 10);
  const rawType = text(row.segment_type);
  const segmentType: SpinSegmentType =
    rawType === 'COUPON' || rawType === 'FREE_GIFT' ? rawType : 'NO_PRIZE';
  return {
    spinId: text(row.id),
    storeDay: storeDayRaw,
    segmentId: row.segment_id ? text(row.segment_id) : null,
    segmentLabel: text(row.segment_label),
    segmentType,
    couponCode: row.coupon_code ? text(row.coupon_code) : null,
    couponSummary: couponSummaryFromJoinedRow(row),
    couponExpiresAt: iso(row.c_ends_at),
    giftProductId: row.c_gift_product_id ? text(row.c_gift_product_id) : null,
    giftProductName: row.gift_product_name ? text(row.gift_product_name) : null,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

function unavailableCustomerSpinState(signedIn: boolean): CustomerSpinState {
  const dayInfo = computeStoreDayInfo(new Date(), DEFAULT_TIMEZONE);
  return {
    available: false,
    signedIn,
    isOpen: false,
    windowReason: 'disabled',
    title: DEFAULT_SPIN_WHEEL_SETTINGS.title,
    subtitle: DEFAULT_SPIN_WHEEL_SETTINGS.subtitle,
    termsText: '',
    showOnHomePage: false,
    popupEnabled: false,
    popupDelaySeconds: DEFAULT_SPIN_WHEEL_SETTINGS.popupDelaySeconds,
    popupRequireScroll: DEFAULT_SPIN_WHEEL_SETTINGS.popupRequireScroll,
    popupMobileFloatingButton: DEFAULT_SPIN_WHEEL_SETTINGS.popupMobileFloatingButton,
    timeZone: DEFAULT_TIMEZONE,
    storeDay: dayInfo.storeDay,
    nextSpinAt: dayInfo.nextResetAt.toISOString(),
    secondsUntilReset: dayInfo.secondsUntilReset,
    dailySpinsTotal: DEFAULT_SPIN_WHEEL_SETTINGS.spinsPerCustomerPerDay,
    remainingSpinsToday: 0,
    showNextSpinCountdown: DEFAULT_SPIN_WHEEL_SETTINGS.showNextSpinCountdown,
    rewardCooldownMode: DEFAULT_SPIN_WHEEL_SETTINGS.rewardCooldownMode,
    rewardCooldownDays: DEFAULT_SPIN_WHEEL_SETTINGS.rewardCooldownDays,
    cooldownBlocked: false,
    cooldownUntil: null,
    activeReward: null,
    customerProfile: null,
    segments: [],
    todaySpin: null,
  };
}

async function readExistingSpinForDay(
  sql: SqlLike,
  userId: string,
  storeDay: string,
): Promise<CustomerSpinResultView | null> {
  const rows = (await sql`
    select
      sp.id, sp.store_day::text as store_day, sp.segment_id, sp.segment_label,
      sp.segment_type, sp.coupon_code, sp.created_at,
      c.type as c_type, c.value as c_value, c.ends_at as c_ends_at,
      to_jsonb(c)->>'gift_product_id' as c_gift_product_id,
      gp.name as gift_product_name
    from spin_wheel_spins sp
    left join coupons c on c.id = sp.coupon_id
    left join products gp on gp.id = (to_jsonb(c)->>'gift_product_id')
    where sp.user_id = ${userId} and sp.store_day = ${storeDay}::date
    limit 1
  `) as Row[];
  return rows[0] ? mapSpinResultRow(rows[0]) : null;
}

async function readLatestCouponSpin(
  sql: SqlLike,
  userId: string,
): Promise<SpinCooldownWinInput | null> {
  const rows = (await sql`
    select
      sp.segment_label, sp.coupon_code, sp.created_at,
      c.type as c_type, c.value as c_value, c.ends_at as c_ends_at,
      gp.name as gift_product_name
    from spin_wheel_spins sp
    left join coupons c on c.id = sp.coupon_id
    left join products gp on gp.id = (to_jsonb(c)->>'gift_product_id')
    where sp.user_id = ${userId}
      and sp.segment_type in ('COUPON', 'FREE_GIFT')
      and sp.coupon_id is not null
    order by sp.created_at desc
    limit 1
  `) as Row[];
  const row = rows[0];
  if (!row) return null;
  const createdAt = iso(row.created_at);
  const couponEndsAtIso = iso(row.c_ends_at);
  return {
    createdAt: createdAt ? new Date(createdAt) : new Date(),
    couponEndsAt: couponEndsAtIso ? new Date(couponEndsAtIso) : null,
    couponCode: row.coupon_code ? text(row.coupon_code) : null,
    couponSummary: couponSummaryFromJoinedRow(row),
    segmentLabel: text(row.segment_label),
  };
}

async function readCustomerProfile(
  sql: SqlLike,
  userId: string,
): Promise<CustomerSpinProfile | null> {
  const rows = (await sql`
    select email, phone, first_name
    from users
    where id = ${userId}
    limit 1
  `) as Row[];
  const row = rows[0];
  if (!row) return null;
  const rawEmail = text(row.email).trim();
  const rawPhone = row.phone ? text(row.phone).trim() : '';
  return {
    email: rawEmail ? maskEmail(rawEmail) : '',
    phone: rawPhone ? maskPhone(rawPhone) : null,
    firstName: text(row.first_name),
  };
}

function toPublicSegments(config: SpinWheelConfigSnapshot): PublicSpinSegment[] {
  return config.segments
    .filter((seg) => seg.isActive)
    .map((seg) => ({
      id: seg.id,
      label: seg.label,
      colorHex: seg.colorHex,
      textColorHex: seg.textColorHex,
      sortOrder: seg.sortOrder,
    }));
}

export function buildPublicCustomerSpinState(
  config: SpinWheelConfigSnapshot,
  signedIn: boolean,
  now: Date = new Date(),
): CustomerSpinState {
  if (config.schemaMissing) {
    return unavailableCustomerSpinState(signedIn);
  }
  const dayInfo = computeStoreDayInfo(now, config.timeZone);
  const windowState = isWheelWindowOpen(config.settings, now);
  const cooldown = computeSpinCooldownState({
    dbNow: now,
    nextDailyResetAt: dayInfo.nextResetAt,
    latestCouponWin: null,
    rewardCooldownMode: config.settings.rewardCooldownMode,
    rewardCooldownDays: config.settings.rewardCooldownDays,
  });
  const dailySpinsTotal = Math.max(1, config.settings.spinsPerCustomerPerDay);
  return {
    available: true,
    signedIn,
    isOpen: windowState.open,
    windowReason: windowState.reason,
    title: config.settings.title,
    subtitle: config.settings.subtitle,
    termsText: config.settings.termsText,
    showOnHomePage: config.settings.showOnHomePage,
    popupEnabled: config.settings.popupEnabled,
    popupDelaySeconds: config.settings.popupDelaySeconds,
    popupRequireScroll: config.settings.popupRequireScroll,
    popupMobileFloatingButton: config.settings.popupMobileFloatingButton,
    timeZone: config.timeZone,
    storeDay: dayInfo.storeDay,
    nextSpinAt: cooldown.nextSpinAt.toISOString(),
    secondsUntilReset: cooldown.secondsUntilReset,
    dailySpinsTotal,
    remainingSpinsToday: dailySpinsTotal,
    showNextSpinCountdown: config.settings.showNextSpinCountdown,
    rewardCooldownMode: config.settings.rewardCooldownMode,
    rewardCooldownDays: config.settings.rewardCooldownDays,
    cooldownBlocked: false,
    cooldownUntil: null,
    activeReward: null,
    customerProfile: null,
    segments: toPublicSegments(config),
    todaySpin: null,
  };
}

export async function getCustomerSpinStateUsing(
  sql: SqlLike,
  userId: string | null,
  options: {
    bypassCache?: boolean;
    nowOverride?: Date;
    preloadedConfig?: SpinWheelConfigSnapshot;
  } = {},
): Promise<CustomerSpinState> {
  try {
    const config =
      options.preloadedConfig
      ?? (await getSpinWheelConfigUsing(sql, { bypassCache: options.bypassCache }));

    if (config.schemaMissing) {
      return unavailableCustomerSpinState(Boolean(userId));
    }

    if (!userId) {
      const clockRows = options.nowOverride
        ? null
        : ((await sql`select now() as db_now`) as Array<{ db_now: Date | string }>);
      const dbNow = options.nowOverride ?? new Date(clockRows?.[0]?.db_now ?? new Date());
      return buildPublicCustomerSpinState(config, false, dbNow);
    }

    const dbNow = options.nowOverride
      ? options.nowOverride
      : new Date(
          ((await sql`select now() as db_now`) as Array<{ db_now: Date | string }>)[0]?.db_now
          ?? new Date(),
        );
    const dayInfo = computeStoreDayInfo(dbNow, config.timeZone);
    const windowState = isWheelWindowOpen(config.settings, dbNow);

    const [todaySpin, latestCouponWin, customerProfile] = await Promise.all([
      readExistingSpinForDay(sql, userId, dayInfo.storeDay),
      config.settings.rewardCooldownMode !== 'disabled'
        ? readLatestCouponSpin(sql, userId)
        : Promise.resolve(null),
      readCustomerProfile(sql, userId),
    ]);

    const cooldown = computeSpinCooldownState({
      dbNow,
      nextDailyResetAt: dayInfo.nextResetAt,
      latestCouponWin,
      rewardCooldownMode: config.settings.rewardCooldownMode,
      rewardCooldownDays: config.settings.rewardCooldownDays,
    });
    const dailySpinsTotal = Math.max(1, config.settings.spinsPerCustomerPerDay);
    const remainingSpinsToday = todaySpin || cooldown.blockedByCooldown ? 0 : dailySpinsTotal;

    return {
      available: true,
      signedIn: true,
      isOpen: windowState.open,
      windowReason: windowState.reason,
      title: config.settings.title,
      subtitle: config.settings.subtitle,
      termsText: config.settings.termsText,
      showOnHomePage: config.settings.showOnHomePage,
      popupEnabled: config.settings.popupEnabled,
      popupDelaySeconds: config.settings.popupDelaySeconds,
      popupRequireScroll: config.settings.popupRequireScroll,
      popupMobileFloatingButton: config.settings.popupMobileFloatingButton,
      timeZone: config.timeZone,
      storeDay: dayInfo.storeDay,
      nextSpinAt: cooldown.nextSpinAt.toISOString(),
      secondsUntilReset: cooldown.secondsUntilReset,
      dailySpinsTotal,
      remainingSpinsToday,
      showNextSpinCountdown: config.settings.showNextSpinCountdown,
      rewardCooldownMode: config.settings.rewardCooldownMode,
      rewardCooldownDays: config.settings.rewardCooldownDays,
      cooldownBlocked: cooldown.blockedByCooldown,
      cooldownUntil: cooldown.cooldownUntil ? cooldown.cooldownUntil.toISOString() : null,
      activeReward: cooldown.activeReward,
      customerProfile,
      segments: toPublicSegments(config),
      todaySpin,
    };
  } catch (error) {
    if (isUndefinedTableError(error)) {
      console.warn('[spin-wheel] spin tables missing; returning unavailable state');
      return unavailableCustomerSpinState(Boolean(userId));
    }
    throw error;
  }
}

export async function getCustomerSpinState(userId: string | null): Promise<CustomerSpinState> {
  const sql = getSql();
  if (!sql) {
    return unavailableCustomerSpinState(Boolean(userId));
  }
  try {
    return await getCustomerSpinStateUsing(sql, userId);
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return unavailableCustomerSpinState(Boolean(userId));
    }
    console.warn('[spin-wheel] failed to read customer spin state');
    return unavailableCustomerSpinState(Boolean(userId));
  }
}

export interface HomeSpinBannerData {
  show: boolean;
  title: string;
  subtitle: string;
}

export interface HomeSpinSurfaceData {
  banner: HomeSpinBannerData;
  spinState: CustomerSpinState;
}

/**
 * Resolve both the home banner and popup/wheel state cleanly:
 * - Signed-out visitors use only the 5s cached configuration (0 extra DB queries).
 * - Signed-in visitors query their daily spin/cooldown/profile only when the
 *   home wheel surface is open and configured to show on the home page.
 */
export async function getHomeSpinSurfaceUsing(
  sql: SqlLike,
  userId: string | null,
  options: { bypassCache?: boolean; nowOverride?: Date } = {},
): Promise<HomeSpinSurfaceData> {
  const now = options.nowOverride ?? new Date();
  const config = await getSpinWheelConfigUsing(sql, { bypassCache: options.bypassCache });
  if (config.schemaMissing) {
    return {
      banner: { show: false, title: '', subtitle: '' },
      spinState: unavailableCustomerSpinState(Boolean(userId)),
    };
  }

  const windowState = isWheelWindowOpen(config.settings, now);
  const hasActiveSegments = config.segments.filter((s) => s.isActive).length >= 2;
  const showHome = config.settings.showOnHomePage && windowState.open && hasActiveSegments;
  const banner: HomeSpinBannerData = {
    show: showHome,
    title: showHome ? config.settings.title : '',
    subtitle: showHome ? config.settings.subtitle : '',
  };

  if (!userId || !showHome) {
    return {
      banner,
      spinState: buildPublicCustomerSpinState(config, Boolean(userId), now),
    };
  }

  const spinState = await getCustomerSpinStateUsing(sql, userId, {
    preloadedConfig: config,
    nowOverride: options.nowOverride,
  });
  return { banner, spinState };
}

export async function getHomeSpinSurface(userId: string | null): Promise<HomeSpinSurfaceData> {
  const sql = getSql();
  if (!sql) {
    return {
      banner: { show: false, title: '', subtitle: '' },
      spinState: unavailableCustomerSpinState(Boolean(userId)),
    };
  }
  try {
    return await getHomeSpinSurfaceUsing(sql, userId);
  } catch (error) {
    if (!isUndefinedTableError(error)) {
      console.warn('[spin-wheel] failed to read home spin surface');
    }
    return {
      banner: { show: false, title: '', subtitle: '' },
      spinState: unavailableCustomerSpinState(Boolean(userId)),
    };
  }
}

/** Lightweight read for home page entry strip without loading customer spin history. */
export async function getHomeSpinBannerState(): Promise<HomeSpinBannerData> {
  const sql = getSql();
  if (!sql) return { show: false, title: '', subtitle: '' };
  try {
    const config = await getSpinWheelConfigUsing(sql);
    if (config.schemaMissing) return { show: false, title: '', subtitle: '' };
    const windowState = isWheelWindowOpen(config.settings, new Date());
    const hasActiveSegments = config.segments.filter((s) => s.isActive).length >= 2;
    return {
      show: config.settings.showOnHomePage && windowState.open && hasActiveSegments,
      title: config.settings.title,
      subtitle: config.settings.subtitle,
    };
  } catch {
    return { show: false, title: '', subtitle: '' };
  }
}

async function insertPersonalSpinCouponInTx(
  tx: postgres.TransactionSql,
  input: {
    segment: SpinWheelSegment;
    userEmail: string;
    startsAt: Date;
    endsAt: Date;
  },
): Promise<{ couponId: string; code: string }> {
  const { segment, userEmail, startsAt, endsAt } = input;
  const email = normalizeEmail(userEmail);
  const couponId = `cpn_${randomBytes(6).toString('hex')}`;
  const isFreeGift = segment.segmentType === 'FREE_GIFT';
  const cType = isFreeGift ? 'FREE_GIFT' : segment.couponType;
  const cValue = isFreeGift ? 0 : segment.couponValue;
  const cScope = isFreeGift ? 'ORDER' : segment.couponScope;
  const cMinOrder = isFreeGift ? (segment.giftMinOrderPaise ?? 0) : segment.couponMinOrderPaise;
  const cMaxDiscount = isFreeGift ? null : segment.couponMaxDiscountPaise;
  const cAllowWithSale = isFreeGift ? true : segment.couponAllowWithSalePrice;
  const summary = formatPrizeSummary(segment);
  const couponName = `Spin & Win: ${segment.label}`.slice(0, 100);
  const description = `Personal Spin and Win reward (${summary})`.slice(0, 300);

  let code = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateCouponCode('SPIN', 8);
    await tx`savepoint sp_spin_coupon`;
    try {
      if (isFreeGift) {
        await tx`
          insert into coupons (
            id, code, name, description, type, value, scope, status,
            starts_at, ends_at, total_redemption_limit, per_customer_limit,
            min_order_paise, max_discount_paise, only_new_customers,
            allow_with_sale_price, allowed_customer_groups, restricted_to_emails,
            show_to_all_users, assigned_to_emails, assigned_customer_groups,
            gift_product_id, gift_variant_id,
            source, created_by, created_at, updated_at
          ) values (
            ${couponId},
            ${candidate},
            ${couponName},
            ${description},
            ${cType},
            ${cValue},
            ${cScope},
            'active',
            ${startsAt},
            ${endsAt},
            1,
            1,
            ${cMinOrder},
            ${cMaxDiscount},
            false,
            ${cAllowWithSale},
            ${null},
            ${[email]},
            false,
            ${[email]},
            ${[]},
            ${segment.giftProductId ?? null},
            ${segment.giftVariantId ?? null},
            'spin_wheel',
            'spin_wheel',
            ${startsAt},
            ${startsAt}
          )
        `;
      } else {
        await tx`
          insert into coupons (
            id, code, name, description, type, value, scope, status,
            starts_at, ends_at, total_redemption_limit, per_customer_limit,
            min_order_paise, max_discount_paise, only_new_customers,
            allow_with_sale_price, allowed_customer_groups, restricted_to_emails,
            show_to_all_users, assigned_to_emails, assigned_customer_groups,
            source, created_by, created_at, updated_at
          ) values (
            ${couponId},
            ${candidate},
            ${couponName},
            ${description},
            ${cType},
            ${cValue},
            ${cScope},
            'active',
            ${startsAt},
            ${endsAt},
            1,
            1,
            ${cMinOrder},
            ${cMaxDiscount},
            false,
            ${cAllowWithSale},
            ${null},
            ${[email]},
            false,
            ${[email]},
            ${[]},
            'spin_wheel',
            'spin_wheel',
            ${startsAt},
            ${startsAt}
          )
        `;
      }
      await tx`release savepoint sp_spin_coupon`;
      code = candidate;
      break;
    } catch (error) {
      await tx`rollback to savepoint sp_spin_coupon`;
      if (isUniqueViolation(error) && attempt < 5) continue;
      throw error;
    }
  }

  if (!code) throw new Error('Could not generate a unique coupon code.');

  if (!isFreeGift && segment.couponScope === 'PRODUCTS') {
    for (const productId of segment.couponTargetIds) {
      await tx`
        insert into coupon_targets (coupon_id, product_id)
        values (${couponId}, ${productId})
        on conflict do nothing
      `;
    }
  } else if (!isFreeGift && segment.couponScope === 'CATEGORIES') {
    for (const categoryId of segment.couponTargetIds) {
      await tx`
        insert into coupon_targets (coupon_id, category_id)
        values (${couponId}, ${categoryId})
        on conflict do nothing
      `;
    }
  }

  return { couponId, code };
}

function spinResultToCooldownInput(spin: CustomerSpinResultView): SpinCooldownWinInput {
  return {
    createdAt: new Date(spin.createdAt),
    couponEndsAt: spin.couponExpiresAt ? new Date(spin.couponExpiresAt) : null,
    couponCode: spin.couponCode,
    couponSummary: spin.couponSummary,
    segmentLabel: spin.segmentLabel,
  };
}

async function resolveCooldownForSpinView(
  tx: SqlLike,
  userId: string,
  spin: CustomerSpinResultView,
  dbNow: Date,
  nextDailyResetAt: Date,
  settings: SpinWheelSettings,
) {
  const latestWin = spin.segmentType === 'COUPON' || spin.segmentType === 'FREE_GIFT'
    ? spinResultToCooldownInput(spin)
    : await readLatestCouponSpin(tx, userId);
  return computeSpinCooldownState({
    dbNow,
    nextDailyResetAt,
    latestCouponWin: latestWin,
    rewardCooldownMode: settings.rewardCooldownMode,
    rewardCooldownDays: settings.rewardCooldownDays,
  });
}

function formatRewardCooldownError(settings: SpinWheelSettings): string {
  if (settings.rewardCooldownMode === 'until_coupon_expires') {
    return 'You already claimed a Spin & Win reward. You can spin again after your coupon expires.';
  }
  const days = settings.rewardCooldownDays;
  return `You recently won a Spin & Win reward. Your next spin unlocks after the ${days}-day cooldown.`;
}

export interface SpinBotCheckContext {
  userId: string;
  ipHash: string;
}

export type SpinBotCheckHook = (
  ctx: SpinBotCheckContext,
) => Promise<{ ok: boolean; error?: string }>;

export async function executeSpinDrawUsing(
  sql: postgres.Sql,
  input: {
    userId: string;
    ipHash: string;
    termsAccepted: boolean;
  },
  options: {
    rollFn?: (totalWeight: number) => number;
    nowOverride?: Date;
    botCheck?: SpinBotCheckHook;
    lockTimeoutMs?: number;
    beforeCounterHook?: (ctx: {
      tx: postgres.TransactionSql;
      chosen: SpinWheelSegment;
      spinId: string;
    }) => Promise<void>;
  } = {},
): Promise<SpinDrawResponse> {
  if (!input.userId) {
    return { ok: false, reason: 'unauthorized', error: 'Please sign in to spin the wheel.' };
  }
  if (!input.termsAccepted) {
    return {
      ok: false,
      reason: 'terms_required',
      error: 'Please accept the Terms & conditions before spinning.',
    };
  }
  if (options.botCheck) {
    const botVerdict = await options.botCheck({
      userId: input.userId,
      ipHash: input.ipHash,
    });
    if (!botVerdict.ok) {
      return {
        ok: false,
        reason: 'bot_check_failed',
        error: botVerdict.error || 'Please complete bot verification before spinning.',
      };
    }
  }

  const lockTimeoutMs = Math.max(1, Math.trunc(options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS));

  try {
    const committed = await sql.begin(async (tx) => {
      // 1. Coalesced transaction timeouts + clock + timezone + user + settings (no row locks).
      const [initRow] = (await tx`
        select
          set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true),
          set_config('statement_timeout', ${`${DEFAULT_STATEMENT_TIMEOUT_MS}ms`}, true),
          now() as db_now,
          coalesce(
            (
              select p.name
              from store_settings ss
              join pg_timezone_names p on p.name = btrim(ss.value)
              where ss.key = 'timezone'
              limit 1
            ),
            ${DEFAULT_TIMEZONE}
          ) as tz,
          u.id as user_id,
          u.email as user_email,
          u.first_name as user_first_name,
          u.created_at as user_created_at,
          s.id as settings_id,
          s.enabled,
          s.title,
          s.subtitle,
          s.starts_at,
          s.ends_at,
          s.spins_per_customer_per_day,
          s.terms_text,
          s.max_spins_per_ip_per_day,
          s.min_account_age_minutes,
          s.show_on_home_page,
          s.popup_enabled,
          s.popup_delay_seconds,
          s.popup_require_scroll,
          s.popup_mobile_floating_button,
          s.reward_cooldown_mode,
          s.reward_cooldown_days,
          s.show_next_spin_countdown
        from (select 1) as anchor
        left join users u on u.id = ${input.userId}
        left join spin_wheel_settings s on s.id = 'default'
      `) as Row[];

      if (!initRow?.user_id) {
        throw new SpinAbortError('unauthorized', 'Please sign in to spin the wheel.');
      }

      const timeZone = text(initRow.tz) || DEFAULT_TIMEZONE;
      const dbNow = options.nowOverride ?? new Date((initRow.db_now as Date | string | undefined) ?? new Date());
      const dayInfo = computeStoreDayInfo(dbNow, timeZone);
      const settings = mapSettingsRow(initRow.settings_id ? initRow : undefined);
      const userEmail = text(initRow.user_email);
      const userFirstName = text(initRow.user_first_name);
      const userCreatedAt = new Date((initRow.user_created_at as Date | string) ?? dbNow);

      // 2. Check existing daily spin + prior winning cooldown (pipelined, no locks).
      const [existingBefore, latestWin] = await Promise.all([
        readExistingSpinForDay(tx, input.userId, dayInfo.storeDay),
        settings.rewardCooldownMode !== 'disabled'
          ? readLatestCouponSpin(tx, input.userId)
          : Promise.resolve(null),
      ]);

      // Fast path if today's spin already exists for this customer.
      if (existingBefore) {
        const latestForView =
          existingBefore.segmentType === 'COUPON' || existingBefore.segmentType === 'FREE_GIFT'
            ? spinResultToCooldownInput(existingBefore)
            : latestWin;
        const cooldown = computeSpinCooldownState({
          dbNow,
          nextDailyResetAt: dayInfo.nextResetAt,
          latestCouponWin: latestForView,
          rewardCooldownMode: settings.rewardCooldownMode,
          rewardCooldownDays: settings.rewardCooldownDays,
        });
        return {
          alreadySpun: true as const,
          spin: existingBefore,
          nextSpinAt: cooldown.nextSpinAt.toISOString(),
          secondsUntilReset: cooldown.secondsUntilReset,
          userEmail,
          customerName: userFirstName,
          wonCoupon: false,
          couponExpiresAt: existingBefore.couponExpiresAt,
          timeZone,
        };
      }

      const windowState = isWheelWindowOpen(settings, dbNow);
      if (!windowState.open) {
        throw new SpinAbortError(
          'closed',
          windowState.reason === 'not_started'
            ? 'Spin and Win has not started yet.'
            : windowState.reason === 'ended'
              ? 'This Spin and Win promotion has ended.'
              : 'Spin and Win is currently unavailable.',
        );
      }

      if (settings.minAccountAgeMinutes > 0) {
        const ageMinutes = (dbNow.getTime() - userCreatedAt.getTime()) / 60_000;
        if (ageMinutes < settings.minAccountAgeMinutes) {
          throw new SpinAbortError(
            'account_too_new',
            'Your account is not eligible to spin yet. Please try again later.',
          );
        }
      }

      if (settings.rewardCooldownMode !== 'disabled') {
        const cooldown = computeSpinCooldownState({
          dbNow,
          nextDailyResetAt: dayInfo.nextResetAt,
          latestCouponWin: latestWin,
          rewardCooldownMode: settings.rewardCooldownMode,
          rewardCooldownDays: settings.rewardCooldownDays,
        });
        if (cooldown.blockedByCooldown) {
          throw new SpinAbortError(
            'reward_cooldown',
            formatRewardCooldownError(settings),
            {
              retryAfterSec: cooldown.secondsUntilReset,
              nextSpinAt: cooldown.nextSpinAt.toISOString(),
            },
          );
        }
      }

      // 3. Insert-first on (user_id, store_day). Only this customer's duplicate clicks
      // contend on this per-customer unique index tuple; different customers never block.
      const spinId = `spn_${randomBytes(8).toString('hex')}`;
      const inserted = (await tx`
        insert into spin_wheel_spins (
          id, user_id, store_day, segment_label, segment_type, ip_hash, terms_accepted_at, created_at
        ) values (
          ${spinId},
          ${input.userId},
          ${dayInfo.storeDay}::date,
          'PENDING',
          'NO_PRIZE',
          ${input.ipHash},
          ${dbNow},
          ${dbNow}
        )
        on conflict (user_id, store_day) do nothing
        returning id
      `) as Array<{ id: string }>;

      if (inserted.length === 0) {
        const existingConcurrent = await readExistingSpinForDay(tx, input.userId, dayInfo.storeDay);
        if (!existingConcurrent) {
          throw new SpinAbortError('busy', BUSY_MESSAGE, { retryAfterSec: 2 });
        }
        const cooldown = await resolveCooldownForSpinView(
          tx,
          input.userId,
          existingConcurrent,
          dbNow,
          dayInfo.nextResetAt,
          settings,
        );
        return {
          alreadySpun: true as const,
          spin: existingConcurrent,
          nextSpinAt: cooldown.nextSpinAt.toISOString(),
          secondsUntilReset: cooldown.secondsUntilReset,
          userEmail,
          customerName: userFirstName,
          wonCoupon: false,
          couponExpiresAt: existingConcurrent.couponExpiresAt,
          timeZone,
        };
      }

      // 4. Pipelined per-IP cap check + lock-free active segment/daily-count read.
      const [ipRows, segmentRows] = await Promise.all([
        input.ipHash
          ? (tx`
              select count(*)::int as cnt
              from spin_wheel_spins
              where store_day = ${dayInfo.storeDay}::date
                and ip_hash = ${input.ipHash}
                and id <> ${spinId}
            ` as Promise<Array<{ cnt: number }>>)
          : Promise.resolve([]),
        tx`
          select s.*, coalesce(dc.awarded_count, 0)::int as daily_awarded
          from spin_wheel_segments s
          left join spin_wheel_segment_daily_counts dc
            on dc.segment_id = s.id and dc.store_day = ${dayInfo.storeDay}::date
          where s.is_active = true
          order by s.sort_order asc, s.id asc
        ` as Promise<Row[]>,
      ]);

      if (input.ipHash && Number(ipRows[0]?.cnt ?? 0) >= settings.maxSpinsPerIpPerDay) {
        throw new SpinAbortError(
          'ip_limit',
          'Daily spin limit reached for this network. Please try again tomorrow.',
          {
            retryAfterSec: dayInfo.secondsUntilReset,
            nextSpinAt: dayInfo.nextResetAt.toISOString(),
          },
        );
      }

      // 5. Weighted draw + coupon insert + own spin row update, followed at the very end
      // by conditional counter updates (WHERE count < cap RETURNING) only when capped.
      let remainingCandidates = await hydrateFreeGiftSegmentsUsing(
        tx,
        segmentRows.map(mapSegmentRow),
      );
      let finalChosen: SpinWheelSegment | null = null;
      let finalCouponId: string | null = null;
      let finalCouponCode: string | null = null;
      let finalCouponExpiresAt: Date | null = null;

      while (remainingCandidates.length > 0) {
        const draw = drawWeightedSegment(remainingCandidates, options.rollFn);
        if (!draw) break;

        const chosen = draw.segment;
        const needsTotalCap = chosen.totalCap !== null;
        const needsDailyCap = chosen.dailyCap !== null;
        const needsCappedCounter = needsTotalCap || needsDailyCap;

        if (needsCappedCounter) {
          await tx`savepoint sp_draw_attempt`;
        }

        let couponId: string | null = null;
        let couponCode: string | null = null;
        let couponExpiresAt: Date | null = null;

        if (chosen.segmentType === 'COUPON' || chosen.segmentType === 'FREE_GIFT') {
          const validDays =
            chosen.segmentType === 'FREE_GIFT'
              ? (chosen.giftValidDays ?? chosen.couponValidDays ?? 7)
              : chosen.couponValidDays;
          couponExpiresAt = new Date(dbNow.getTime() + validDays * 86_400_000);
          const createdCoupon = await insertPersonalSpinCouponInTx(tx, {
            segment: chosen,
            userEmail,
            startsAt: dbNow,
            endsAt: couponExpiresAt,
          });
          couponId = createdCoupon.couponId;
          couponCode = createdCoupon.code;
        }

        await tx`
          update spin_wheel_spins
          set
            segment_id = ${chosen.id},
            segment_label = ${chosen.label},
            segment_type = ${chosen.segmentType},
            coupon_id = ${couponId},
            coupon_code = ${couponCode},
            roll_value = ${draw.rollValue},
            weights_snapshot = ${tx.json(draw.weightsSnapshot as never)}
          where id = ${spinId}
        `;

        if (options.beforeCounterHook) {
          await options.beforeCounterHook({ tx, chosen, spinId });
        }

        let capFailed = false;
        if (needsTotalCap && needsDailyCap) {
          const [counterRow] = (await tx`
            with seg_inc as (
              update spin_wheel_segments
              set total_awarded = total_awarded + 1, updated_at = ${dbNow}
              where id = ${chosen.id}
                and is_active = true
                and (total_cap is null or total_awarded < total_cap)
              returning id, daily_cap
            ),
            day_inc as (
              insert into spin_wheel_segment_daily_counts (segment_id, store_day, awarded_count)
              select id, ${dayInfo.storeDay}::date, 1
              from seg_inc
              on conflict (segment_id, store_day) do update
              set awarded_count = spin_wheel_segment_daily_counts.awarded_count + 1
              where (
                (select daily_cap from seg_inc) is null
                or spin_wheel_segment_daily_counts.awarded_count < (select daily_cap from seg_inc)
              )
              returning segment_id
            )
            select
              (select count(*)::int from seg_inc) as seg_ok,
              (select count(*)::int from day_inc) as day_ok
          `) as Array<{ seg_ok: number; day_ok: number }>;

          capFailed = Number(counterRow?.seg_ok ?? 0) !== 1 || Number(counterRow?.day_ok ?? 0) !== 1;
        } else if (needsTotalCap) {
          const updated = (await tx`
            update spin_wheel_segments
            set total_awarded = total_awarded + 1, updated_at = ${dbNow}
            where id = ${chosen.id}
              and is_active = true
              and total_cap is not null
              and total_awarded < total_cap
            returning id
          `) as Array<{ id: string }>;

          capFailed = updated.length !== 1;
        } else if (needsDailyCap) {
          const updatedDaily = (await tx`
            insert into spin_wheel_segment_daily_counts (segment_id, store_day, awarded_count)
            values (${chosen.id}, ${dayInfo.storeDay}::date, 1)
            on conflict (segment_id, store_day) do update
            set awarded_count = spin_wheel_segment_daily_counts.awarded_count + 1
            where spin_wheel_segment_daily_counts.awarded_count < ${chosen.dailyCap!}
            returning segment_id
          `) as Array<{ segment_id: string }>;

          capFailed = updatedDaily.length !== 1;
        }

        if (capFailed) {
          await tx`rollback to savepoint sp_draw_attempt`;
          const uncappedNoPrize = remainingCandidates.find(
            (seg) =>
              seg.isActive
              && seg.segmentType === 'NO_PRIZE'
              && seg.dailyCap === null
              && seg.totalCap === null,
          );
          if (uncappedNoPrize) {
            await tx`
              update spin_wheel_spins
              set
                segment_id = ${uncappedNoPrize.id},
                segment_label = ${uncappedNoPrize.label},
                segment_type = ${uncappedNoPrize.segmentType},
                coupon_id = ${null},
                coupon_code = ${null},
                roll_value = ${draw.rollValue},
                weights_snapshot = ${tx.json(draw.weightsSnapshot as never)}
              where id = ${spinId}
            `;
            finalChosen = uncappedNoPrize;
            finalCouponId = null;
            finalCouponCode = null;
            finalCouponExpiresAt = null;
            break;
          }
          remainingCandidates = remainingCandidates.filter((seg) => seg.id !== chosen.id);
          continue;
        }

        finalChosen = chosen;
        finalCouponId = couponId;
        finalCouponCode = couponCode;
        finalCouponExpiresAt = couponExpiresAt;
        break;
      }

      if (!finalChosen) {
        throw new SpinAbortError(
          'exhausted',
          'All Spin and Win rewards have been claimed for now. Please check back later.',
        );
      }

      const isWinningReward =
        finalChosen.segmentType === 'COUPON' || finalChosen.segmentType === 'FREE_GIFT';

      const spinView: CustomerSpinResultView = {
        spinId,
        storeDay: dayInfo.storeDay,
        segmentId: finalChosen.id,
        segmentLabel: finalChosen.label,
        segmentType: finalChosen.segmentType,
        couponCode: finalCouponCode,
        couponSummary: isWinningReward ? formatPrizeSummary(finalChosen) : null,
        couponExpiresAt: finalCouponExpiresAt ? finalCouponExpiresAt.toISOString() : null,
        giftProductId: finalChosen.segmentType === 'FREE_GIFT' ? (finalChosen.giftProductId ?? null) : null,
        giftProductName: finalChosen.segmentType === 'FREE_GIFT' ? (finalChosen.giftProductName ?? null) : null,
        createdAt: dbNow.toISOString(),
      };

      const postCooldownInput = isWinningReward
        ? spinResultToCooldownInput(spinView)
        : latestWin;
      const postSpinCooldown = computeSpinCooldownState({
        dbNow,
        nextDailyResetAt: dayInfo.nextResetAt,
        latestCouponWin: postCooldownInput,
        rewardCooldownMode: settings.rewardCooldownMode,
        rewardCooldownDays: settings.rewardCooldownDays,
      });

      void finalCouponId;
      return {
        alreadySpun: false as const,
        spin: spinView,
        nextSpinAt: postSpinCooldown.nextSpinAt.toISOString(),
        secondsUntilReset: postSpinCooldown.secondsUntilReset,
        userEmail,
        customerName: userFirstName,
        wonCoupon: isWinningReward && Boolean(finalCouponCode),
        couponExpiresAt: spinView.couponExpiresAt,
        timeZone,
      };
    });

    if (committed.wonCoupon && committed.spin.couponCode) {
      const expiryFormatted = committed.couponExpiresAt
        ? new Date(committed.couponExpiresAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: committed.timeZone,
          })
        : 'Soon';
      try {
        await enqueueNotification(
          'spin_win',
          { type: 'spin', id: committed.spin.spinId },
          {
            customerUserId: input.userId,
            customerEmail: committed.userEmail,
            customerName: committed.customerName,
            couponCode: committed.spin.couponCode,
            prizeName:
              committed.spin.segmentType === 'FREE_GIFT' && committed.spin.giftProductName
                ? `${committed.spin.segmentLabel} (${committed.spin.giftProductName})`
                : committed.spin.segmentLabel,
            couponExpiry: expiryFormatted,
            customerLink: '/account/coupons',
            staffLink: '/store-admin/marketing/spin-wheel',
          },
          sql,
        );
      } catch {
        // Notification failure must never roll back or fail a won spin.
      }
    }

    return {
      ok: true,
      alreadySpun: committed.alreadySpun,
      spin: committed.spin,
      nextSpinAt: committed.nextSpinAt,
      secondsUntilReset: committed.secondsUntilReset,
    };
  } catch (error) {
    if (error instanceof SpinAbortError) {
      return {
        ok: false,
        reason: error.reason,
        error: error.message,
        retryAfterSec: error.retryAfterSec,
        nextSpinAt: error.nextSpinAt,
      };
    }
    if (isTransactionTimeout(error)) {
      return {
        ok: false,
        reason: 'busy',
        error: BUSY_MESSAGE,
        retryAfterSec: Number(BUSY_RETRY_AFTER),
      };
    }
    console.warn('[spin-wheel] draw failed');
    return {
      ok: false,
      reason: 'unavailable',
      error: 'Spin and Win is temporarily unavailable. Please try again.',
    };
  }
}

export async function executeSpinDraw(input: {
  userId: string;
  ipHash: string;
  termsAccepted: boolean;
}): Promise<SpinDrawResponse> {
  const sql = getSql();
  if (!sql) {
    return {
      ok: false,
      reason: 'unavailable',
      error: 'Spin and Win is temporarily unavailable.',
    };
  }
  return executeSpinDrawUsing(sql, input);
}

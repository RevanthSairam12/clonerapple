/**
 * Server-side Spin and Win configuration loader, customer state reader,
 * and atomic draw + coupon creation transaction.
 *
 * Security & concurrency invariants:
 * - Never runs in the browser.
 * - Configuration reads use a short (5s) per-pool TTL cache to protect the small
 *   transaction pooler; the draw itself always checks live caps under row locks.
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
  isTransactionTimeout,
  setTransactionTimeouts,
} from '@/lib/checkout/transaction-guards';
import { generateCouponCode } from '@/lib/coupons/codes';
import { normalizeEmail } from '@/lib/coupons/rules';
import { enqueueNotification } from '@/lib/notifications/enqueue';
import { getSql } from '@/lib/platform/db';

import {
  computeStoreDayInfo,
  contrastTextForHex,
  DEFAULT_SPIN_WHEEL_SETTINGS,
  DEFAULT_TIMEZONE,
  drawWeightedSegment,
  formatPrizeSummary,
  isWheelWindowOpen,
  type SpinCouponScope,
  type SpinCouponType,
  type SpinSegmentType,
  type SpinWheelSegment,
  type SpinWheelSettings,
} from './rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Spin wheel store must run on the server only.');
}

type SqlLike = postgres.Sql | postgres.TransactionSql;
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
  createdAt: string;
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
  timeZone: string;
  storeDay: string;
  nextSpinAt: string;
  secondsUntilReset: number;
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
        | 'exhausted'
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

export function invalidateSpinWheelCache(sql?: postgres.Sql | null): void {
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
  };
}

export function mapSegmentRow(row: Row): SpinWheelSegment {
  const colorHex = text(row.color_hex) || '#ffe100';
  return {
    id: text(row.id),
    label: text(row.label),
    colorHex,
    textColorHex: contrastTextForHex(colorHex),
    segmentType: text(row.segment_type) === 'COUPON' ? 'COUPON' : 'NO_PRIZE',
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
  };
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

  const [timeZone, settingsRows, segmentRows] = await Promise.all([
    readValidatedTimeZone(sql),
    sql`select * from spin_wheel_settings where id = 'default' limit 1` as Promise<Row[]>,
    sql`
      select *, 0 as daily_awarded
      from spin_wheel_segments
      order by sort_order asc, id asc
    ` as Promise<Row[]>,
  ]);

  const value: SpinWheelConfigSnapshot = {
    settings: mapSettingsRow(settingsRows[0]),
    segments: segmentRows.map(mapSegmentRow),
    timeZone,
  };

  if (!options.bypassCache) {
    configCacheBySql.set(key, {
      expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      value,
    });
  }
  return value;
}

function couponSummaryFromJoinedRow(row: Row): string | null {
  if (!row.coupon_code || !row.c_type) return null;
  const type = text(row.c_type) as SpinCouponType;
  const val = Number(row.c_value) || 0;
  if (type === 'FREE_SHIPPING') return 'Free shipping';
  if (type === 'PERCENT') return `${val}% off`;
  return `₹${(val / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} off`;
}

function mapSpinResultRow(row: Row): CustomerSpinResultView {
  const storeDayRaw = row.store_day instanceof Date
    ? row.store_day.toISOString().slice(0, 10)
    : text(row.store_day).slice(0, 10);
  return {
    spinId: text(row.id),
    storeDay: storeDayRaw,
    segmentId: row.segment_id ? text(row.segment_id) : null,
    segmentLabel: text(row.segment_label),
    segmentType: text(row.segment_type) === 'COUPON' ? 'COUPON' : 'NO_PRIZE',
    couponCode: row.coupon_code ? text(row.coupon_code) : null,
    couponSummary: couponSummaryFromJoinedRow(row),
    couponExpiresAt: iso(row.c_ends_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
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
      c.type as c_type, c.value as c_value, c.ends_at as c_ends_at
    from spin_wheel_spins sp
    left join coupons c on c.id = sp.coupon_id
    where sp.user_id = ${userId} and sp.store_day = ${storeDay}::date
    limit 1
  `) as Row[];
  return rows[0] ? mapSpinResultRow(rows[0]) : null;
}

export async function getCustomerSpinStateUsing(
  sql: SqlLike,
  userId: string | null,
  options: { bypassCache?: boolean; nowOverride?: Date } = {},
): Promise<CustomerSpinState> {
  const [config, clockRows] = await Promise.all([
    getSpinWheelConfigUsing(sql, { bypassCache: options.bypassCache }),
    sql`select now() as db_now` as Promise<Array<{ db_now: Date | string }>>,
  ]);

  const dbNow = options.nowOverride ?? new Date(clockRows[0]?.db_now ?? new Date());
  const dayInfo = computeStoreDayInfo(dbNow, config.timeZone);
  const windowState = isWheelWindowOpen(config.settings, dbNow);

  const todaySpin = userId
    ? await readExistingSpinForDay(sql, userId, dayInfo.storeDay)
    : null;

  const activeSegments: PublicSpinSegment[] = config.segments
    .filter((seg) => seg.isActive)
    .map((seg) => ({
      id: seg.id,
      label: seg.label,
      colorHex: seg.colorHex,
      textColorHex: seg.textColorHex,
      sortOrder: seg.sortOrder,
    }));

  return {
    available: true,
    signedIn: Boolean(userId),
    isOpen: windowState.open,
    windowReason: windowState.reason,
    title: config.settings.title,
    subtitle: config.settings.subtitle,
    termsText: config.settings.termsText,
    showOnHomePage: config.settings.showOnHomePage,
    timeZone: config.timeZone,
    storeDay: dayInfo.storeDay,
    nextSpinAt: dayInfo.nextResetAt.toISOString(),
    secondsUntilReset: dayInfo.secondsUntilReset,
    segments: activeSegments,
    todaySpin,
  };
}

export async function getCustomerSpinState(userId: string | null): Promise<CustomerSpinState> {
  const sql = getSql();
  if (!sql) {
    const dayInfo = computeStoreDayInfo(new Date(), DEFAULT_TIMEZONE);
    return {
      available: false,
      signedIn: Boolean(userId),
      isOpen: false,
      windowReason: 'disabled',
      title: DEFAULT_SPIN_WHEEL_SETTINGS.title,
      subtitle: DEFAULT_SPIN_WHEEL_SETTINGS.subtitle,
      termsText: '',
      showOnHomePage: false,
      timeZone: DEFAULT_TIMEZONE,
      storeDay: dayInfo.storeDay,
      nextSpinAt: dayInfo.nextResetAt.toISOString(),
      secondsUntilReset: dayInfo.secondsUntilReset,
      segments: [],
      todaySpin: null,
    };
  }
  return getCustomerSpinStateUsing(sql, userId);
}

/** Lightweight read for home page entry strip without loading full spin history. */
export async function getHomeSpinBannerState(): Promise<{
  show: boolean;
  title: string;
  subtitle: string;
}> {
  const sql = getSql();
  if (!sql) return { show: false, title: '', subtitle: '' };
  try {
    const [config, clockRows] = await Promise.all([
      getSpinWheelConfigUsing(sql),
      sql`select now() as db_now` as Promise<Array<{ db_now: Date | string }>>,
    ]);
    const dbNow = new Date(clockRows[0]?.db_now ?? new Date());
    const windowState = isWheelWindowOpen(config.settings, dbNow);
    const hasActiveSegments = config.segments.some((s) => s.isActive);
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
  const summary = formatPrizeSummary(segment);
  const couponName = `Spin & Win: ${segment.label}`.slice(0, 100);
  const description = `Personal Spin and Win reward (${summary})`.slice(0, 300);

  let code = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateCouponCode('SPIN', 8);
    await tx`savepoint sp_spin_coupon`;
    try {
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
          ${segment.couponType},
          ${segment.couponValue},
          ${segment.couponScope},
          'active',
          ${startsAt},
          ${endsAt},
          1,
          1,
          ${segment.couponMinOrderPaise},
          ${segment.couponMaxDiscountPaise},
          false,
          ${segment.couponAllowWithSalePrice},
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

  if (segment.couponScope === 'PRODUCTS') {
    for (const productId of segment.couponTargetIds) {
      await tx`
        insert into coupon_targets (coupon_id, product_id)
        values (${couponId}, ${productId})
        on conflict do nothing
      `;
    }
  } else if (segment.couponScope === 'CATEGORIES') {
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

  try {
    const committed = await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);

      const timeZone = await readValidatedTimeZone(tx);
      const [clockRow] = (await tx`select now() as db_now`) as Array<{ db_now: Date | string }>;
      const dbNow = options.nowOverride ?? new Date(clockRow?.db_now ?? new Date());
      const dayInfo = computeStoreDayInfo(dbNow, timeZone);

      const userRows = (await tx`
        select id, email, first_name, created_at
        from users
        where id = ${input.userId}
        limit 1
      `) as Array<{ id: string; email: string; first_name: string | null; created_at: Date | string }>;
      const user = userRows[0];
      if (!user) {
        throw new SpinAbortError('unauthorized', 'Please sign in to spin the wheel.');
      }

      // Fast path if today's spin already exists for this customer.
      const existingBefore = await readExistingSpinForDay(tx, input.userId, dayInfo.storeDay);
      if (existingBefore) {
        return {
          alreadySpun: true as const,
          spin: existingBefore,
          nextSpinAt: dayInfo.nextResetAt.toISOString(),
          secondsUntilReset: dayInfo.secondsUntilReset,
          userEmail: user.email,
          customerName: user.first_name ?? '',
          wonCoupon: false,
          couponExpiresAt: existingBefore.couponExpiresAt,
          timeZone,
        };
      }

      const settingsRows = (await tx`
        select * from spin_wheel_settings where id = 'default' limit 1
      `) as Row[];
      const settings = mapSettingsRow(settingsRows[0]);

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
        const createdAt = new Date(user.created_at);
        const ageMinutes = (dbNow.getTime() - createdAt.getTime()) / 60_000;
        if (ageMinutes < settings.minAccountAgeMinutes) {
          throw new SpinAbortError(
            'account_too_new',
            'Your account is not eligible to spin yet. Please try again later.',
          );
        }
      }

      // Insert-first on (user_id, store_day). Concurrent requests block on the
      // unique index until the first commits, then receive 0 rows and read the
      // committed winner row.
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
        return {
          alreadySpun: true as const,
          spin: existingConcurrent,
          nextSpinAt: dayInfo.nextResetAt.toISOString(),
          secondsUntilReset: dayInfo.secondsUntilReset,
          userEmail: user.email,
          customerName: user.first_name ?? '',
          wonCoupon: false,
          couponExpiresAt: existingConcurrent.couponExpiresAt,
          timeZone,
        };
      }

      if (input.ipHash) {
        const [ipRow] = (await tx`
          select count(*)::int as cnt
          from spin_wheel_spins
          where store_day = ${dayInfo.storeDay}::date
            and ip_hash = ${input.ipHash}
            and id <> ${spinId}
        `) as Array<{ cnt: number }>;
        if (Number(ipRow?.cnt ?? 0) >= settings.maxSpinsPerIpPerDay) {
          throw new SpinAbortError(
            'ip_limit',
            'Daily spin limit reached for this network. Please try again tomorrow.',
            {
              retryAfterSec: dayInfo.secondsUntilReset,
              nextSpinAt: dayInfo.nextResetAt.toISOString(),
            },
          );
        }
      }

      // Lock active segment rows in deterministic order to enforce caps atomically.
      const lockedRows = (await tx`
        select s.*, coalesce(dc.awarded_count, 0)::int as daily_awarded
        from spin_wheel_segments s
        left join spin_wheel_segment_daily_counts dc
          on dc.segment_id = s.id and dc.store_day = ${dayInfo.storeDay}::date
        where s.is_active = true
        order by s.sort_order asc, s.id asc
        for update of s
      `) as Row[];

      const candidates = lockedRows.map(mapSegmentRow);
      const draw = drawWeightedSegment(candidates, options.rollFn);
      if (!draw) {
        throw new SpinAbortError(
          'exhausted',
          'All Spin and Win rewards have been claimed for now. Please check back later.',
        );
      }

      const chosen = draw.segment;
      let couponId: string | null = null;
      let couponCode: string | null = null;
      let couponExpiresAt: Date | null = null;

      await tx`
        update spin_wheel_segments
        set total_awarded = total_awarded + 1, updated_at = ${dbNow}
        where id = ${chosen.id}
      `;
      await tx`
        insert into spin_wheel_segment_daily_counts (segment_id, store_day, awarded_count)
        values (${chosen.id}, ${dayInfo.storeDay}::date, 1)
        on conflict (segment_id, store_day)
        do update set awarded_count = spin_wheel_segment_daily_counts.awarded_count + 1
      `;

      if (chosen.segmentType === 'COUPON') {
        couponExpiresAt = new Date(dbNow.getTime() + chosen.couponValidDays * 86_400_000);
        const createdCoupon = await insertPersonalSpinCouponInTx(tx, {
          segment: chosen,
          userEmail: user.email,
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

      const spinView: CustomerSpinResultView = {
        spinId,
        storeDay: dayInfo.storeDay,
        segmentId: chosen.id,
        segmentLabel: chosen.label,
        segmentType: chosen.segmentType,
        couponCode,
        couponSummary: chosen.segmentType === 'COUPON' ? formatPrizeSummary(chosen) : null,
        couponExpiresAt: couponExpiresAt ? couponExpiresAt.toISOString() : null,
        createdAt: dbNow.toISOString(),
      };

      return {
        alreadySpun: false as const,
        spin: spinView,
        nextSpinAt: dayInfo.nextResetAt.toISOString(),
        secondsUntilReset: dayInfo.secondsUntilReset,
        userEmail: user.email,
        customerName: user.first_name ?? '',
        wonCoupon: chosen.segmentType === 'COUPON' && Boolean(couponCode),
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
            prizeName: committed.spin.segmentLabel,
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

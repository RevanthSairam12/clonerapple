/**
 * Store Admin service for Spin and Win configuration, test spin, reports,
 * and CSV export.
 *
 * All mutations run in a single short transaction, preserve past wins/coupons,
 * write an audit row without personal data, and invalidate the short config
 * cache on commit.
 */

import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { setTransactionTimeouts } from '@/lib/checkout/transaction-guards';
import { getSql } from '@/lib/platform/db';
import {
  collectSpinWheelWarnings,
  computeSegmentOdds,
  computeStoreDayInfo,
  DEFAULT_TIMEZONE,
  drawWeightedSegment,
  formatPrizeSummary,
  validateSpinWheelConfigInput,
  type SpinWheelSegment,
  type SpinWheelSettings,
  type SpinWheelWarning,
} from '@/lib/spin-wheel/rules';
import {
  invalidateSpinWheelCache,
  mapSegmentRow,
  mapSettingsRow,
} from '@/lib/spin-wheel/store';

import { maskEmail, writeAudit, type AuditInput } from './audit';
import { toCsv } from './catalog-csv';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin spin wheel operations must run on the server only.');
}

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

export interface SpinAdminActor {
  actorId: string | null;
  actorEmail?: string | null;
  request?: Request | null;
}

export interface SpinAdminServiceOptions {
  sql?: postgres.Sql;
  audit?: typeof writeAudit;
}

export interface SpinDailyReportRow {
  storeDay: string;
  spins: number;
  wins: number;
  noPrize: number;
}

export interface SpinSegmentWinRow {
  id: string;
  label: string;
  segmentType: 'COUPON' | 'NO_PRIZE';
  totalAwarded: number;
  dailyAwarded: number;
  dailyCap: number | null;
  totalCap: number | null;
  oddsPercent: number;
}

export interface SpinCouponReportSummary {
  won: number;
  redeemed: number;
  expired: number;
  activeUnused: number;
  ordersCount: number;
  revenuePaise: number;
  totalDiscountPaise: number;
}

export interface SpinRecentLogRow {
  id: string;
  storeDay: string;
  createdAtWall: string;
  customerMasked: string;
  segmentLabel: string;
  segmentType: 'COUPON' | 'NO_PRIZE';
  couponCode: string | null;
  couponStatus: string | null;
}

export interface SpinPickerOption {
  id: string;
  name: string;
}

export interface SpinAdminDashboardData {
  settings: SpinWheelSettings;
  segments: SpinWheelSegment[];
  timeZone: string;
  todayStoreDay: string;
  warnings: SpinWheelWarning[];
  oddsBySegmentId: Record<string, number>;
  reports: {
    spinsPerDay: SpinDailyReportRow[];
    winsBySegment: SpinSegmentWinRow[];
    coupons: SpinCouponReportSummary;
    recentSpins: SpinRecentLogRow[];
  };
  products: SpinPickerOption[];
  categories: SpinPickerOption[];
}

export interface SpinTestResult {
  segmentId: string;
  label: string;
  colorHex: string;
  textColorHex: string;
  segmentType: 'COUPON' | 'NO_PRIZE';
  summary: string;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function safeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

async function auditSpin(
  tx: Tx,
  actor: SpinAdminActor,
  input: Omit<AuditInput, 'actorId' | 'actorEmail' | 'request'>,
  options: SpinAdminServiceOptions,
): Promise<void> {
  if (!(await (options.audit ?? writeAudit)({ ...input, ...actor }, tx))) {
    throw new Error('Spin wheel audit failed.');
  }
}

async function readTimeZone(sql: postgres.ISql): Promise<string> {
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

function auditSnapshot(settings: SpinWheelSettings, segments: readonly SpinWheelSegment[]) {
  return {
    enabled: settings.enabled,
    title: settings.title,
    startsAt: settings.startsAt,
    endsAt: settings.endsAt,
    spinsPerCustomerPerDay: settings.spinsPerCustomerPerDay,
    maxSpinsPerIpPerDay: settings.maxSpinsPerIpPerDay,
    minAccountAgeMinutes: settings.minAccountAgeMinutes,
    showOnHomePage: settings.showOnHomePage,
    popupEnabled: settings.popupEnabled,
    popupDelaySeconds: settings.popupDelaySeconds,
    popupRequireScroll: settings.popupRequireScroll,
    popupMobileFloatingButton: settings.popupMobileFloatingButton,
    rewardCooldownMode: settings.rewardCooldownMode,
    rewardCooldownDays: settings.rewardCooldownDays,
    showNextSpinCountdown: settings.showNextSpinCountdown,
    hasTerms: settings.termsText.trim().length > 0,
    segments: segments.map((s) => ({
      id: s.id,
      label: s.label,
      type: s.segmentType,
      weight: s.weight,
      dailyCap: s.dailyCap,
      totalCap: s.totalCap,
      isActive: s.isActive,
      couponType: s.couponType,
      couponValue: s.couponValue,
      couponValidDays: s.couponValidDays,
    })),
  };
}

export async function getSpinWheelAdminDataUsing(
  sql: postgres.ISql,
): Promise<{ ok: true; data: SpinAdminDashboardData } | { ok: false; reason: 'unavailable' }> {
  try {
    const [timeZone, clockRows] = await Promise.all([
      readTimeZone(sql),
      sql`select now() as db_now` as Promise<Array<{ db_now: Date | string }>>,
    ]);
    const dbNow = new Date(clockRows[0]?.db_now ?? new Date());
    const todayStoreDay = computeStoreDayInfo(dbNow, timeZone).storeDay;

    const [
      settingsRows,
      segmentRows,
      dailyRows,
      couponAggRows,
      orderAggRows,
      recentRows,
      productRows,
      categoryRows,
    ] = await Promise.all([
      sql`select * from spin_wheel_settings where id = 'default' limit 1` as Promise<Row[]>,
      sql`
        select
          s.*,
          greatest(s.total_awarded, coalesce(sp_all.cnt, 0))::int as total_awarded,
          greatest(coalesce(dc.awarded_count, 0), coalesce(sp_day.cnt, 0))::int as daily_awarded
        from spin_wheel_segments s
        left join spin_wheel_segment_daily_counts dc
          on dc.segment_id = s.id and dc.store_day = ${todayStoreDay}::date
        left join (
          select segment_id, count(*)::int as cnt
          from spin_wheel_spins
          where segment_id is not null
          group by segment_id
        ) sp_all on sp_all.segment_id = s.id
        left join (
          select segment_id, count(*)::int as cnt
          from spin_wheel_spins
          where segment_id is not null and store_day = ${todayStoreDay}::date
          group by segment_id
        ) sp_day on sp_day.segment_id = s.id
        order by s.sort_order asc, s.id asc
      ` as Promise<Row[]>,
      sql`
        select
          store_day::text as store_day,
          count(*)::int as spins,
          count(*) filter (where segment_type = 'COUPON')::int as wins,
          count(*) filter (where segment_type = 'NO_PRIZE')::int as no_prize
        from spin_wheel_spins
        where store_day >= (${todayStoreDay}::date - interval '29 days')::date
        group by store_day
        order by store_day desc
      ` as Promise<Row[]>,
      sql`
        select
          count(distinct sp.coupon_id)::int as won,
          count(distinct sp.coupon_id) filter (
            where exists (
              select 1 from coupon_redemptions cr
              where cr.coupon_id = sp.coupon_id and cr.state = 'CONSUMED'
            )
          )::int as redeemed,
          count(distinct sp.coupon_id) filter (
            where c.ends_at is not null and c.ends_at <= ${dbNow}
              and not exists (
                select 1 from coupon_redemptions cr
                where cr.coupon_id = sp.coupon_id and cr.state = 'CONSUMED'
              )
          )::int as expired
        from spin_wheel_spins sp
        join coupons c on c.id = sp.coupon_id
        where sp.coupon_id is not null
      ` as Promise<Row[]>,
      sql`
        select
          count(distinct o.id)::int as orders_count,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue_paise,
          coalesce(sum(o.discount_paise), 0)::bigint as discount_paise
        from orders o
        join spin_wheel_spins sp on sp.coupon_id = o.coupon_id
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
      ` as Promise<Row[]>,
      sql`
        select
          sp.id,
          sp.store_day::text as store_day,
          to_char(sp.created_at at time zone ${timeZone}::text, 'YYYY-MM-DD HH24:MI:SS') as created_wall,
          u.email as customer_email,
          sp.segment_label,
          sp.segment_type,
          sp.coupon_code,
          case
            when sp.coupon_id is null then null
            when exists (
              select 1 from coupon_redemptions cr
              where cr.coupon_id = sp.coupon_id and cr.state = 'CONSUMED'
            ) then 'Redeemed'
            when c.ends_at is not null and c.ends_at <= ${dbNow} then 'Expired'
            when c.status = 'active' then 'Active'
            else initcap(c.status)
          end as coupon_status
        from spin_wheel_spins sp
        left join users u on u.id = sp.user_id
        left join coupons c on c.id = sp.coupon_id
        order by sp.created_at desc
        limit 100
      ` as Promise<Row[]>,
      sql`
        select id, name
        from products
        where deleted_at is null and is_active = true
        order by sort_order asc, name asc
        limit 250
      ` as Promise<Row[]>,
      sql`
        select id, name
        from categories
        where deleted_at is null and is_active = true
        order by sort_order asc, name asc
        limit 100
      ` as Promise<Row[]>,
    ]);

    const settings = mapSettingsRow(settingsRows[0]);
    const segments = segmentRows.map(mapSegmentRow);
    const oddsMap = computeSegmentOdds(segments);
    const oddsBySegmentId: Record<string, number> = {};
    for (const [k, v] of oddsMap.entries()) oddsBySegmentId[k] = v;

    const cAgg = couponAggRows[0] ?? {};
    const oAgg = orderAggRows[0] ?? {};
    const won = Number(cAgg.won ?? 0);
    const redeemed = Number(cAgg.redeemed ?? 0);
    const expired = Number(cAgg.expired ?? 0);

    return {
      ok: true,
      data: {
        settings,
        segments,
        timeZone,
        todayStoreDay,
        warnings: collectSpinWheelWarnings(settings, segments),
        oddsBySegmentId,
        reports: {
          spinsPerDay: dailyRows.map((row) => ({
            storeDay: text(row.store_day).slice(0, 10),
            spins: Number(row.spins ?? 0),
            wins: Number(row.wins ?? 0),
            noPrize: Number(row.no_prize ?? 0),
          })),
          winsBySegment: segments.map((seg) => ({
            id: seg.id,
            label: seg.label,
            segmentType: seg.segmentType,
            totalAwarded: seg.totalAwarded,
            dailyAwarded: seg.dailyAwarded,
            dailyCap: seg.dailyCap,
            totalCap: seg.totalCap,
            oddsPercent: oddsBySegmentId[seg.id] ?? 0,
          })),
          coupons: {
            won,
            redeemed,
            expired,
            activeUnused: Math.max(0, won - redeemed - expired),
            ordersCount: Number(oAgg.orders_count ?? 0),
            revenuePaise: Number(oAgg.revenue_paise ?? 0),
            totalDiscountPaise: Number(oAgg.discount_paise ?? 0),
          },
          recentSpins: recentRows.map((row) => ({
            id: text(row.id),
            storeDay: text(row.store_day).slice(0, 10),
            createdAtWall: text(row.created_wall),
            customerMasked: row.customer_email ? maskEmail(text(row.customer_email)) : '[deleted user]',
            segmentLabel: text(row.segment_label),
            segmentType: text(row.segment_type) === 'COUPON' ? 'COUPON' : 'NO_PRIZE',
            couponCode: row.coupon_code ? text(row.coupon_code) : null,
            couponStatus: row.coupon_status ? text(row.coupon_status) : null,
          })),
        },
        products: productRows.map((r) => ({ id: text(r.id), name: text(r.name) })),
        categories: categoryRows.map((r) => ({ id: text(r.id), name: text(r.name) })),
      },
    };
  } catch {
    console.warn('[store-admin/spin-wheel] failed to load spin wheel admin data');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getSpinWheelAdminData() {
  const sql = getSql();
  if (!sql) return { ok: false as const, reason: 'unavailable' as const };
  return getSpinWheelAdminDataUsing(sql);
}

export async function saveSpinWheelConfigUsing(
  sql: postgres.Sql,
  input: unknown,
  actor: SpinAdminActor,
  options: SpinAdminServiceOptions = {},
): Promise<
  | { ok: true; data: SpinAdminDashboardData }
  | { ok: false; reason: 'invalid-input' | 'unavailable'; error: string }
> {
  const validated = validateSpinWheelConfigInput(input);
  if (!validated.ok) {
    return { ok: false, reason: 'invalid-input', error: validated.error };
  }

  const { settings: nextSettings, segments: nextSegments } = validated.value;

  try {
    await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      const timeZone = await readTimeZone(tx);

      const [beforeSettingsRow] = (await tx`
        select * from spin_wheel_settings where id = 'default' for update
      `) as Row[];
      const beforeSegmentRows = (await tx`
        select *, 0 as daily_awarded from spin_wheel_segments order by sort_order asc, id asc for update
      `) as Row[];

      const beforeSettings = mapSettingsRow(beforeSettingsRow);
      const beforeSegments = beforeSegmentRows.map(mapSegmentRow);
      const existingIds = new Set(beforeSegments.map((s) => s.id));

      await tx`
        insert into spin_wheel_settings (
          id, enabled, title, subtitle, starts_at, ends_at,
          spins_per_customer_per_day, terms_text, max_spins_per_ip_per_day,
          min_account_age_minutes, show_on_home_page,
          popup_enabled, popup_delay_seconds, popup_require_scroll, popup_mobile_floating_button,
          reward_cooldown_mode, reward_cooldown_days, show_next_spin_countdown,
          updated_at, updated_by
        ) values (
          'default',
          ${nextSettings.enabled},
          ${nextSettings.title},
          ${nextSettings.subtitle},
          ${nextSettings.startsAtLocal ? tx`(${nextSettings.startsAtLocal}::text)::timestamp at time zone ${timeZone}::text` : null},
          ${nextSettings.endsAtLocal ? tx`(${nextSettings.endsAtLocal}::text)::timestamp at time zone ${timeZone}::text` : null},
          ${nextSettings.spinsPerCustomerPerDay},
          ${nextSettings.termsText},
          ${nextSettings.maxSpinsPerIpPerDay},
          ${nextSettings.minAccountAgeMinutes},
          ${nextSettings.showOnHomePage},
          ${nextSettings.popupEnabled},
          ${nextSettings.popupDelaySeconds},
          ${nextSettings.popupRequireScroll},
          ${nextSettings.popupMobileFloatingButton},
          ${nextSettings.rewardCooldownMode},
          ${nextSettings.rewardCooldownDays},
          ${nextSettings.showNextSpinCountdown},
          now(),
          ${actor.actorId}
        )
        on conflict (id) do update set
          enabled = excluded.enabled,
          title = excluded.title,
          subtitle = excluded.subtitle,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          spins_per_customer_per_day = excluded.spins_per_customer_per_day,
          terms_text = excluded.terms_text,
          max_spins_per_ip_per_day = excluded.max_spins_per_ip_per_day,
          min_account_age_minutes = excluded.min_account_age_minutes,
          show_on_home_page = excluded.show_on_home_page,
          popup_enabled = excluded.popup_enabled,
          popup_delay_seconds = excluded.popup_delay_seconds,
          popup_require_scroll = excluded.popup_require_scroll,
          popup_mobile_floating_button = excluded.popup_mobile_floating_button,
          reward_cooldown_mode = excluded.reward_cooldown_mode,
          reward_cooldown_days = excluded.reward_cooldown_days,
          show_next_spin_countdown = excluded.show_next_spin_countdown,
          updated_at = now(),
          updated_by = excluded.updated_by
      `;

      const [clockRow] = (await tx`select now() as db_now`) as Array<{ db_now: Date | string }>;
      const todayStoreDay = computeStoreDayInfo(
        new Date(clockRow?.db_now ?? new Date()),
        timeZone,
      ).storeDay;

      const retainedIds: string[] = [];
      for (const seg of nextSegments) {
        const isExisting = !seg.id.startsWith('seg_new_') && existingIds.has(seg.id);
        const finalId = isExisting ? seg.id : `seg_${randomBytes(6).toString('hex')}`;
        retainedIds.push(finalId);

        if (isExisting) {
          await tx`
            update spin_wheel_segments set
              label = ${seg.label},
              color_hex = ${seg.colorHex},
              segment_type = ${seg.segmentType},
              weight = ${seg.weight},
              daily_cap = ${seg.dailyCap},
              total_cap = ${seg.totalCap},
              total_awarded = case
                when ${seg.totalCap !== null}::boolean then greatest(
                  total_awarded,
                  coalesce((select count(*)::int from spin_wheel_spins where segment_id = ${finalId}), 0)
                )
                else total_awarded
              end,
              is_active = ${seg.isActive},
              sort_order = ${seg.sortOrder},
              coupon_type = ${seg.couponType},
              coupon_value = ${seg.couponValue},
              coupon_max_discount_paise = ${seg.couponMaxDiscountPaise},
              coupon_min_order_paise = ${seg.couponMinOrderPaise},
              coupon_scope = ${seg.couponScope},
              coupon_target_ids = ${seg.couponTargetIds},
              coupon_valid_days = ${seg.couponValidDays},
              coupon_allow_with_sale_price = ${seg.couponAllowWithSalePrice},
              updated_at = now()
            where id = ${finalId}
          `;
          if (seg.dailyCap !== null) {
            await tx`
              insert into spin_wheel_segment_daily_counts (segment_id, store_day, awarded_count)
              select
                ${finalId},
                ${todayStoreDay}::date,
                count(*)::int
              from spin_wheel_spins
              where segment_id = ${finalId} and store_day = ${todayStoreDay}::date
              having count(*) > 0
              on conflict (segment_id, store_day) do update set
                awarded_count = greatest(spin_wheel_segment_daily_counts.awarded_count, excluded.awarded_count)
            `;
          }
        } else {
          await tx`
            insert into spin_wheel_segments (
              id, label, color_hex, segment_type, weight, daily_cap, total_cap,
              is_active, sort_order, coupon_type, coupon_value,
              coupon_max_discount_paise, coupon_min_order_paise, coupon_scope,
              coupon_target_ids, coupon_valid_days, coupon_allow_with_sale_price,
              created_at, updated_at
            ) values (
              ${finalId}, ${seg.label}, ${seg.colorHex}, ${seg.segmentType},
              ${seg.weight}, ${seg.dailyCap}, ${seg.totalCap}, ${seg.isActive},
              ${seg.sortOrder}, ${seg.couponType}, ${seg.couponValue},
              ${seg.couponMaxDiscountPaise}, ${seg.couponMinOrderPaise},
              ${seg.couponScope}, ${seg.couponTargetIds}, ${seg.couponValidDays},
              ${seg.couponAllowWithSalePrice}, now(), now()
            )
          `;
        }
      }

      if (retainedIds.length > 0) {
        await tx`
          delete from spin_wheel_segments
          where id <> all(${retainedIds}::text[])
        `;
      }

      const [afterSettingsRow] = (await tx`
        select * from spin_wheel_settings where id = 'default' limit 1
      `) as Row[];
      const afterSegmentRows = (await tx`
        select *, 0 as daily_awarded from spin_wheel_segments order by sort_order asc, id asc
      `) as Row[];

      await auditSpin(
        tx,
        actor,
        {
          action: 'spin_wheel.update',
          entity: 'spin_wheel',
          entityId: 'default',
          before: auditSnapshot(beforeSettings, beforeSegments),
          after: auditSnapshot(
            mapSettingsRow(afterSettingsRow),
            afterSegmentRows.map(mapSegmentRow),
          ),
          reason: 'staff_updated',
        },
        options,
      );
    });

    invalidateSpinWheelCache(sql);

    const refreshed = await getSpinWheelAdminDataUsing(sql);
    if (!refreshed.ok) {
      return {
        ok: false,
        reason: 'unavailable',
        error: 'Configuration saved, but could not reload dashboard.',
      };
    }
    return refreshed;
  } catch {
    console.warn('[store-admin/spin-wheel] failed to save spin wheel configuration');
    return { ok: false, reason: 'unavailable', error: 'Could not save Spin and Win configuration.' };
  }
}

export async function saveSpinWheelConfig(
  input: unknown,
  actor: SpinAdminActor,
  options: SpinAdminServiceOptions = {},
) {
  const sql = options.sql ?? getSql();
  if (!sql) {
    return { ok: false as const, reason: 'unavailable' as const, error: 'Database is unavailable.' };
  }
  return saveSpinWheelConfigUsing(sql, input, actor, options);
}

/**
 * Staff preview draw: runs the exact weighted selection on active segments
 * without writing any spin row, incrementing caps, or creating any coupon.
 */
export async function runStaffTestSpinUsing(
  sql: postgres.ISql,
  rollFn?: (totalWeight: number) => number,
): Promise<{ ok: true; result: SpinTestResult } | { ok: false; error: string }> {
  try {
    const [timeZone, clockRows] = await Promise.all([
      readTimeZone(sql),
      sql`select now() as db_now` as Promise<Array<{ db_now: Date | string }>>,
    ]);
    const dbNow = new Date(clockRows[0]?.db_now ?? new Date());
    const todayStoreDay = computeStoreDayInfo(dbNow, timeZone).storeDay;

    const segmentRows = (await sql`
      select s.*, coalesce(dc.awarded_count, 0)::int as daily_awarded
      from spin_wheel_segments s
      left join spin_wheel_segment_daily_counts dc
        on dc.segment_id = s.id and dc.store_day = ${todayStoreDay}::date
      where s.is_active = true
      order by s.sort_order asc, s.id asc
    `) as Row[];

    const segments = segmentRows.map(mapSegmentRow);
    const draw = drawWeightedSegment(segments, rollFn);
    if (!draw) {
      return {
        ok: false,
        error: 'No eligible active segments are available for a test spin.',
      };
    }

    return {
      ok: true,
      result: {
        segmentId: draw.segment.id,
        label: draw.segment.label,
        colorHex: draw.segment.colorHex,
        textColorHex: draw.segment.textColorHex,
        segmentType: draw.segment.segmentType,
        summary: formatPrizeSummary(draw.segment),
      },
    };
  } catch {
    return { ok: false, error: 'Test spin could not run right now.' };
  }
}

export async function runStaffTestSpin() {
  const sql = getSql();
  if (!sql) return { ok: false as const, error: 'Database is unavailable.' };
  return runStaffTestSpinUsing(sql);
}

export async function exportSpinWheelCsvUsing(
  sql: postgres.Sql,
  actor: SpinAdminActor,
  options: SpinAdminServiceOptions = {},
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  try {
    const [timeZone, clockRows] = await Promise.all([
      readTimeZone(sql),
      sql`select now() as db_now` as Promise<Array<{ db_now: Date | string }>>,
    ]);
    const dbNow = new Date(clockRows[0]?.db_now ?? new Date());
    const todayStoreDay = computeStoreDayInfo(dbNow, timeZone).storeDay;

    const rows = (await sql`
      select
        sp.id,
        sp.store_day::text as store_day,
        to_char(sp.created_at at time zone ${timeZone}::text, 'YYYY-MM-DD HH24:MI:SS') as created_wall,
        u.email as customer_email,
        sp.segment_label,
        sp.segment_type,
        sp.coupon_code,
        case
          when sp.coupon_id is null then ''
          when exists (
            select 1 from coupon_redemptions cr
            where cr.coupon_id = sp.coupon_id and cr.state = 'CONSUMED'
          ) then 'Redeemed'
          when c.ends_at is not null and c.ends_at <= ${dbNow} then 'Expired'
          when c.status = 'active' then 'Active'
          else initcap(c.status)
        end as coupon_status
      from spin_wheel_spins sp
      left join users u on u.id = sp.user_id
      left join coupons c on c.id = sp.coupon_id
      order by sp.created_at desc
      limit 500
    `) as Row[];

    await (options.audit ?? writeAudit)(
      {
        ...actor,
        action: 'spin_wheel.export',
        entity: 'spin_wheel',
        entityId: 'default',
        after: { exportedRows: rows.length },
        reason: 'csv_export',
      },
      sql,
    );

    const csv = toCsv(
      ['Spin ID', 'Store Day', `Time (${timeZone})`, 'Customer', 'Segment', 'Type', 'Coupon Code', 'Coupon Status'],
      rows.map((r) => [
        safeCsvCell(text(r.id)),
        safeCsvCell(text(r.store_day).slice(0, 10)),
        safeCsvCell(text(r.created_wall)),
        safeCsvCell(r.customer_email ? maskEmail(text(r.customer_email)) : '[deleted user]'),
        safeCsvCell(text(r.segment_label)),
        safeCsvCell(text(r.segment_type)),
        safeCsvCell(text(r.coupon_code)),
        safeCsvCell(text(r.coupon_status)),
      ]),
    );

    return { ok: true, csv, filename: `spin-wheel-report-${todayStoreDay}.csv` };
  } catch {
    return { ok: false, error: 'Could not export spin wheel report.' };
  }
}

export async function exportSpinWheelCsv(actor: SpinAdminActor) {
  const sql = getSql();
  if (!sql) return { ok: false as const, error: 'Database is unavailable.' };
  return exportSpinWheelCsvUsing(sql, actor);
}


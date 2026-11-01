import { getSql } from '@/lib/platform/db';

import { countPendingTransactions, isRevenueStatus } from './analytics-rules';
import { maskCustomerEmail } from './masking';
import { maskCustomerName } from './orders';
import { getStoreTimeZone } from './sale';

/**
 * Read-only analytics for the Store Desk overview tabs.
 *
 * Definitions are deliberately explicit so each dashboard figure can be
 * reconciled with the matching order list:
 *
 * - A **captured sale** is an order with `status = 'PAID'` whose fulfilment
 *   was not cancelled. Revenue, order counts, units and top products all use
 *   exactly that predicate. Revenue is the order total as charged
 *   (items − discount + shipping), gross of refunds; refunds on captured
 *   orders are reported next to it, never silently netted.
 * - **Product revenue** (top products, categories) is line revenue after
 *   discount, so it excludes shipping: product revenue + shipping = revenue.
 * - A **transaction** is any order row. The Payments tab counts every order
 *   created in the window by status; fulfilment cancellations are shown as
 *   CANCELLED so unpaid cancellations are not pending and PAID equals captured revenue.
 * - A **comparison period** is the equal-length window immediately before the
 *   selected range. Percent change is null when the previous window is empty,
 *   rather than pretending a jump from zero is a percentage.
 * - **Days** are store-timezone days on the database clock, never UTC days.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin analytics must run on the server only.');
}

export type RangeKey = 'today' | '7d' | '30d' | '90d' | '12m';

export const RANGE_KEYS: readonly RangeKey[] = ['today', '7d', '30d', '90d', '12m'];

const RANGE_DAYS: Record<RangeKey, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
};

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === 'string' && (RANGE_KEYS as readonly string[]).includes(value);
}

export function parseRange(value: unknown): RangeKey {
  return isRangeKey(value) ? value : '30d';
}

export function rangeLabel(range: RangeKey): string {
  return RANGE_LABEL[range];
}

export function rangeDays(range: RangeKey): number {
  return RANGE_DAYS[range];
}

export function rangeBucket(range: RangeKey): 'day' | 'month' {
  return range === '12m' ? 'month' : 'day';
}

export type AnalyticsLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' };

export interface Change {
  current: number;
  previous: number;
  /** Percent change, or null when there is no previous figure to compare. */
  pct: number | null;
}

export interface SalesSeriesPoint {
  label: string;
  revenuePaise: number;
  orders: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  units: number;
  revenuePaise: number;
}

export interface CategorySlice {
  name: string;
  revenuePaise: number;
  units: number;
}

export interface ChannelSlice {
  channel: string;
  orders: number;
  revenuePaise: number;
}

export interface SalesAnalytics {
  revenue: Change;
  orders: Change;
  aov: Change;
  units: number;
  productCount: number;
  /** Captured orders with a refund recorded in the range. */
  refundedOrders: number;
  /** Money refunded in the range on captured orders. */
  refundsPaise: number;
  series: SalesSeriesPoint[];
  topProducts: TopProduct[];
  categories: CategorySlice[];
  channels: ChannelSlice[];
}

export interface TopCustomer {
  name: string;
  emailMasked: string;
  orders: number;
  revenuePaise: number;
  lastOrderAt: string | null;
}

export interface CustomerSeriesPoint {
  label: string;
  signups: number;
}

export interface UsersAnalytics {
  newUsers: Change;
  sessions: Change;
  registeredOrders: number;
  guestOrders: number;
  registeredBuyers: number;
  buyers: number;
  repeatBuyers: number;
  series: CustomerSeriesPoint[];
  topCustomers: TopCustomer[];
}

export interface StatusBucket {
  status: string;
  count: number;
  amountPaise: number;
}

export interface MethodSlice {
  method: string;
  count: number;
  amountPaise: number;
}

export interface RecentTransaction {
  txnid: string;
  customerNameMasked: string;
  customerEmailMasked: string;
  amountPaise: number;
  currency: string;
  status: string;
  channel: string;
  createdAt: string;
}

export interface TransactionsAnalytics {
  captured: Change;
  failed: number;
  pending: number;
  /** Orders (any status) with a refund recorded in the range. */
  refundedOrders: number;
  /** Money refunded in the range, on any order. */
  refundedPaise: number;
  statuses: StatusBucket[];
  methods: MethodSlice[];
  channels: ChannelSlice[];
  recent: RecentTransaction[];
}

type Row = Record<string, unknown>;
type Sql = NonNullable<ReturnType<typeof getSql>>;

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function change(current: number, previous: number): Change {
  if (previous <= 0) {
    return { current, previous, pct: current > 0 ? null : 0 };
  }
  return {
    current,
    previous,
    pct: ((current - previous) / previous) * 100,
  };
}

/**
 * Window bounds, cut in the store timezone on the database clock.
 *
 * `from_ts` is the start of the first store day in the range, `to_ts` the start
 * of tomorrow, and `prev_from_ts` the start of the equal-length window before
 * it. Using `current_date` here would cut days in the database session zone
 * (UTC on hosted Postgres) instead of the store's own.
 */
function boundsCte(sql: Sql, timeZone: string, days: number) {
  const from = days - 1;
  const previousFrom = days * 2 - 1;
  return sql`bounds as (
    select
      ((now() at time zone ${timeZone}::text)::date - ${from}::int)::timestamp
        at time zone ${timeZone}::text as from_ts,
      ((now() at time zone ${timeZone}::text)::date + 1)::timestamp
        at time zone ${timeZone}::text as to_ts,
      ((now() at time zone ${timeZone}::text)::date - ${previousFrom}::int)::timestamp
        at time zone ${timeZone}::text as prev_from_ts,
      (now() at time zone ${timeZone}::text)::date as today_local,
      ((now() at time zone ${timeZone}::text)::date - ${from}::int) as from_local
  )`;
}

/** A buyer: the account, else the checkout email, else the single order. */
const BUYER_KEY = `coalesce(
  o.user_id,
  case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end
)`;

/* --------------------------------------------------------------- sales */

export async function getSalesAnalytics(range: RangeKey): Promise<AnalyticsLoad<SalesAnalytics>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const days = rangeDays(range);
  const bucket = rangeBucket(range);

  try {
    const timeZone = await getStoreTimeZone();
    const bounds = boundsCte(sql, timeZone, days);
    const [summaryRows, refundRows, unitsRows, seriesRows, topRows, categoryRows, channelRows] =
      await Promise.all([
        sql`
          with ${bounds}
          select
            count(*) filter (where o.created_at >= b.from_ts)::int as orders,
            coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)) filter (where o.created_at >= b.from_ts), 0)::bigint as revenue,
            count(*) filter (where o.created_at < b.from_ts)::int as prev_orders,
            coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)) filter (where o.created_at < b.from_ts), 0)::bigint as prev_revenue
          from orders o
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= b.prev_from_ts
            and o.created_at < b.to_ts
        `,
        sql`
          with ${bounds}
          select
            count(distinct r.order_id)::int as refunded_orders,
            coalesce(sum(r.amount_paise), 0)::bigint as refunded
          from refunds r
          join orders o on o.id = r.order_id
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and r.created_at >= b.from_ts
            and r.created_at < b.to_ts
        `,
        sql`
          with ${bounds}
          select
            coalesce(sum(oi.quantity), 0)::int as units,
            count(distinct split_part(oi.product_id, '::', 1))::int as product_count
          from order_items oi
          join orders o on o.id = oi.order_id
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= b.from_ts
            and o.created_at < b.to_ts
        `,
        bucket === 'month'
          ? sql`
              with ${bounds},
              buckets as (
                select generate_series(
                  date_trunc('month', b.from_local::timestamp),
                  date_trunc('month', b.today_local::timestamp),
                  interval '1 month'
                ) as bucket
                from bounds b
              ),
              ord as (
                select
                  date_trunc('month', (o.created_at at time zone ${timeZone}::text)) as bucket,
                  sum(coalesce(o.total_paise, round(o.amount * 100)::bigint))::bigint as revenue,
                  count(*)::int as orders
                from orders o
                cross join bounds b
                where o.status = 'PAID'
                  and o.fulfilment_status <> 'CANCELED'
                  and o.created_at >= b.from_ts
                  and o.created_at < b.to_ts
                group by 1
              )
              select
                to_char(b.bucket, 'Mon YY') as label,
                coalesce(ord.revenue, 0)::bigint as revenue,
                coalesce(ord.orders, 0)::int as orders
              from buckets b
              left join ord on ord.bucket = b.bucket
              order by b.bucket
            `
          : sql`
              with ${bounds},
              buckets as (
                select generate_series(b.from_local, b.today_local, interval '1 day')::date as bucket
                from bounds b
              ),
              ord as (
                select
                  (o.created_at at time zone ${timeZone}::text)::date as bucket,
                  sum(coalesce(o.total_paise, round(o.amount * 100)::bigint))::bigint as revenue,
                  count(*)::int as orders
                from orders o
                cross join bounds b
                where o.status = 'PAID'
                  and o.fulfilment_status <> 'CANCELED'
                  and o.created_at >= b.from_ts
                  and o.created_at < b.to_ts
                group by 1
              )
              select
                to_char(b.bucket, 'DD Mon') as label,
                coalesce(ord.revenue, 0)::bigint as revenue,
                coalesce(ord.orders, 0)::int as orders
              from buckets b
              left join ord on ord.bucket = b.bucket
              order by b.bucket
            `,
        sql`
          with ${bounds}
          select
            split_part(oi.product_id, '::', 1) as product_id,
            max(oi.product_name) as name,
            coalesce(sum(oi.quantity), 0)::int as units,
            coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue
          from order_items oi
          join orders o on o.id = oi.order_id
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= b.from_ts
            and o.created_at < b.to_ts
          group by split_part(oi.product_id, '::', 1)
          order by revenue desc, units desc, product_id
          limit 5
        `,
        sql`
          with ${bounds}
          select
            coalesce(c.name, 'Uncategorised') as name,
            coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue,
            coalesce(sum(oi.quantity), 0)::int as units
          from order_items oi
          join orders o on o.id = oi.order_id
          left join products p on p.id = split_part(oi.product_id, '::', 1)
          left join categories c on c.id = p.category_id and c.deleted_at is null
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= b.from_ts
            and o.created_at < b.to_ts
          group by coalesce(c.name, 'Uncategorised')
          order by revenue desc, name
          limit 6
        `,
        sql`
          with ${bounds}
          select
            coalesce(nullif(o.channel, ''), 'web') as channel,
            count(*)::int as orders,
            coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue
          from orders o
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= b.from_ts
            and o.created_at < b.to_ts
          group by coalesce(nullif(o.channel, ''), 'web')
          order by revenue desc
        `,
      ]);

    const summary = (summaryRows as Row[])[0] ?? {};
    const refunds = (refundRows as Row[])[0] ?? {};
    const units = (unitsRows as Row[])[0] ?? {};
    const currentOrders = number(summary.orders);
    const previousOrders = number(summary.prev_orders);
    const currentRevenue = number(summary.revenue);
    const previousRevenue = number(summary.prev_revenue);

    return {
      ok: true,
      data: {
        revenue: change(currentRevenue, previousRevenue),
        orders: change(currentOrders, previousOrders),
        aov: change(
          currentOrders > 0 ? Math.round(currentRevenue / currentOrders) : 0,
          previousOrders > 0 ? Math.round(previousRevenue / previousOrders) : 0,
        ),
        units: number(units.units),
        productCount: number(units.product_count),
        refundedOrders: number(refunds.refunded_orders),
        refundsPaise: number(refunds.refunded),
        series: (seriesRows as Row[]).map((row) => ({
          label: text(row.label),
          revenuePaise: number(row.revenue),
          orders: number(row.orders),
        })),
        topProducts: (topRows as Row[]).map((row) => ({
          productId: text(row.product_id),
          name: text(row.name) || '(unnamed product)',
          units: number(row.units),
          revenuePaise: number(row.revenue),
        })),
        categories: (categoryRows as Row[]).map((row) => ({
          name: text(row.name),
          revenuePaise: number(row.revenue),
          units: number(row.units),
        })),
        channels: (channelRows as Row[]).map((row) => ({
          channel: text(row.channel),
          orders: number(row.orders),
          revenuePaise: number(row.revenue),
        })),
      },
    };
  } catch {
    console.warn('[store-admin/analytics] could not read sales analytics');
    return { ok: false, reason: 'unavailable' };
  }
}

/* --------------------------------------------------------------- users */

export async function getUsersAnalytics(range: RangeKey): Promise<AnalyticsLoad<UsersAnalytics>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const days = rangeDays(range);
  const bucket = rangeBucket(range);

  try {
    const timeZone = await getStoreTimeZone();
    const bounds = boundsCte(sql, timeZone, days);
    const [summaryRows, buyerRows, seriesRows, topRows] = await Promise.all([
      sql`
        with ${bounds}
        select
          (
            select count(*)::int from users u
            where u.created_at >= b.from_ts and u.created_at < b.to_ts
          ) as new_users,
          (
            select count(*)::int from users u
            where u.created_at >= b.prev_from_ts and u.created_at < b.from_ts
          ) as prev_new_users,
          (
            select count(*)::int from user_sessions s
            where s.created_at >= b.from_ts and s.created_at < b.to_ts
          ) as sessions,
          (
            select count(*)::int from user_sessions s
            where s.created_at >= b.prev_from_ts and s.created_at < b.from_ts
          ) as prev_sessions,
          count(o.id) filter (where o.user_id is not null)::int as registered_orders,
          count(o.id) filter (where o.user_id is null)::int as guest_orders,
          count(distinct o.user_id)::int as registered_buyers
        from bounds b
        left join orders o
          on o.created_at >= b.from_ts
         and o.created_at < b.to_ts
         and o.status = 'PAID'
         and o.fulfilment_status <> 'CANCELED'
        group by b.from_ts, b.to_ts, b.prev_from_ts
      `,
      sql`
        with ${bounds},
        buyers as (
          select
            ${sql.unsafe(BUYER_KEY)} as buyer_key,
            count(*)::int as order_count
          from orders o
          cross join bounds b
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= b.from_ts
            and o.created_at < b.to_ts
          group by 1
        )
        select
          count(*)::int as buyers,
          count(*) filter (where order_count > 1)::int as repeat_buyers
        from buyers
      `,
      bucket === 'month'
        ? sql`
            with ${bounds},
            buckets as (
              select generate_series(
                date_trunc('month', b.from_local::timestamp),
                date_trunc('month', b.today_local::timestamp),
                interval '1 month'
              ) as bucket
              from bounds b
            ),
            signups as (
              select
                date_trunc('month', (u.created_at at time zone ${timeZone}::text)) as bucket,
                count(*)::int as signups
              from users u
              cross join bounds b
              where u.created_at >= b.from_ts and u.created_at < b.to_ts
              group by 1
            )
            select
              to_char(b.bucket, 'Mon YY') as label,
              coalesce(s.signups, 0)::int as signups
            from buckets b
            left join signups s on s.bucket = b.bucket
            order by b.bucket
          `
        : sql`
            with ${bounds},
            buckets as (
              select generate_series(b.from_local, b.today_local, interval '1 day')::date as bucket
              from bounds b
            ),
            signups as (
              select
                (u.created_at at time zone ${timeZone}::text)::date as bucket,
                count(*)::int as signups
              from users u
              cross join bounds b
              where u.created_at >= b.from_ts and u.created_at < b.to_ts
              group by 1
            )
            select
              to_char(b.bucket, 'DD Mon') as label,
              coalesce(s.signups, 0)::int as signups
            from buckets b
            left join signups s on s.bucket = b.bucket
            order by b.bucket
          `,
      sql`
        with ${bounds}
        select
          coalesce(
            nullif(trim(coalesce(max(u.first_name), '') || ' ' || coalesce(max(u.last_name), '')), ''),
            'Guest checkout'
          ) as name,
          coalesce(max(u.email), max(o.customer_email)) as email,
          count(*)::int as orders,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue,
          max(o.created_at) as last_order_at
        from orders o
        left join users u on u.id = o.user_id
        cross join bounds b
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at >= b.from_ts
          and o.created_at < b.to_ts
        group by ${sql.unsafe(BUYER_KEY)}
        order by revenue desc, orders desc, last_order_at desc
        limit 5
      `,
    ]);

    const summary = (summaryRows as Row[])[0] ?? {};
    const buyers = (buyerRows as Row[])[0] ?? {};

    return {
      ok: true,
      data: {
        newUsers: change(number(summary.new_users), number(summary.prev_new_users)),
        sessions: change(number(summary.sessions), number(summary.prev_sessions)),
        registeredOrders: number(summary.registered_orders),
        guestOrders: number(summary.guest_orders),
        registeredBuyers: number(summary.registered_buyers),
        buyers: number(buyers.buyers),
        repeatBuyers: number(buyers.repeat_buyers),
        series: (seriesRows as Row[]).map((row) => ({
          label: text(row.label),
          signups: number(row.signups),
        })),
        topCustomers: (topRows as Row[]).map((row) => ({
          name: text(row.name) || 'Guest checkout',
          emailMasked: maskCustomerEmail(text(row.email)),
          orders: number(row.orders),
          revenuePaise: number(row.revenue),
          lastOrderAt: iso(row.last_order_at),
        })),
      },
    };
  } catch {
    console.warn('[store-admin/analytics] could not read user analytics');
    return { ok: false, reason: 'unavailable' };
  }
}

/* -------------------------------------------------------- transactions */

export async function getTransactionsAnalytics(
  range: RangeKey,
): Promise<AnalyticsLoad<TransactionsAnalytics>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const days = rangeDays(range);

  try {
    const timeZone = await getStoreTimeZone();
    const bounds = boundsCte(sql, timeZone, days);
    const [statusRows, methodRows, channelRows, recentRows, refundRows] = await Promise.all([
      // Fulfilment cancellations override payment status, including unpaid
      // orders. The PAID bucket is exactly the captured Sales population.
      sql`
        with ${bounds}
        select
          case
            when o.fulfilment_status = 'CANCELED' then 'CANCELLED'
            else o.status
          end as status,
          count(*) filter (where o.created_at >= b.from_ts)::int as count,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)) filter (where o.created_at >= b.from_ts), 0)::bigint as amount,
          count(*) filter (where o.created_at < b.from_ts)::int as prev_count
        from orders o
        cross join bounds b
        where o.created_at >= b.prev_from_ts
          and o.created_at < b.to_ts
        group by 1
      `,
      sql`
        with ${bounds}
        select
          coalesce(
            nullif(pm.method, ''),
            nullif(o.payu_mode, ''),
            nullif(o.payment_method, ''),
            nullif(o.channel, ''),
            'online'
          ) as method,
          count(*)::int as count,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as amount
        from orders o
        left join lateral (
          select case when count(distinct nullif(p.method, '')) > 1 then 'mixed'
                      else min(nullif(p.method, '')) end as method
          from order_payments p where p.order_id = o.id and p.status = 'PAID'
        ) pm on true
        cross join bounds b
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at >= b.from_ts
          and o.created_at < b.to_ts
        group by 1
        order by amount desc, method
      `,
      sql`
        with ${bounds}
        select
          coalesce(nullif(o.channel, ''), 'web') as channel,
          count(*)::int as orders,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue
        from orders o
        cross join bounds b
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at >= b.from_ts
          and o.created_at < b.to_ts
        group by coalesce(nullif(o.channel, ''), 'web')
        order by revenue desc
      `,
      sql`
        with ${bounds}
        select
          o.txnid, o.customer_name, o.customer_email, o.status,
          coalesce(o.total_paise, round(o.amount * 100)::bigint) as total_paise, o.currency, o.channel, o.created_at
        from orders o
        cross join bounds b
        where o.created_at >= b.from_ts
          and o.created_at < b.to_ts
        order by o.created_at desc, o.id desc
        limit 8
      `,
      // Cash view: a refund counts on the day it was recorded, for any order.
      sql`
        with ${bounds}
        select
          count(distinct r.order_id)::int as refunded_orders,
          coalesce(sum(r.amount_paise), 0)::bigint as refunded
        from refunds r
        cross join bounds b
        where r.created_at >= b.from_ts
          and r.created_at < b.to_ts
      `,
    ]);

    const statusList = (statusRows as Row[]).filter((row) => number(row.count) > 0);
    const statuses = statusList.map((row) => ({
      status: text(row.status),
      count: number(row.count),
      amountPaise: number(row.amount),
    }));

    const paid = (statusRows as Row[]).find((row) => isRevenueStatus(text(row.status)));
    // PROCESSING belongs here: the money is unconfirmed, so it is neither
    // captured revenue nor a failed payment.
    const failedCount = statuses
      .filter((row) => row.status === 'FAILED')
      .reduce((sum, row) => sum + row.count, 0);
    const pendingCount = countPendingTransactions(
      statuses.map((row) => ({ status: row.status, count: row.count })),
    );
    const refundSummary = (refundRows as Row[])[0] ?? {};

    return {
      ok: true,
      data: {
        captured: change(number(paid?.count), number(paid?.prev_count)),
        failed: failedCount,
        pending: pendingCount,
        refundedOrders: number(refundSummary.refunded_orders),
        refundedPaise: number(refundSummary.refunded),
        statuses,
        methods: (methodRows as Row[]).map((row) => ({
          method: text(row.method) || 'online',
          count: number(row.count),
          amountPaise: number(row.amount),
        })),
        channels: (channelRows as Row[]).map((row) => ({
          channel: text(row.channel),
          orders: number(row.orders),
          revenuePaise: number(row.revenue),
        })),
        recent: (recentRows as Row[]).map((row) => ({
          txnid: text(row.txnid),
          customerNameMasked: maskCustomerName(row.customer_name),
          customerEmailMasked: maskCustomerEmail(text(row.customer_email)),
          amountPaise: number(row.total_paise),
          currency: text(row.currency) || 'INR',
          status: text(row.status),
          channel: text(row.channel) || 'web',
          createdAt: iso(row.created_at) ?? '',
        })),
      },
    };
  } catch {
    console.warn('[store-admin/analytics] could not read transaction analytics');
    return { ok: false, reason: 'unavailable' };
  }
}

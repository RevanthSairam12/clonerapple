import { getSql } from '@/lib/platform/db';
import { INVENTORY_REPORT_CTE, inventoryReportLabel } from './inventory-report';

import { maskCustomerEmail } from './masking';
import { maskCustomerName } from './orders';
import {
  type ReportColumnFormat,
  type ReportData,
  type ReportFilters,
  type ReportKey,
  type ReportRow,
  type ReportStat,
} from './report-rules';

/**
 * The ten Reports queries.
 *
 * Every report is built from the same `ReportData` table, so the page and the
 * CSV export cannot drift. Definitions are deliberately explicit and match the
 * order and payment lists:
 *
 * - A **captured sale** is `status = 'PAID'` with fulfilment not `CANCELED`
 *   (cancelling a paid order leaves the status PAID). Revenue, units, AOV and
 *   sell-through use exactly that predicate.
 * - **Revenue** is the order total as charged — items − discount + shipping —
 *   the same figure the Overview and the Orders list show. It falls back to
 *   the rupee `amount` for rows created before migration 0014. The item-wise
 *   and category/brand reports sum `line_total_paise − discount_paise`:
 *   product revenue after discount, which excludes shipping, so item revenue
 *   plus shipping equals revenue.
 * - A **refund** is attributed to the day it was recorded. Sales reports net
 *   only refunds on captured orders; the transaction statement is the cash
 *   view and lists every refund.
 * - **Days** are store-timezone days (the `timezone` setting), never UTC days.
 * - Payments come from two places: `order_payments` rows (manual and POS) and
 *   the order itself for PayU (the gateway marks the order paid without
 *   writing a payment row). The transaction statement combines them, and a
 *   gateway order that *does* have payment rows is not counted twice.
 * - Money uses integer paise throughout; the CSV writes rupees.
 *
 * Customer names and emails are masked, matching the Customers section. The
 * only way to see a full value is the audited reveal endpoint.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Reports must be read on the server only.');
}

type Sql = NonNullable<ReturnType<typeof getSql>>;
type Row = Record<string, unknown>;

export type ReportLoad =
  | { ok: true; data: ReportData }
  | { ok: false; reason: 'unavailable' };

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result ? result : null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, 10);
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function average(amount: number, count: number): number {
  return count > 0 ? Math.round(amount / count) : 0;
}

/**
 * Keep the tail of a provider reference: enough to match a row in the PayU
 * dashboard, not enough to reconstruct the whole identifier from a screenshot.
 */
export function maskReference(value: unknown): string {
  const reference = text(value).trim();
  if (!reference) return '—';
  if (reference.length <= 6) return `…${reference.slice(-2)}`;
  return `…${reference.slice(-6)}`;
}

function capped<T>(
  rows: T[],
  filters: Pick<ReportFilters, 'rowLimit'>,
): { rows: T[]; truncated: boolean } {
  return {
    rows: rows.slice(0, filters.rowLimit),
    truncated: rows.length > filters.rowLimit,
  };
}

/**
 * Reports whose totals are computed in JavaScript read every row (up to this
 * many) and only then cut the table, so a long table never skews its totals.
 */
const SCAN_LIMIT = 50_000;

/* --------------------------------------------------------------- orders */

/**
 * A *captured* order: paid and not cancelled afterwards. Cancelling a paid
 * order leaves `status = 'PAID'` and sets `fulfilment_status = 'CANCELED'`, so
 * both columns are needed. Everything that is "revenue" uses this predicate.
 */
async function orderReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const group = filters.groupBy;
  const tz = filters.timeZone;
  const step = group === 'day' ? '1 day' : group === 'week' ? '1 week' : '1 month';
  const labelFormat = group === 'month' ? 'Mon YYYY' : 'DD Mon YYYY';

  const [rows, summaryRows] = await Promise.all([
    sql`
      with buckets as (
        select generate_series(
          date_trunc(${group}, ${filters.fromDay}::date::timestamp),
          date_trunc(${group}, ${filters.toDay}::date::timestamp),
          ${step}::interval
        ) as bucket
      ),
      ord as (
        select
          date_trunc(${group}, (o.created_at at time zone ${tz}::text)) as bucket,
          count(*)::int as orders,
          count(*) filter (
            where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
          )::int as paid_orders,
          count(*) filter (
            where o.status <> 'FAILED'
              and (o.status = 'CANCELLED' or o.fulfilment_status = 'CANCELED')
          )::int as cancelled_orders,
          count(*) filter (where o.status = 'FAILED')::int as failed_orders,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)) filter (
            where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
          ), 0)::bigint as revenue,
          coalesce(sum(o.discount_paise) filter (
            where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
          ), 0)::bigint as discount
        from orders o
        where o.created_at >= ${filters.fromIso}::timestamptz
          and o.created_at < ${filters.toIso}::timestamptz
          and (${filters.status}::text = 'all' or o.status = ${filters.status}::text)
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
          )
        group by 1
      ),
      units as (
        select
          date_trunc(${group}, (uo.created_at at time zone ${tz}::text)) as bucket,
          coalesce(sum(oi.quantity), 0)::int as units
        from order_items oi
        join orders uo on uo.id = oi.order_id
        where uo.status = 'PAID'
          and uo.fulfilment_status <> 'CANCELED'
          and uo.created_at >= ${filters.fromIso}::timestamptz
          and uo.created_at < ${filters.toIso}::timestamptz
          and (${filters.status}::text = 'all' or uo.status = ${filters.status}::text)
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(uo.channel, ''), 'web') = ${filters.channel}::text
          )
        group by 1
      ),
      ref as (
        select
          date_trunc(${group}, (r.created_at at time zone ${tz}::text)) as bucket,
          coalesce(sum(r.amount_paise), 0)::bigint as refunds
        from refunds r
        join orders ro on ro.id = r.order_id
        where r.created_at >= ${filters.fromIso}::timestamptz
          and r.created_at < ${filters.toIso}::timestamptz
          and ro.status = 'PAID'
          and ro.fulfilment_status <> 'CANCELED'
          and (${filters.status}::text = 'all' or ro.status = ${filters.status}::text)
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(ro.channel, ''), 'web') = ${filters.channel}::text
          )
        group by 1
      )
      select
        to_char(b.bucket, ${labelFormat}) as label,
        coalesce(o.orders, 0)::int as orders,
        coalesce(o.paid_orders, 0)::int as paid_orders,
        coalesce(o.cancelled_orders, 0)::int as cancelled_orders,
        coalesce(o.failed_orders, 0)::int as failed_orders,
        coalesce(u.units, 0)::int as units,
        coalesce(o.revenue, 0)::bigint as revenue,
        coalesce(o.discount, 0)::bigint as discount,
        coalesce(rf.refunds, 0)::bigint as refunds,
        (coalesce(o.revenue, 0) - coalesce(rf.refunds, 0))::bigint as net
      from buckets b
      left join ord o on o.bucket = b.bucket
      left join units u on u.bucket = b.bucket
      left join ref rf on rf.bucket = b.bucket
      order by b.bucket
      limit ${filters.rowLimit + 1}
    `,
    sql`
      select
        count(*)::int as orders,
        count(*) filter (
          where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
        )::int as paid_orders,
        count(*) filter (
          where o.status <> 'FAILED'
            and (o.status = 'CANCELLED' or o.fulfilment_status = 'CANCELED')
        )::int as cancelled_orders,
        count(*) filter (where o.status = 'FAILED')::int as failed_orders,
        coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)) filter (
          where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
        ), 0)::bigint as revenue,
        coalesce(sum(o.discount_paise) filter (
          where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
        ), 0)::bigint as discount,
        (
          select coalesce(sum(oi.quantity), 0)::int
          from order_items oi
          join orders uo on uo.id = oi.order_id
          where uo.status = 'PAID'
            and uo.fulfilment_status <> 'CANCELED'
            and uo.created_at >= ${filters.fromIso}::timestamptz
            and uo.created_at < ${filters.toIso}::timestamptz
            and (${filters.status}::text = 'all' or uo.status = ${filters.status}::text)
            and (
              ${filters.channel}::text = 'all'
              or coalesce(nullif(uo.channel, ''), 'web') = ${filters.channel}::text
            )
        ) as units,
        (
          select coalesce(sum(r.amount_paise), 0)::bigint
          from refunds r
          join orders ro on ro.id = r.order_id
          where r.created_at >= ${filters.fromIso}::timestamptz
            and r.created_at < ${filters.toIso}::timestamptz
            and ro.status = 'PAID'
            and ro.fulfilment_status <> 'CANCELED'
            and (${filters.status}::text = 'all' or ro.status = ${filters.status}::text)
            and (
              ${filters.channel}::text = 'all'
              or coalesce(nullif(ro.channel, ''), 'web') = ${filters.channel}::text
            )
        ) as refunds
      from orders o
      where o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.status}::text = 'all' or o.status = ${filters.status}::text)
        and (
          ${filters.channel}::text = 'all'
          or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
        )
    `,
  ]);

  const summary = (summaryRows as Row[])[0] ?? {};
  const revenue = number(summary.revenue);
  const refunds = number(summary.refunds);
  const cut = capped(rows as Row[], filters);

  return {
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'orders', label: 'Orders', format: 'int', align: 'right' },
      { key: 'paid', label: 'Paid', format: 'int', align: 'right' },
      { key: 'cancelled', label: 'Cancelled', format: 'int', align: 'right' },
      { key: 'failed', label: 'Failed', format: 'int', align: 'right' },
      { key: 'units', label: 'Units', format: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', format: 'money', align: 'right' },
      { key: 'discount', label: 'Discount', format: 'money', align: 'right' },
      { key: 'refunds', label: 'Refunds', format: 'money', align: 'right' },
      { key: 'net', label: 'Net', format: 'money', align: 'right' },
    ],
    rows: cut.rows.map((row) => ({
      period: text(row.label),
      orders: number(row.orders),
      paid: number(row.paid_orders),
      cancelled: number(row.cancelled_orders),
      failed: number(row.failed_orders),
      units: number(row.units),
      revenue: number(row.revenue),
      discount: number(row.discount),
      refunds: number(row.refunds),
      net: number(row.net),
    })),
    totals: {
      period: 'Total',
      orders: number(summary.orders),
      paid: number(summary.paid_orders),
      cancelled: number(summary.cancelled_orders),
      failed: number(summary.failed_orders),
      units: number(summary.units),
      revenue,
      discount: number(summary.discount),
      refunds,
      net: revenue - refunds,
    },
    stats: [
      { label: 'Orders', value: number(summary.orders), format: 'int' },
      { label: 'Captured orders', value: number(summary.paid_orders), format: 'int' },
      { label: 'Revenue', value: revenue, format: 'money' },
      { label: 'Average order', value: average(revenue, number(summary.paid_orders)), format: 'money' },
      { label: 'Refunds', value: refunds, format: 'money' },
      { label: 'Net', value: revenue - refunds, format: 'money' },
    ],
    note:
      'Captured revenue counts PAID orders that were not cancelled afterwards. ' +
      'Each order contributes its total as charged (items − discount + shipping) on its order date. ' +
      'Refunds are taken from captured orders only, in the bucket they were recorded in, and follow the status and channel filters; ' +
      'a refund on an order cancelled after payment is a cash movement shown in the Transaction statement, not a deduction from sales. ' +
      `Days, weeks (starting Monday) and months follow the store timezone (${filters.timeZone}).`,
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------- day-wise */

async function dailyReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const tz = filters.timeZone;
  const [rows, summaryRows] = await Promise.all([
    sql`
      with days as (
        select generate_series(
          ${filters.fromDay}::date,
          ${filters.toDay}::date,
          interval '1 day'
        )::date as day
      ),
      ord as (
        select
          (o.created_at at time zone ${tz}::text)::date as day,
          count(*)::int as orders,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue
        from orders o
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at >= ${filters.fromIso}::timestamptz
          and o.created_at < ${filters.toIso}::timestamptz
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
          )
        group by 1
      ),
      newc as (
        select
          (u.created_at at time zone ${tz}::text)::date as day,
          count(*)::int as new_customers
        from users u
        where u.created_at >= ${filters.fromIso}::timestamptz
          and u.created_at < ${filters.toIso}::timestamptz
        group by 1
      ),
      ref as (
        select
          (r.created_at at time zone ${tz}::text)::date as day,
          coalesce(sum(r.amount_paise), 0)::bigint as refunds
        from refunds r
        join orders ro on ro.id = r.order_id
        where r.created_at >= ${filters.fromIso}::timestamptz
          and r.created_at < ${filters.toIso}::timestamptz
          and ro.status = 'PAID'
          and ro.fulfilment_status <> 'CANCELED'
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(ro.channel, ''), 'web') = ${filters.channel}::text
          )
        group by 1
      )
      select
        to_char(d.day, 'YYYY-MM-DD') as day,
        coalesce(o.orders, 0)::int as orders,
        coalesce(o.revenue, 0)::bigint as revenue,
        coalesce(n.new_customers, 0)::int as new_customers,
        coalesce(rf.refunds, 0)::bigint as refunds,
        (coalesce(o.revenue, 0) - coalesce(rf.refunds, 0))::bigint as net
      from days d
      left join ord o on o.day = d.day
      left join newc n on n.day = d.day
      left join ref rf on rf.day = d.day
      order by d.day
      limit ${filters.rowLimit + 1}
    `,
    sql`
      select
        (
          select count(*)::int
          from orders o
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= ${filters.fromIso}::timestamptz
            and o.created_at < ${filters.toIso}::timestamptz
            and (
              ${filters.channel}::text = 'all'
              or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
            )
        ) as orders,
        (
          select coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint
          from orders o
          where o.status = 'PAID'
            and o.fulfilment_status <> 'CANCELED'
            and o.created_at >= ${filters.fromIso}::timestamptz
            and o.created_at < ${filters.toIso}::timestamptz
            and (
              ${filters.channel}::text = 'all'
              or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
            )
        ) as revenue,
        (
          select count(*)::int
          from users u
          where u.created_at >= ${filters.fromIso}::timestamptz
            and u.created_at < ${filters.toIso}::timestamptz
        ) as new_customers,
        (
          select coalesce(sum(r.amount_paise), 0)::bigint
          from refunds r
          join orders ro on ro.id = r.order_id
          where r.created_at >= ${filters.fromIso}::timestamptz
            and r.created_at < ${filters.toIso}::timestamptz
            and ro.status = 'PAID'
            and ro.fulfilment_status <> 'CANCELED'
            and (
              ${filters.channel}::text = 'all'
              or coalesce(nullif(ro.channel, ''), 'web') = ${filters.channel}::text
            )
        ) as refunds
    `,
  ]);

  const summary = (summaryRows as Row[])[0] ?? {};
  const revenue = number(summary.revenue);
  const refunds = number(summary.refunds);
  const cut = capped(rows as Row[], filters);

  return {
    columns: [
      { key: 'day', label: 'Day', format: 'date' },
      { key: 'orders', label: 'Orders', format: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', format: 'money', align: 'right' },
      { key: 'aov', label: 'AOV', format: 'money', align: 'right' },
      { key: 'newCustomers', label: 'New customers', format: 'int', align: 'right' },
      { key: 'refunds', label: 'Refunds', format: 'money', align: 'right' },
      { key: 'net', label: 'Net', format: 'money', align: 'right' },
    ],
    rows: cut.rows.map((row) => {
      const orders = number(row.orders);
      return {
        day: text(row.day),
        orders,
        revenue: number(row.revenue),
        aov: average(number(row.revenue), orders),
        newCustomers: number(row.new_customers),
        refunds: number(row.refunds),
        net: number(row.net),
      };
    }),
    totals: {
      day: 'Total',
      orders: number(summary.orders),
      revenue,
      aov: average(revenue, number(summary.orders)),
      newCustomers: number(summary.new_customers),
      refunds,
      net: revenue - refunds,
    },
    stats: [
      { label: 'Revenue', value: revenue, format: 'money' },
      { label: 'Orders', value: number(summary.orders), format: 'int' },
      { label: 'Average order', value: average(revenue, number(summary.orders)), format: 'money' },
      { label: 'New customers', value: number(summary.new_customers), format: 'int' },
      { label: 'Refunds', value: refunds, format: 'money' },
      { label: 'Net', value: revenue - refunds, format: 'money' },
    ],
    note:
      `One row per store day (${filters.timeZone}), zero-filled. Revenue counts captured orders; ` +
      'refunds are taken from captured orders on the day they were recorded. ' +
      'New customers are storefront accounts created that day.',
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------ item-wise */

async function itemReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const [itemRows, returnRows, summaryRows] = await Promise.all([
    sql`
      select
        split_part(oi.product_id, '::', 1) as base_id,
        oi.variant_id, max(oi.variant_sku) as variant_sku, max(oi.variant_label) as variant_label,
        max(p.id) as product_id,
        coalesce(max(p.name), max(oi.product_name)) as name,
        max(c.name) as category_name,
        max(b.name) as brand_name,
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue,
        count(distinct o.id)::int as orders,
        max(s.on_hand - s.reserved) as available,
        coalesce(bool_or(s.track_inventory), false) as track_inventory
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      left join categories c on c.id = p.category_id and c.deleted_at is null
      left join brands b on b.id = p.brand_id and b.deleted_at is null
      left join stock s on s.product_id = p.id and s.variant_id is not distinct from oi.variant_id
      where o.status = 'PAID'
        and o.fulfilment_status <> 'CANCELED'
        and o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
      group by split_part(oi.product_id, '::', 1), oi.variant_id
      order by revenue desc, units desc, base_id
      limit ${SCAN_LIMIT}
    `,
    sql`
      select
        split_part(oi.product_id, '::', 1) as base_id,
        oi.variant_id, max(oi.variant_sku) as variant_sku, max(oi.variant_label) as variant_label,
        max(p.id) as product_id,
        coalesce(max(p.name), max(oi.product_name)) as name,
        max(c.name) as category_name,
        max(b.name) as brand_name,
        max(s.on_hand - s.reserved) as available,
        coalesce(bool_or(s.track_inventory), false) as track_inventory,
        coalesce(sum(ri.quantity), 0)::int as returned
      from return_items ri
      join return_requests rr on rr.id = ri.return_id
      join order_items oi on oi.id = ri.order_item_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      left join categories c on c.id = p.category_id and c.deleted_at is null
      left join brands b on b.id = p.brand_id and b.deleted_at is null
      left join stock s on s.product_id = p.id and s.variant_id is not distinct from oi.variant_id
      where rr.created_at >= ${filters.fromIso}::timestamptz
        and rr.created_at < ${filters.toIso}::timestamptz
        and rr.status in ('APPROVED', 'RECEIVED', 'REFUNDED')
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
      group by split_part(oi.product_id, '::', 1), oi.variant_id
      order by base_id
    `,
    sql`
      select
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue,
        count(distinct o.id)::int as orders,
        count(distinct split_part(oi.product_id, '::', 1))::int as products
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      where o.status = 'PAID'
        and o.fulfilment_status <> 'CANCELED'
        and o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
    `,
  ]);

  const returnedByProduct = new Map<string, number>();
  for (const row of returnRows as Row[]) {
    returnedByProduct.set(JSON.stringify([text(row.base_id), nullableText(row.variant_id)]), number(row.returned));
  }

  const summary = (summaryRows as Row[])[0] ?? {};
  const summaryUnits = number(summary.units);

  // Returns belong to their request date, even when the product had no sales
  // in this window. Keep those products in the table with zero sales figures.
  const soldProductIds = new Set((itemRows as Row[]).map((row) => JSON.stringify([text(row.base_id), nullableText(row.variant_id)])));
  const productRows = [
    ...(itemRows as Row[]),
    ...(returnRows as Row[]).filter((row) => !soldProductIds.has(JSON.stringify([text(row.base_id), nullableText(row.variant_id)]))),
  ];
  const allRows: ReportRow[] = productRows.map((row) => {
    const units = number(row.units);
    const returned = returnedByProduct.get(JSON.stringify([text(row.base_id), nullableText(row.variant_id)])) ?? 0;
    const available = nullableNumber(row.available);
    const tracked = row.track_inventory === true || text(row.track_inventory) === 'true';
    return {
      product: text(row.name) || '(unnamed product)',
      variantId: nullableText(row.variant_id),
      variantSku: nullableText(row.variant_sku),
      variantLabel: nullableText(row.variant_label),
      productId: nullableText(row.product_id),
      category: text(row.category_name) || 'Uncategorised',
      brand: text(row.brand_name) || '—',
      units,
      revenue: number(row.revenue),
      orders: number(row.orders),
      returned,
      returnRate: pct(returned, units),
      available: tracked ? available : null,
      sellThrough:
        tracked && available !== null ? pct(units, units + Math.max(available, 0)) : null,
    };
  });
  const totalReturned = allRows.reduce((sum, row) => sum + Number(row.returned ?? 0), 0);
  const rows = allRows.slice(0, filters.rowLimit);

  const revenue = number(summary.revenue);

  return {
    columns: [
      { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' },
      { key: 'variantSku', label: 'Variant SKU' },
      { key: 'variantLabel', label: 'Variant at sale' },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'units', label: 'Units sold', format: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', format: 'money', align: 'right' },
      { key: 'orders', label: 'Orders', format: 'int', align: 'right' },
      { key: 'returned', label: 'Returned', format: 'int', align: 'right' },
      { key: 'returnRate', label: 'Return rate %', format: 'int', align: 'right' },
      { key: 'available', label: 'Available to buy', format: 'int', align: 'right' },
      { key: 'sellThrough', label: 'Sell-through %', format: 'int', align: 'right' },
    ],
    rows,
    totals: {
      product: 'Total',
      category: '',
      brand: '',
      units: summaryUnits,
      revenue,
      orders: number(summary.orders),
      returned: totalReturned,
      returnRate: pct(totalReturned, summaryUnits),
      available: null,
      sellThrough: null,
    },
    stats: [
      { label: 'Units sold', value: summaryUnits, format: 'int' },
      { label: 'Revenue', value: revenue, format: 'money' },
      { label: 'Products sold', value: number(summary.products), format: 'int' },
      {
        label: 'Return rate',
        value: pct(totalReturned, summaryUnits),
        format: 'int',
        hint: 'Approved, received and refunded returns in the range',
      },
      { label: 'Units returned', value: totalReturned, format: 'int' },
    ],
    note:
      'Returned units count return requests approved, received or refunded in the range. ' +
      'Revenue is line revenue after discount (unit price × quantity − the order discount share), so it excludes shipping: ' +
      'item revenue plus shipping equals the order-level revenue of the Order report. ' +
      'Sell-through is units sold divided by units sold plus available stock, and is blank when inventory is not tracked.',
    truncated: allRows.length > filters.rowLimit,
  };
}

/* ---------------------------------------------------------- transactions */

interface StatementLine {
  recordedAt: string;
  kind: 'Payment' | 'Refund';
  txnid: string;
  channel: string;
  method: string;
  status: string;
  amountPaise: number;
  reference: string;
}

/**
 * The statement is a cash view. A payment belongs to the moment it was
 * received (`paid_at`), a refund to the moment it was recorded, and an order
 * that was cancelled after payment keeps both lines: the money did move. A
 * gateway order with no `order_payments` rows contributes one synthetic
 * payment line from the order itself, unless its total is zero (a free sale
 * has no payment).
 */
async function statementLines(sql: Sql, filters: ReportFilters): Promise<Row[]> {
  const tz = filters.timeZone;
  return (await sql`
    with lines as (
      select
        coalesce(p.paid_at, p.created_at) as recorded_at,
        'Payment'::text as kind,
        o.txnid,
        case when o.channel = 'pos' then 'pos' else 'web' end as channel,
        coalesce(nullif(p.method, ''), nullif(o.payment_method, ''), 'other') as method,
        p.status,
        p.amount_paise,
        coalesce(p.provider_ref, '') as reference
      from order_payments p
      join orders o on o.id = p.order_id
      where coalesce(p.paid_at, p.created_at) >= ${filters.fromIso}::timestamptz
        and coalesce(p.paid_at, p.created_at) < ${filters.toIso}::timestamptz
      union all
      select
        coalesce(o.paid_at, o.created_at),
        'Payment'::text,
        o.txnid,
        case when o.channel = 'pos' then 'pos' else 'web' end,
        coalesce(nullif(o.payu_mode, ''), nullif(o.payment_method, ''), 'payu'),
        o.status,
        coalesce(o.total_paise, round(o.amount * 100)::bigint),
        coalesce(o.payu_mihpayid, '')
      from orders o
      where o.status = 'PAID'
        and not exists (select 1 from order_payments p where p.order_id = o.id)
        and coalesce(o.total_paise, round(o.amount * 100)::bigint) > 0
        and coalesce(o.paid_at, o.created_at) >= ${filters.fromIso}::timestamptz
        and coalesce(o.paid_at, o.created_at) < ${filters.toIso}::timestamptz
      union all
      select
        r.created_at,
        'Refund'::text,
        o.txnid,
        case when o.channel = 'pos' then 'pos' else 'web' end,
        r.method,
        r.status,
        -r.amount_paise,
        coalesce(r.provider_ref, '')
      from refunds r
      join orders o on o.id = r.order_id
      where r.created_at >= ${filters.fromIso}::timestamptz
        and r.created_at < ${filters.toIso}::timestamptz
    )
    select
      to_char((recorded_at at time zone ${tz}::text), 'YYYY-MM-DD HH24:MI') as recorded_local,
      kind, txnid, channel, method, status, amount_paise, reference
    from lines
    where (${filters.channel}::text = 'all' or channel = ${filters.channel}::text)
    order by recorded_at desc, txnid desc, kind
  `) as Row[];
}

async function transactionReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const rows = await statementLines(sql, filters);
  const method = filters.method?.trim().toLowerCase();
  // Filter normalized statement lines before both totals and the display cap.
  const allLines = rows.map<StatementLine>((row) => ({
    recordedAt: text(row.recorded_local),
    kind: text(row.kind) === 'Refund' ? 'Refund' : 'Payment',
    txnid: text(row.txnid),
    channel: text(row.channel),
    method: text(row.method),
    status: text(row.status),
    amountPaise: number(row.amount_paise),
    reference: text(row.reference),
  })).filter((line) => !method || method === 'all' || line.method.trim().toLowerCase() === method);
  const cut = capped(allLines, filters);
  const lines = cut.rows;
  const settledStatuses = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
  const summary = { settled_count: 0, unsettled_count: 0 };
  let moneyIn = 0;
  let moneyOut = 0;
  for (const line of allLines) {
    if (line.kind === 'Refund') {
      moneyOut -= line.amountPaise;
    } else if (settledStatuses.has(line.status)) {
      summary.settled_count++;
      moneyIn += line.amountPaise;
    } else {
      summary.unsettled_count++;
    }
  }

  return {
    columns: [
      { key: 'date', label: 'Date', format: 'datetime' },
      { key: 'type', label: 'Type' },
      { key: 'order', label: 'Order', link: 'order' },
      { key: 'channel', label: 'Channel' },
      { key: 'method', label: 'Method' },
      { key: 'status', label: 'Status' },
      { key: 'reference', label: 'Reference' },
      { key: 'amount', label: 'Amount', format: 'money', align: 'right' },
    ],
    rows: lines.map((line) => ({
      date: line.recordedAt,
      type: line.kind,
      order: line.txnid,
      channel: line.channel,
      method: line.method,
      status: line.status,
      reference: maskReference(line.reference),
      amount: line.amountPaise,
    })),
    totals: {
      date: 'Net settled',
      type: '',
      order: '',
      channel: '',
      method: '',
      status: '',
      reference: '',
      amount: moneyIn - moneyOut,
    },
    stats: [
      { label: 'Money in', value: moneyIn, format: 'money' },
      { label: 'Money out', value: moneyOut, format: 'money' },
      { label: 'Net', value: moneyIn - moneyOut, format: 'money' },
      { label: 'Settled payments', value: number(summary.settled_count), format: 'int' },
      {
        label: 'Unsettled attempts',
        value: number(summary.unsettled_count),
        format: 'int',
        hint: 'Pending, failed and cancelled payments, listed but not counted',
      },
    ],
    note:
      'Money in and net count only settled payments; pending, failed and cancelled attempts stay in the list for reference but are not money received. ' +
      'Refund lines are negative and dated when they were recorded, including refunds on orders cancelled after payment. ' +
      `Times are shown in the store timezone (${filters.timeZone}). Provider references keep only their last six characters; ` +
      'the order number is the full key for matching a payment.',
    truncated: cut.truncated,
  };
}

/* -------------------------------------------------------- reconciliation */

async function reconciliationReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const rows = (await sql`
    with base as (
      select
        o.id,
        o.txnid,
        o.status,
        case when o.channel = 'pos' then 'pos' else 'web' end as channel,
        (case
          when o.status = 'PAID' then coalesce(o.total_paise, round(o.amount * 100)::bigint)
          else 0
        end)::bigint as expected,
        coalesce(p.recorded, 0)::bigint as recorded,
        coalesce(p.methods, '') as methods,
        coalesce(r.refunded, 0)::bigint as refunded,
        o.payu_mihpayid,
        o.created_at,
        to_char((o.created_at at time zone ${filters.timeZone}::text), 'YYYY-MM-DD') as created_local
      from orders o
      left join (
        select
          order_id,
          sum(amount_paise) filter (where status = 'PAID') as recorded,
          string_agg(distinct method, ', ') as methods
        from order_payments
        group by order_id
      ) p on p.order_id = o.id
      left join (
        select order_id, sum(amount_paise) as refunded
        from refunds
        group by order_id
      ) r on r.order_id = o.id
      where o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (o.status = 'PAID' or p.order_id is not null or o.payu_mihpayid is not null)
    ),
    classified as (
      select
        *,
        case
          when status = 'PAID' and expected = 0 then 'MATCHED'
          when status = 'PAID'
            and payu_mihpayid is not null
            and recorded <= expected then 'MATCHED'
          when status = 'PAID' and recorded = expected then 'MATCHED'
          when status = 'PAID' then 'UNMATCHED'
          when status in ('FAILED', 'CANCELLED') and recorded = 0 then 'FAILED'
          when status in ('CREATED', 'PENDING')
            and recorded = 0 and payu_mihpayid is null then 'OPEN'
          else 'UNMATCHED'
        end as state
      from base
    )
    select
      txnid, status, channel, methods, state, expected, recorded, refunded,
      payu_mihpayid, created_at, created_local,
      count(*) filter (where state = 'MATCHED') over () as matched_count,
      count(*) filter (where state = 'UNMATCHED') over () as unmatched_count,
      count(*) filter (where state = 'FAILED') over () as failed_count,
      count(*) filter (where state = 'OPEN') over () as open_count,
      coalesce(sum(expected) filter (
        where status = 'PAID' and state in ('MATCHED', 'UNMATCHED')
      ) over (), 0) as expected_sum,
      coalesce(sum(recorded) over (), 0) as recorded_sum,
      coalesce(sum(refunded) over (), 0) as refunded_sum,
      coalesce(sum(expected) filter (
        where status = 'PAID' and payu_mihpayid is not null
      ) over (), 0) as gateway_sum,
      coalesce(sum(recorded) filter (
        where channel = 'pos' and status = 'PAID'
      ) over (), 0) as pos_sum
    from classified
    order by created_at desc, txnid desc
    limit ${filters.rowLimit + 1}
  `) as Row[];

  const first = rows[0] ?? {};
  const matched = number(first.matched_count);
  const unmatched = number(first.unmatched_count);
  const failed = number(first.failed_count);
  const open = number(first.open_count);
  const expected = number(first.expected_sum);
  const recorded = number(first.recorded_sum);
  const refunded = number(first.refunded_sum);
  const cut = capped(rows, filters);

  const stateLabel: Record<string, string> = {
    MATCHED: 'Matched',
    UNMATCHED: 'Unmatched',
    FAILED: 'Failed',
    OPEN: 'Open',
  };

  return {
    columns: [
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'order', label: 'Order', link: 'order' },
      { key: 'channel', label: 'Channel' },
      { key: 'method', label: 'Method' },
      { key: 'status', label: 'Order status' },
      { key: 'state', label: 'Reconciliation' },
      { key: 'expected', label: 'Expected', format: 'money', align: 'right' },
      { key: 'recorded', label: 'Recorded', format: 'money', align: 'right' },
      { key: 'refunded', label: 'Refunded', format: 'money', align: 'right' },
      { key: 'reference', label: 'Gateway ref', align: 'right' },
    ],
    rows: cut.rows.map((row) => ({
      date: text(row.created_local),
      order: text(row.txnid),
      channel: text(row.channel),
      method: text(row.methods) || '—',
      status: text(row.status),
      state: stateLabel[text(row.state)] ?? text(row.state),
      expected: number(row.expected),
      recorded: number(row.recorded),
      refunded: number(row.refunded),
      reference: maskReference(row.payu_mihpayid),
    })),
    totals: {
      date: 'Total',
      order: '',
      channel: '',
      method: '',
      status: '',
      state: '',
      expected,
      recorded,
      refunded,
      reference: '',
    },
    stats: [
      { label: 'Matched', value: matched, format: 'int' },
      { label: 'Unmatched', value: unmatched, format: 'int' },
      { label: 'Failed', value: failed, format: 'int' },
      { label: 'Gateway captured', value: number(first.gateway_sum), format: 'money' },
      { label: 'POS recorded', value: number(first.pos_sum), format: 'money' },
      { label: 'Refunded', value: refunded, format: 'money' },
    ],
    note:
      'Matched: a PAID order whose recorded payments equal its total (or that carries a gateway reference and is not recorded above its total), or a zero-value sale. ' +
      'Unmatched: a PAID order that is underpaid or has no money attached, or money or a gateway attempt on an order that is not paid. ' +
      'Failed: a failed or cancelled order whose payment was never captured. ' +
      `Open rows (${open}) have a payment attempt but no captured money yet. Expected is the order total for PAID orders and zero for the rest, so the rows add up to the total. ` +
      'Recorded money comes from manual and POS payment rows marked PAID; PayU marks the order paid without writing one. ' +
      `Dates are the order date in the store timezone (${filters.timeZone}).`,
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------- expenses */

async function expenseReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const [rows, summaryRows, topRows] = await Promise.all([
    sql`
      select
        e.spent_on,
        coalesce(c.name, 'Uncategorised') as category_name,
        count(*)::int as entries,
        coalesce(sum(e.amount_paise), 0)::bigint as total
      from expenses e
      left join expense_categories c on c.id = e.category_id
      where e.deleted_at is null
        and e.spent_on >= ${filters.fromDay}::date
        and e.spent_on <= ${filters.toDay}::date
        and (${filters.categoryId}::text is null or e.category_id = ${filters.categoryId}::text)
      group by e.spent_on, coalesce(c.name, 'Uncategorised')
      order by e.spent_on desc, total desc
      limit ${filters.rowLimit + 1}
    `,
    sql`
      select
        count(*)::int as entries,
        coalesce(sum(e.amount_paise), 0)::bigint as total,
        count(distinct e.spent_on)::int as active_days
      from expenses e
      where e.deleted_at is null
        and e.spent_on >= ${filters.fromDay}::date
        and e.spent_on <= ${filters.toDay}::date
        and (${filters.categoryId}::text is null or e.category_id = ${filters.categoryId}::text)
    `,
    sql`
      select coalesce(c.name, 'Uncategorised') as category_name,
             coalesce(sum(e.amount_paise), 0)::bigint as total
      from expenses e
      left join expense_categories c on c.id = e.category_id
      where e.deleted_at is null
        and e.spent_on >= ${filters.fromDay}::date
        and e.spent_on <= ${filters.toDay}::date
        and (${filters.categoryId}::text is null or e.category_id = ${filters.categoryId}::text)
      group by 1
      order by total desc
      limit 1
    `,
  ]);

  const summary = (summaryRows as Row[])[0] ?? {};
  const top = (topRows as Row[])[0];
  const total = number(summary.total);
  const cut = capped(rows as Row[], filters);

  return {
    columns: [
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'category', label: 'Category' },
      { key: 'entries', label: 'Entries', format: 'int', align: 'right' },
      { key: 'total', label: 'Amount', format: 'money', align: 'right' },
    ],
    rows: cut.rows.map((row) => ({
      date: iso(row.spent_on),
      category: text(row.category_name),
      entries: number(row.entries),
      total: number(row.total),
    })),
    totals: {
      date: 'Total',
      category: '',
      entries: number(summary.entries),
      total,
    },
    stats: [
      { label: 'Expenses', value: total, format: 'money' },
      { label: 'Entries', value: number(summary.entries), format: 'int' },
      {
        label: 'Largest category',
        value: top ? text(top.category_name) : '—',
        hint: top ? `Across ${number(summary.active_days)} days with entries` : undefined,
      },
      {
        label: 'Average per day',
        value: average(total, number(summary.active_days)),
        format: 'money',
      },
    ],
    note:
      'Only live ledger entries count; deleted entries stay in the audit trail but are excluded here. ' +
      'Open the Expense ledger for individual entries, notes and receipts.',
    truncated: cut.truncated,
  };
}

/* ---------------------------------------------------------------- stock */

interface StockRow extends Row {
  product_id: unknown;
  product: string;
  category: string;
  brand: string;
  on_hand: number;
  reserved: number;
  available: number;
  threshold: number;
  tracked: boolean;
  cost: number | null;
  price: number;
}

async function stockRows(sql: Sql, filters: ReportFilters): Promise<Row[]> {
  return await sql.unsafe(`with ${INVENTORY_REPORT_CTE}
    select i.*, coalesce(c.name, 'Uncategorised') as category_name,
      coalesce(b.name, '—') as brand_name, i.low_stock_threshold as threshold,
      (select to_char((max(m.created_at) at time zone $3::text), 'YYYY-MM-DD') from stock_movements m
        where m.product_id=i.product_id and m.variant_id is not distinct from i.variant_id) as last_moved
    from inventory i
    left join categories c on c.id=i.category_id and c.deleted_at is null
    left join brands b on b.id=i.brand_id and b.deleted_at is null
    where ($1::text is null or i.category_id=$1) and ($2::text is null or i.brand_id=$2)
    order by i.name, i.product_id, i.variant_id nulls first limit ${SCAN_LIMIT}`,
    [filters.categoryId, filters.brandId, filters.timeZone]) as Row[];
}

function mapStockRow(row: Row): StockRow {
  const onHand = number(row.on_hand);
  const reserved = number(row.reserved);
  return {
    ...row,
    product_id: row.product_id,
    product: inventoryReportLabel(row),
    category: text(row.category_name) || 'Uncategorised',
    brand: text(row.brand_name) || '—',
    on_hand: onHand,
    reserved,
    available: onHand - reserved,
    threshold: number(row.threshold),
    tracked: row.track_inventory === true || text(row.track_inventory) === 'true',
    cost: nullableNumber(row.cost_paise),
    price: number(row.price_paise),
  };
}

// Product-mode reports retain recorded balances even when tracking is disabled.
// Variant-mode sellable totals exclude untracked variants and retained parents.
function countsRecordedStock(row: StockRow): boolean {
  return row.inventory_bucket === 'product' ||
    (row.inventory_bucket !== 'retained_legacy' && row.tracked);
}

async function stockReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const raw = await stockRows(sql, filters);
  const mapped = raw.map(mapStockRow);
  const cut = capped(raw, filters);
  const rows = mapped.slice(0, filters.rowLimit);

  let onHand = 0;
  let reserved = 0;
  let costValue = 0;
  let retailValue = 0;
  let costedUnits = 0;
  for (const row of mapped) {
    if (!countsRecordedStock(row)) continue;
    onHand += row.on_hand;
    reserved += row.reserved;
    retailValue += row.price * row.on_hand;
    if (row.cost !== null) {
      costValue += row.cost * row.on_hand;
      costedUnits += row.on_hand;
    }
  }
  const costed = mapped.filter((row) => countsRecordedStock(row) && row.cost !== null).length;
  const low = mapped.filter((row) => row.inventory_bucket !== 'retained_legacy' && row.tracked && row.available <= row.threshold).length;

  return {
    columns: [
      { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' },
      { key: 'variantSku', label: 'Variant SKU' },
      { key: 'inventoryBucket', label: 'Inventory bucket' },
      { key: 'inventoryStatus', label: 'Inventory status' },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'onHand', label: 'In stock', format: 'int', align: 'right' },
      { key: 'reserved', label: 'Held in checkouts', format: 'int', align: 'right' },
      { key: 'available', label: 'Available to buy', format: 'int', align: 'right' },
      { key: 'threshold', label: 'Warn me when below', format: 'int', align: 'right' },
      { key: 'unitCost', label: 'Unit cost', format: 'money', align: 'right' },
      { key: 'costValue', label: 'Value at cost', format: 'money', align: 'right' },
      { key: 'unitPrice', label: 'Unit price', format: 'money', align: 'right' },
      { key: 'retailValue', label: 'Value at retail', format: 'money', align: 'right' },
    ],
    rows: rows.map((row) => {
      const showBalance = countsRecordedStock(row) || row.inventory_bucket === 'retained_legacy';
      return {
        product: row.product,
        productId: nullableText(row.product_id),
        variantSku: nullableText(row.variant_sku),
        inventoryBucket: text(row.inventory_bucket),
        inventoryStatus: row.variant_id && !row.stock_id ? 'Missing stock configuration' : row.tracked ? 'Limited' : 'Not limited',
        category: row.category,
        brand: row.brand,
        onHand: showBalance ? row.on_hand : null,
        reserved: showBalance ? row.reserved : null,
        available: showBalance ? row.available : null,
        threshold: row.tracked ? row.threshold : null,
        unitCost: row.cost,
        costValue: showBalance && row.cost !== null ? row.cost * row.on_hand : null,
        unitPrice: row.price,
        retailValue: showBalance ? row.price * row.on_hand : null,
      };
    }),
    totals: {
      product: 'Total',
      category: '',
      brand: '',
      onHand,
      reserved,
      available: onHand - reserved,
      threshold: '',
      unitCost: '',
      costValue: costed > 0 ? costValue : null,
      unitPrice: '',
      retailValue,
    },
    stats: [
      { label: 'Units in stock', value: onHand, format: 'int' },
      { label: 'Value at retail', value: retailValue, format: 'money' },
      {
        label: 'Value at cost',
        value: costed > 0 ? costValue : null,
        format: 'money',
        hint: `${costed} of ${mapped.length} products have a cost set`,
      },
      {
        label: 'Products costed',
        value: costed,
        format: 'int',
        hint: `${costedUnits} units carry a cost`,
      },
      { label: 'Low stock', value: low, format: 'int', hint: 'Stock-limited items at or below warning level' },
    ],
    note:
      'Value at cost only counts products with a cost set — a missing cost is left blank rather than treated as zero. ' +
      'Product-level totals include recorded balances even when stock is not limited. Each sellable variant has its exact stock key; variants without stock limits and retained legacy parent balances are excluded from totals.',
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------ low stock */

async function lowStockReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const raw = (await stockRows(sql, filters)).filter((row) =>
    row.inventory_bucket !== 'retained_legacy' && row.track_inventory === true &&
    number(row.on_hand) - number(row.reserved) <= number(row.threshold)
  ).sort((a,b) => number(a.on_hand)-number(a.reserved)-number(b.on_hand)+number(b.reserved));


  const cut = capped(raw, filters);
  const allRows = raw.map((row) => {
    const onHand = number(row.on_hand);
    const reserved = number(row.reserved);
    const available = onHand - reserved;
    const threshold = number(row.threshold);
    return {
      product: inventoryReportLabel(row),
      variantSku: nullableText(row.variant_sku),
      inventoryBucket: text(row.inventory_bucket),
      productId: nullableText(row.product_id),
      category: text(row.category_name) || 'Uncategorised',
      brand: text(row.brand_name) || '—',
      onHand,
      reserved,
      available,
      threshold,
      reorder: Math.max(threshold * 2 - available, 1),
      lastMoved: iso(row.last_moved),
    };
  });
  const rows = allRows.slice(0, filters.rowLimit);

  const outOfStock = allRows.filter((row) => row.available <= 0).length;
  const reorderUnits = allRows.reduce((sum, row) => sum + row.reorder, 0);

  return {
    columns: [
      { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' },
      { key: 'variantSku', label: 'Variant SKU' },
      { key: 'inventoryBucket', label: 'Inventory bucket' },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'onHand', label: 'In stock', format: 'int', align: 'right' },
      { key: 'reserved', label: 'Held in checkouts', format: 'int', align: 'right' },
      { key: 'available', label: 'Available to buy', format: 'int', align: 'right' },
      { key: 'threshold', label: 'Warn me when below', format: 'int', align: 'right' },
      { key: 'reorder', label: 'Suggested reorder', format: 'int', align: 'right' },
      { key: 'lastMoved', label: 'Last movement', format: 'date' },
    ],
    rows,
    totals: {
      product: 'Total',
      category: '',
      brand: '',
      onHand: allRows.reduce((sum, row) => sum + row.onHand, 0),
      reserved: allRows.reduce((sum, row) => sum + row.reserved, 0),
      available: allRows.reduce((sum, row) => sum + row.available, 0),
      threshold: '',
      reorder: reorderUnits,
      lastMoved: '',
    },
    stats: [
      { label: 'Items low', value: allRows.length, format: 'int' },
      { label: 'Out of stock', value: outOfStock, format: 'int' },
      { label: 'Units to reorder', value: reorderUnits, format: 'int' },
    ],
    note:
      'Only products with stock limits appear. Suggested reorder is twice the warning level minus what is available to buy, with a floor of one unit. ' +
      'Quantities change through receipts, sales, returns and adjustments, so this table is read-only.',
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------ customers */

async function customerReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const [rows, summaryRows] = await Promise.all([
    sql`
      with buyers as (
        select
          coalesce(o.user_id, case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end) as buyer_key,
          max(o.user_id) as user_id,
          max(
            case
              when u.id is null then 'Guest checkout'
              else nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
            end
          ) as account_name,
          max(coalesce(u.email, o.customer_email)) as email,
          max(o.customer_name) as order_name,
          count(*)::int as orders,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue,
          to_char((min(o.created_at) at time zone ${filters.timeZone}::text), 'YYYY-MM-DD') as first_order_at,
          to_char((max(o.created_at) at time zone ${filters.timeZone}::text), 'YYYY-MM-DD') as last_order_at
        from orders o
        left join users u on u.id = o.user_id
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at >= ${filters.fromIso}::timestamptz
          and o.created_at < ${filters.toIso}::timestamptz
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
          )
        group by coalesce(o.user_id, case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end)
      ),
      prior as (
        select
          coalesce(o.user_id, case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end) as buyer_key,
          count(*)::int as prior_orders
        from orders o
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at < ${filters.fromIso}::timestamptz
        group by 1
      )
      select
        b.buyer_key, b.user_id, b.account_name, b.email, b.order_name, b.orders,
        b.revenue, b.first_order_at, b.last_order_at,
        coalesce(pr.prior_orders, 0)::int as prior_orders,
        (coalesce(pr.prior_orders, 0) = 0) as is_new
      from buyers b
      left join prior pr on pr.buyer_key = b.buyer_key
      order by b.revenue desc, b.orders desc
      limit ${filters.rowLimit + 1}
    `,
    sql`
      with buyers as (
        select
          coalesce(o.user_id, case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end) as buyer_key,
          max(o.user_id) as user_id,
          count(*)::int as orders,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)), 0)::bigint as revenue
        from orders o
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at >= ${filters.fromIso}::timestamptz
          and o.created_at < ${filters.toIso}::timestamptz
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(o.channel, ''), 'web') = ${filters.channel}::text
          )
        group by coalesce(o.user_id, case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end)
      ),
      prior as (
        select
          coalesce(o.user_id, case when o.customer_email <> '' then 'guest:' || lower(o.customer_email) else 'order:' || o.id end) as buyer_key,
          count(*)::int as prior_orders
        from orders o
        where o.status = 'PAID'
          and o.fulfilment_status <> 'CANCELED'
          and o.created_at < ${filters.fromIso}::timestamptz
        group by 1
      )
      select
        count(*)::int as buyers,
        count(*) filter (where coalesce(pr.prior_orders, 0) = 0)::int as new_buyers,
        count(*) filter (where coalesce(pr.prior_orders, 0) > 0)::int as returning_buyers,
        count(*) filter (where b.orders > 1)::int as repeat_buyers,
        count(*) filter (where b.user_id is null)::int as guest_buyers,
        count(*) filter (where b.user_id is not null)::int as registered_buyers,
        coalesce(sum(b.orders), 0)::int as orders,
        coalesce(sum(b.revenue), 0)::bigint as revenue
      from buyers b
      left join prior pr on pr.buyer_key = b.buyer_key
    `,
  ]);

  const summary = (summaryRows as Row[])[0] ?? {};
  const cut = capped(rows as Row[], filters);
  const buyers = number(summary.buyers);

  return {
    columns: [
      { key: 'customer', label: 'Customer', link: 'customer', linkKey: 'customerId' },
      { key: 'email', label: 'Email' },
      { key: 'type', label: 'Type' },
      { key: 'orders', label: 'Orders', format: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', format: 'money', align: 'right' },
      { key: 'average', label: 'Average order', format: 'money', align: 'right' },
      { key: 'firstOrder', label: 'First order', format: 'date' },
      { key: 'lastOrder', label: 'Last order', format: 'date' },
    ],
    rows: cut.rows.map((row) => {
      const name = text(row.account_name) || text(row.order_name);
      return {
        customer: row.user_id === null ? 'Guest checkout' : maskCustomerName(name),
        customerId: nullableText(row.user_id),
        email: maskCustomerEmail(text(row.email)),
        type: row.user_id === null ? 'Guest' : 'Registered',
        orders: number(row.orders),
        revenue: number(row.revenue),
        average: average(number(row.revenue), number(row.orders)),
        firstOrder: nullableText(row.first_order_at),
        lastOrder: nullableText(row.last_order_at),
      };
    }),
    totals: {
      customer: 'Total',
      email: '',
      type: '',
      orders: number(summary.orders),
      revenue: number(summary.revenue),
      average: average(number(summary.revenue), number(summary.orders)),
      firstOrder: '',
      lastOrder: '',
    },
    stats: [
      { label: 'Buyers', value: buyers, format: 'int' },
      { label: 'New buyers', value: number(summary.new_buyers), format: 'int', hint: 'No captured order before this range' },
      { label: 'Returning buyers', value: number(summary.returning_buyers), format: 'int' },
      {
        label: 'Repeat rate',
        value: pct(number(summary.repeat_buyers), buyers),
        format: 'int',
        hint: `${number(summary.repeat_buyers)} buyers with more than one order`,
      },
      { label: 'Guest buyers', value: number(summary.guest_buyers), format: 'int' },
      { label: 'Registered buyers', value: number(summary.registered_buyers), format: 'int' },
    ],
    note:
      'A buyer is an account when signed in, otherwise the checkout email; a sale with no email (a walk-in) is its own buyer. New means no captured order before the range starts. ' +
      'Names and emails are masked; open the customer to use the audited reveal.',
    truncated: cut.truncated,
  };
}

/* --------------------------------------------------- category and brand */

async function categoryReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const [categoryRows, brandRows, summaryRows] = await Promise.all([
    sql`
      select
        coalesce(c.name, 'Uncategorised') as name,
        count(distinct o.id)::int as orders,
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      left join categories c on c.id = p.category_id and c.deleted_at is null
      where o.status = 'PAID'
        and o.fulfilment_status <> 'CANCELED'
        and o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
      group by coalesce(c.name, 'Uncategorised')
      order by revenue desc
      limit ${SCAN_LIMIT}
    `,
    sql`
      select
        coalesce(b.name, 'No brand') as name,
        count(distinct o.id)::int as orders,
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      left join brands b on b.id = p.brand_id and b.deleted_at is null
      where o.status = 'PAID'
        and o.fulfilment_status <> 'CANCELED'
        and o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
      group by coalesce(b.name, 'No brand')
      order by revenue desc
      limit ${SCAN_LIMIT}
    `,
    sql`
      select
        coalesce(sum(oi.line_total_paise - oi.discount_paise), 0)::bigint as revenue,
        coalesce(sum(oi.quantity), 0)::int as units,
        count(distinct o.id)::int as orders
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      where o.status = 'PAID'
        and o.fulfilment_status <> 'CANCELED'
        and o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
    `,
  ]);

  const summary = (summaryRows as Row[])[0] ?? {};
  const totalRevenue = number(summary.revenue);
  const totalUnits = number(summary.units);
  const totalOrders = number(summary.orders);

  const lines = [
    ...(categoryRows as Row[]).map((row) => ({ scope: 'Category', row })),
    ...(brandRows as Row[]).map((row) => ({ scope: 'Brand', row })),
  ];
  const truncated = lines.length > filters.rowLimit;
  const rows = lines.slice(0, filters.rowLimit).map(({ scope, row }) => {
    const revenue = number(row.revenue);
    return {
      scope,
      name: text(row.name),
      orders: number(row.orders),
      units: number(row.units),
      revenue,
      share: pct(revenue, totalRevenue),
    };
  });

  return {
    columns: [
      { key: 'scope', label: 'Group' },
      { key: 'name', label: 'Name' },
      { key: 'orders', label: 'Orders', format: 'int', align: 'right' },
      { key: 'units', label: 'Units', format: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', format: 'money', align: 'right' },
      { key: 'share', label: 'Share %', format: 'int', align: 'right' },
    ],
    rows,
    totals: {
      scope: 'Total',
      name: '',
      orders: totalOrders,
      units: totalUnits,
      revenue: totalRevenue,
      share: totalRevenue > 0 ? 100 : null,
    },
    stats: [
      { label: 'Revenue', value: totalRevenue, format: 'money' },
      { label: 'Units', value: totalUnits, format: 'int' },
      { label: 'Orders', value: totalOrders, format: 'int' },
      { label: 'Categories', value: (categoryRows as Row[]).length, format: 'int' },
      { label: 'Brands', value: (brandRows as Row[]).length, format: 'int' },
    ],
    note:
      'Both rollups use the same captured orders and filters. Revenue is line revenue after discount, so it excludes shipping. ' +
      'Share is of the filtered revenue, so with a category filter selected the share is within that category.',
    truncated,
  };
}

/* -------------------------------------------------------------- dispatch */

export async function getReport(
  key: ReportKey,
  filters: ReportFilters,
): Promise<ReportLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    let data: ReportData;
    switch (key) {
      case 'orders':
        data = await orderReport(sql, filters);
        break;
      case 'items':
        data = await itemReport(sql, filters);
        break;
      case 'daily':
        data = await dailyReport(sql, filters);
        break;
      case 'transactions':
        data = await transactionReport(sql, filters);
        break;
      case 'reconciliation':
        data = await reconciliationReport(sql, filters);
        break;
      case 'expenses':
        data = await expenseReport(sql, filters);
        break;
      case 'stock':
        data = await stockReport(sql, filters);
        break;
      case 'low-stock':
        data = await lowStockReport(sql, filters);
        break;
      case 'customers':
        data = await customerReport(sql, filters);
        break;
      case 'categories':
        data = await categoryReport(sql, filters);
        break;
    }
    return { ok: true, data };
  } catch {
    console.warn(`[store-admin/reports] could not build the ${key} report`);
    return { ok: false, reason: 'unavailable' };
  }
}

/** Re-exported so pages and routes take both from one module. */
export { loadReportFilters } from './store-clock';

/** Re-exported so the export route and the page agree on formatting. */
export type { ReportColumnFormat, ReportData, ReportRow, ReportStat };

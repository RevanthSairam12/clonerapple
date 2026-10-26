import { getSql } from '@/lib/admin/db';

import { maskCustomerEmail } from './masking';
import { maskCustomerName } from './orders';
import {
  REPORT_ROW_LIMIT,
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
 * - A **captured sale** is `status = 'PAID'` with fulfilment not `CANCELED`.
 *   Revenue, units, AOV and sell-through use exactly that predicate.
 * - A **refund** is attributed to the day it was recorded, not the order date,
 *   except in the order report where it is bucketed with the order the filters
 *   selected. Both statements appear in the note under the matching table.
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

function capped(rows: Row[]): { rows: Row[]; truncated: boolean } {
  return {
    rows: rows.slice(0, REPORT_ROW_LIMIT),
    truncated: rows.length > REPORT_ROW_LIMIT,
  };
}

/* --------------------------------------------------------------- orders */

async function orderReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const group = filters.groupBy;
  const step = group === 'day' ? '1 day' : group === 'week' ? '1 week' : '1 month';
  const labelFormat = group === 'month' ? 'Mon YYYY' : 'DD Mon YYYY';

  const [rows, summaryRows] = await Promise.all([
    sql`
      with buckets as (
        select generate_series(
          date_trunc(${group}, ${filters.fromIso}::timestamptz at time zone 'UTC'),
          date_trunc(
            ${group},
            (${filters.toIso}::timestamptz - interval '1 millisecond') at time zone 'UTC'
          ),
          ${step}::interval
        ) as bucket
      ),
      ord as (
        select
          date_trunc(${group}, o.created_at at time zone 'UTC') as bucket,
          count(*)::int as orders,
          count(*) filter (
            where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
          )::int as paid_orders,
          count(*) filter (where o.status = 'CANCELLED')::int as cancelled_orders,
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
          date_trunc(${group}, uo.created_at at time zone 'UTC') as bucket,
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
          date_trunc(${group}, r.created_at at time zone 'UTC') as bucket,
          coalesce(sum(r.amount_paise), 0)::bigint as refunds
        from refunds r
        join orders ro on ro.id = r.order_id
        where r.created_at >= ${filters.fromIso}::timestamptz
          and r.created_at < ${filters.toIso}::timestamptz
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
      limit ${REPORT_ROW_LIMIT + 1}
    `,
    sql`
      select
        count(*)::int as orders,
        count(*) filter (
          where o.status = 'PAID' and o.fulfilment_status <> 'CANCELED'
        )::int as paid_orders,
        count(*) filter (where o.status = 'CANCELLED')::int as cancelled_orders,
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
  const cut = capped(rows as Row[]);

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
      'Captured revenue counts PAID orders that were not cancelled, matching the Sales list. ' +
      'Refunds are shown in the bucket they were recorded in and follow the status and channel filters.',
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------- day-wise */

async function dailyReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
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
          (o.created_at at time zone 'UTC')::date as day,
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
          (u.created_at at time zone 'UTC')::date as day,
          count(*)::int as new_customers
        from users u
        where u.created_at >= ${filters.fromIso}::timestamptz
          and u.created_at < ${filters.toIso}::timestamptz
        group by 1
      ),
      ref as (
        select
          (r.created_at at time zone 'UTC')::date as day,
          coalesce(sum(r.amount_paise), 0)::bigint as refunds
        from refunds r
        join orders ro on ro.id = r.order_id
        where r.created_at >= ${filters.fromIso}::timestamptz
          and r.created_at < ${filters.toIso}::timestamptz
          and (
            ${filters.channel}::text = 'all'
            or coalesce(nullif(ro.channel, ''), 'web') = ${filters.channel}::text
          )
        group by 1
      )
      select
        d.day,
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
      limit ${REPORT_ROW_LIMIT + 1}
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
  const cut = capped(rows as Row[]);

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
        day: iso(row.day),
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
      'One row per UTC day, zero-filled. Revenue counts captured orders; refunds are on the day they were recorded. ' +
      'New customers are storefront accounts created that day.',
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------ item-wise */

async function itemReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const [itemRows, returnRows, summaryRows] = await Promise.all([
    sql`
      select
        p.id as product_id,
        coalesce(p.name, max(oi.product_name)) as name,
        max(c.name) as category_name,
        max(b.name) as brand_name,
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise), 0)::bigint as revenue,
        count(distinct o.id)::int as orders,
        max(s.on_hand - s.reserved) as available,
        coalesce(bool_or(s.track_inventory), false) as track_inventory
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = split_part(oi.product_id, '::', 1)
      left join categories c on c.id = p.category_id and c.deleted_at is null
      left join brands b on b.id = p.brand_id and b.deleted_at is null
      left join stock s on s.product_id = p.id and s.variant_id is null
      where o.status = 'PAID'
        and o.fulfilment_status <> 'CANCELED'
        and o.created_at >= ${filters.fromIso}::timestamptz
        and o.created_at < ${filters.toIso}::timestamptz
        and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
        and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
      group by p.id
      order by revenue desc, units desc
      limit ${REPORT_ROW_LIMIT + 1}
    `,
    sql`
      select
        split_part(oi.product_id, '::', 1) as product_id,
        coalesce(sum(ri.quantity), 0)::int as returned
      from return_items ri
      join return_requests rr on rr.id = ri.return_id
      join order_items oi on oi.id = ri.order_item_id
      where rr.created_at >= ${filters.fromIso}::timestamptz
        and rr.created_at < ${filters.toIso}::timestamptz
        and rr.status in ('APPROVED', 'RECEIVED', 'REFUNDED')
      group by 1
    `,
    sql`
      select
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise), 0)::bigint as revenue,
        count(distinct o.id)::int as orders,
        count(distinct oi.product_id)::int as products
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
    returnedByProduct.set(text(row.product_id), number(row.returned));
  }

  const summary = (summaryRows as Row[])[0] ?? {};
  const summaryUnits = number(summary.units);
  const cut = capped(itemRows as Row[]);

  const allRows: ReportRow[] = (itemRows as Row[]).map((row) => {
    const units = number(row.units);
    const returned = returnedByProduct.get(text(row.product_id)) ?? 0;
    const available = nullableNumber(row.available);
    const tracked = row.track_inventory === true || text(row.track_inventory) === 'true';
    return {
      product: text(row.name) || '(unnamed product)',
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
  const rows = allRows.slice(0, REPORT_ROW_LIMIT);

  const revenue = number(summary.revenue);

  return {
    columns: [
      { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'units', label: 'Units sold', format: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', format: 'money', align: 'right' },
      { key: 'orders', label: 'Orders', format: 'int', align: 'right' },
      { key: 'returned', label: 'Returned', format: 'int', align: 'right' },
      { key: 'returnRate', label: 'Return rate %', format: 'int', align: 'right' },
      { key: 'available', label: 'Available', format: 'int', align: 'right' },
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
      'Sell-through is units sold divided by units sold plus available stock, and is blank when inventory is not tracked.',
    truncated: cut.truncated,
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

async function statementLines(sql: Sql, filters: ReportFilters): Promise<Row[]> {
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
        coalesce(nullif(o.payment_method, ''), nullif(o.payu_mode, ''), 'payu'),
        o.status,
        coalesce(o.total_paise, round(o.amount * 100)::bigint),
        coalesce(o.payu_mihpayid, '')
      from orders o
      where o.status = 'PAID'
        and not exists (select 1 from order_payments p where p.order_id = o.id)
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
    select *
    from lines
    where (${filters.channel}::text = 'all' or channel = ${filters.channel}::text)
    order by recorded_at desc, txnid desc
    limit ${REPORT_ROW_LIMIT + 1}
  `) as Row[];
}

async function transactionReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const rows = await statementLines(sql, filters);
  const cut = capped(rows);
  const lines: StatementLine[] = cut.rows.map((row) => ({
    recordedAt: iso(row.recorded_at) ?? '',
    kind: text(row.kind) === 'Refund' ? 'Refund' : 'Payment',
    txnid: text(row.txnid),
    channel: text(row.channel),
    method: text(row.method),
    status: text(row.status),
    amountPaise: number(row.amount_paise),
    reference: text(row.reference),
  }));

  // Totals for the whole filtered set, not just the capped page.
  const summaryRows = (await sql`
    with lines as (
      select
        coalesce(p.paid_at, p.created_at) as recorded_at,
        'Payment'::text as kind,
        case when o.channel = 'pos' then 'pos' else 'web' end as channel,
        p.status,
        p.amount_paise
      from order_payments p
      join orders o on o.id = p.order_id
      where coalesce(p.paid_at, p.created_at) >= ${filters.fromIso}::timestamptz
        and coalesce(p.paid_at, p.created_at) < ${filters.toIso}::timestamptz
      union all
      select
        coalesce(o.paid_at, o.created_at),
        'Payment'::text,
        case when o.channel = 'pos' then 'pos' else 'web' end,
        o.status,
        coalesce(o.total_paise, round(o.amount * 100)::bigint)
      from orders o
      where o.status = 'PAID'
        and not exists (select 1 from order_payments p where p.order_id = o.id)
        and coalesce(o.paid_at, o.created_at) >= ${filters.fromIso}::timestamptz
        and coalesce(o.paid_at, o.created_at) < ${filters.toIso}::timestamptz
      union all
      select
        r.created_at,
        'Refund'::text,
        case when o.channel = 'pos' then 'pos' else 'web' end,
        r.status,
        -r.amount_paise
      from refunds r
      join orders o on o.id = r.order_id
      where r.created_at >= ${filters.fromIso}::timestamptz
        and r.created_at < ${filters.toIso}::timestamptz
    )
    select
      count(*) filter (
        where kind = 'Payment' and status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
      )::int as settled_count,
      count(*) filter (
        where kind = 'Payment' and status not in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
      )::int as unsettled_count,
      count(*) filter (where kind = 'Refund')::int as refund_count,
      coalesce(sum(amount_paise) filter (
        where kind = 'Payment' and status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
      ), 0)::bigint as money_in,
      coalesce(sum(-amount_paise) filter (where kind = 'Refund'), 0)::bigint as money_out
    from lines
    where (${filters.channel}::text = 'all' or channel = ${filters.channel}::text)
  `) as Row[];

  const summary = summaryRows[0] ?? {};
  const moneyIn = number(summary.money_in);
  const moneyOut = number(summary.money_out);

  return {
    columns: [
      { key: 'date', label: 'Date', format: 'date' },
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
      'Refund lines are negative and dated when they were recorded. Provider references keep only their last six characters; ' +
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
        coalesce(o.total_paise, round(o.amount * 100)::bigint)::bigint as expected,
        coalesce(p.recorded, 0)::bigint as recorded,
        coalesce(p.methods, '') as methods,
        coalesce(r.refunded, 0)::bigint as refunded,
        o.payu_mihpayid,
        o.created_at
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
          when status = 'PAID'
            and (payu_mihpayid is not null or recorded > 0)
            and recorded <= expected then 'MATCHED'
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
      payu_mihpayid, created_at,
      count(*) filter (where state = 'MATCHED') over () as matched_count,
      count(*) filter (where state = 'UNMATCHED') over () as unmatched_count,
      count(*) filter (where state = 'FAILED') over () as failed_count,
      count(*) filter (where state = 'OPEN') over () as open_count,
      coalesce(sum(expected) filter (where state in ('MATCHED', 'UNMATCHED')) over (), 0) as expected_sum,
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
    limit ${REPORT_ROW_LIMIT + 1}
  `) as Row[];

  const first = rows[0] ?? {};
  const matched = number(first.matched_count);
  const unmatched = number(first.unmatched_count);
  const failed = number(first.failed_count);
  const open = number(first.open_count);
  const expected = number(first.expected_sum);
  const recorded = number(first.recorded_sum);
  const refunded = number(first.refunded_sum);
  const cut = capped(rows);

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
      date: iso(row.created_at),
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
      'Matched: a PAID order with a gateway reference or recorded payment, not recorded above the order total. ' +
      'Unmatched: a PAID order with no money attached, or money recorded on an order that is not paid. ' +
      `Open rows (${open}) have a gateway attempt but no captured money yet and are excluded from the expected total. ` +
      'Recorded money comes from manual and POS payment rows; PayU marks the order paid without writing one.',
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
      limit ${REPORT_ROW_LIMIT + 1}
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
  const cut = capped(rows as Row[]);

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
  return (await sql`
    select
      p.id as product_id,
      p.name,
      coalesce(c.name, 'Uncategorised') as category_name,
      coalesce(b.name, '—') as brand_name,
      coalesce(s.on_hand, 0)::int as on_hand,
      coalesce(s.reserved, 0)::int as reserved,
      coalesce(s.low_stock_threshold, 0)::int as threshold,
      coalesce(s.track_inventory, false) as track_inventory,
      p.cost_paise,
      p.price_paise
    from products p
    left join categories c on c.id = p.category_id and c.deleted_at is null
    left join brands b on b.id = p.brand_id and b.deleted_at is null
    left join stock s on s.product_id = p.id and s.variant_id is null
    where p.deleted_at is null
      and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
      and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
    order by p.name
    limit ${REPORT_ROW_LIMIT + 1}
  `) as Row[];
}

function mapStockRow(row: Row): StockRow {
  const onHand = number(row.on_hand);
  const reserved = number(row.reserved);
  return {
    ...row,
    product_id: row.product_id,
    product: text(row.name) || '(unnamed product)',
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

async function stockReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const raw = await stockRows(sql, filters);
  const mapped = raw.map(mapStockRow);
  const cut = capped(raw);
  const rows = mapped.slice(0, REPORT_ROW_LIMIT);

  let onHand = 0;
  let reserved = 0;
  let costValue = 0;
  let retailValue = 0;
  let costedUnits = 0;
  for (const row of mapped) {
    onHand += row.on_hand;
    reserved += row.reserved;
    retailValue += row.price * row.on_hand;
    if (row.cost !== null) {
      costValue += row.cost * row.on_hand;
      costedUnits += row.on_hand;
    }
  }
  const costed = mapped.filter((row) => row.cost !== null).length;
  const low = mapped.filter((row) => row.tracked && row.available <= row.threshold).length;

  return {
    columns: [
      { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'onHand', label: 'On hand', format: 'int', align: 'right' },
      { key: 'reserved', label: 'Reserved', format: 'int', align: 'right' },
      { key: 'available', label: 'Available', format: 'int', align: 'right' },
      { key: 'threshold', label: 'Threshold', format: 'int', align: 'right' },
      { key: 'unitCost', label: 'Unit cost', format: 'money', align: 'right' },
      { key: 'costValue', label: 'Value at cost', format: 'money', align: 'right' },
      { key: 'unitPrice', label: 'Unit price', format: 'money', align: 'right' },
      { key: 'retailValue', label: 'Value at retail', format: 'money', align: 'right' },
    ],
    rows: rows.map((row) => ({
      product: row.product,
      productId: nullableText(row.product_id),
      category: row.category,
      brand: row.brand,
      onHand: row.on_hand,
      reserved: row.reserved,
      available: row.available,
      threshold: row.threshold,
      unitCost: row.cost,
      costValue: row.cost === null ? null : row.cost * row.on_hand,
      unitPrice: row.price,
      retailValue: row.price * row.on_hand,
    })),
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
      { label: 'Units on hand', value: onHand, format: 'int' },
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
      { label: 'Low stock', value: low, format: 'int', hint: 'Tracked items at or below threshold' },
    ],
    note:
      'Value at cost only counts products with a cost set — a missing cost is left blank rather than treated as zero. ' +
      'Quantities come from the product-level stock row; display variants do not carry stock.',
    truncated: cut.truncated,
  };
}

/* ------------------------------------------------------------ low stock */

async function lowStockReport(sql: Sql, filters: ReportFilters): Promise<ReportData> {
  const raw = (await sql`
    select
      p.id as product_id,
      p.name,
      coalesce(c.name, 'Uncategorised') as category_name,
      coalesce(b.name, '—') as brand_name,
      s.on_hand,
      s.reserved,
      s.low_stock_threshold,
      (s.on_hand - s.reserved) as available,
      m.last_moved
    from stock s
    join products p on p.id = s.product_id
    left join categories c on c.id = p.category_id and c.deleted_at is null
    left join brands b on b.id = p.brand_id and b.deleted_at is null
    left join (
      select product_id, max(created_at) as last_moved
      from stock_movements
      group by product_id
    ) m on m.product_id = p.id
    where s.variant_id is null
      and p.deleted_at is null
      and s.track_inventory
      and (s.on_hand - s.reserved) <= s.low_stock_threshold
      and (${filters.categoryId}::text is null or p.category_id = ${filters.categoryId}::text)
      and (${filters.brandId}::text is null or p.brand_id = ${filters.brandId}::text)
    order by (s.on_hand - s.reserved), p.name
    limit ${REPORT_ROW_LIMIT + 1}
  `) as Row[];

  const cut = capped(raw);
  const rows = cut.rows.map((row) => {
    const onHand = number(row.on_hand);
    const reserved = number(row.reserved);
    const available = number(row.available);
    const threshold = number(row.low_stock_threshold);
    return {
      product: text(row.name),
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

  const outOfStock = rows.filter((row) => row.available <= 0).length;
  const reorderUnits = rows.reduce((sum, row) => sum + row.reorder, 0);

  return {
    columns: [
      { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'onHand', label: 'On hand', format: 'int', align: 'right' },
      { key: 'reserved', label: 'Reserved', format: 'int', align: 'right' },
      { key: 'available', label: 'Available', format: 'int', align: 'right' },
      { key: 'threshold', label: 'Threshold', format: 'int', align: 'right' },
      { key: 'reorder', label: 'Suggested reorder', format: 'int', align: 'right' },
      { key: 'lastMoved', label: 'Last movement', format: 'date' },
    ],
    rows,
    totals: {
      product: 'Total',
      category: '',
      brand: '',
      onHand: rows.reduce((sum, row) => sum + row.onHand, 0),
      reserved: rows.reduce((sum, row) => sum + row.reserved, 0),
      available: rows.reduce((sum, row) => sum + row.available, 0),
      threshold: '',
      reorder: reorderUnits,
      lastMoved: '',
    },
    stats: [
      { label: 'Items low', value: rows.length, format: 'int' },
      { label: 'Out of stock', value: outOfStock, format: 'int' },
      { label: 'Units to reorder', value: reorderUnits, format: 'int' },
    ],
    note:
      'Only products that track inventory appear. Suggested reorder is twice the threshold minus what is available, with a floor of one unit. ' +
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
          coalesce(o.user_id, 'guest:' || lower(o.customer_email)) as buyer_key,
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
          min(o.created_at) as first_order_at,
          max(o.created_at) as last_order_at
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
        group by coalesce(o.user_id, 'guest:' || lower(o.customer_email))
      ),
      prior as (
        select
          coalesce(o.user_id, 'guest:' || lower(o.customer_email)) as buyer_key,
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
      limit ${REPORT_ROW_LIMIT + 1}
    `,
    sql`
      with buyers as (
        select
          coalesce(o.user_id, 'guest:' || lower(o.customer_email)) as buyer_key,
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
        group by coalesce(o.user_id, 'guest:' || lower(o.customer_email))
      ),
      prior as (
        select
          coalesce(o.user_id, 'guest:' || lower(o.customer_email)) as buyer_key,
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
  const cut = capped(rows as Row[]);
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
        firstOrder: iso(row.first_order_at),
        lastOrder: iso(row.last_order_at),
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
      'A buyer is an account when signed in, otherwise the checkout email. New means no captured order before the range starts. ' +
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
        coalesce(sum(oi.line_total_paise), 0)::bigint as revenue
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
      limit 501
    `,
    sql`
      select
        coalesce(b.name, 'No brand') as name,
        count(distinct o.id)::int as orders,
        coalesce(sum(oi.quantity), 0)::int as units,
        coalesce(sum(oi.line_total_paise), 0)::bigint as revenue
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
      limit 501
    `,
    sql`
      select
        coalesce(sum(oi.line_total_paise), 0)::bigint as revenue,
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
  const truncated = lines.length > REPORT_ROW_LIMIT;
  const rows = lines.slice(0, REPORT_ROW_LIMIT).map(({ scope, row }) => {
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
      'Both rollups use the same captured orders and filters. Share is of the filtered revenue, ' +
      'so with a category filter selected the share is within that category.',
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

/** Re-exported so the export route and the page agree on formatting. */
export type { ReportColumnFormat, ReportData, ReportRow, ReportStat };

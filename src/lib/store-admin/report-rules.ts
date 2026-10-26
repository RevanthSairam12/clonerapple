/**
 * Report vocabulary, filter parsing and the shared table/CSV shape.
 *
 * Pure — no database or Next.js imports. The queries live in `reports.ts`, the
 * expense ledger rules in `expense-rules.ts`.
 *
 * Every report renders through the same `ReportData` shape: columns describe
 * a cell's label and format, rows hold primitives, and an optional totals row
 * is printed under the table. The CSV export is generated from the same shape,
 * so a screen and its download cannot drift apart.
 */

import { formatPaise } from './amount';
import { toCsv } from './catalog-csv';
import { parseIsoDay } from './customer-rules';

/* ------------------------------------------------------------ catalogue */

export const REPORT_KEYS = [
  'orders',
  'items',
  'daily',
  'transactions',
  'reconciliation',
  'expenses',
  'stock',
  'low-stock',
  'customers',
  'categories',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export type ReportGroup = 'Sales' | 'Money' | 'Catalogue' | 'Customers';

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  description: string;
  group: ReportGroup;
  /** Offers day/week/month buckets. */
  groupBy: boolean;
  filters: {
    status: boolean;
    channel: boolean;
    category: boolean;
    brand: boolean;
  };
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    key: 'orders',
    title: 'Order report',
    description:
      'Orders, revenue, discounts, refunds and net, grouped by day, week or month with a status breakdown.',
    group: 'Sales',
    groupBy: true,
    filters: { status: true, channel: true, category: false, brand: false },
  },
  {
    key: 'items',
    title: 'Item-wise report',
    description:
      'Units sold, revenue, returns, return rate, current stock and sell-through per product.',
    group: 'Catalogue',
    groupBy: false,
    filters: { status: false, channel: false, category: true, brand: true },
  },
  {
    key: 'daily',
    title: 'Day-wise report',
    description:
      'Daily revenue, orders, AOV, new customers and refunds, one row per day.',
    group: 'Sales',
    groupBy: false,
    filters: { status: false, channel: true, category: false, brand: false },
  },
  {
    key: 'transactions',
    title: 'Transaction statement',
    description:
      'Every recorded payment and refund on one timeline, with order, method, reference and status.',
    group: 'Money',
    groupBy: false,
    filters: { status: false, channel: true, category: false, brand: false },
  },
  {
    key: 'reconciliation',
    title: 'Payment reconciliation',
    description:
      'PayU, manual and POS money side by side, with matched, unmatched and failed payments called out.',
    group: 'Money',
    groupBy: false,
    filters: { status: false, channel: false, category: false, brand: false },
  },
  {
    key: 'expenses',
    title: 'Expense report',
    description: 'Manual expense entries by category and date, with a category breakdown.',
    group: 'Money',
    groupBy: false,
    filters: { status: false, channel: false, category: true, brand: false },
  },
  {
    key: 'stock',
    title: 'Stock report',
    description:
      'On hand, reserved, available, and value at cost and retail for every stocked item.',
    group: 'Catalogue',
    groupBy: false,
    filters: { status: false, channel: false, category: true, brand: true },
  },
  {
    key: 'low-stock',
    title: 'Low-stock report',
    description:
      'Items at or below their threshold, with the last movement and a suggested reorder quantity.',
    group: 'Catalogue',
    groupBy: false,
    filters: { status: false, channel: false, category: true, brand: true },
  },
  {
    key: 'customers',
    title: 'Customer report',
    description:
      'New versus returning buyers, repeat rate, guest versus registered orders and the top customers.',
    group: 'Customers',
    groupBy: false,
    filters: { status: false, channel: false, category: false, brand: false },
  },
  {
    key: 'categories',
    title: 'Category and brand report',
    description: 'Revenue and units sold rolled up by category and by brand.',
    group: 'Catalogue',
    groupBy: false,
    filters: { status: false, channel: false, category: true, brand: true },
  },
];

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === 'string' && (REPORT_KEYS as readonly string[]).includes(value);
}

export function reportDefinition(key: ReportKey): ReportDefinition {
  const found = REPORTS.find((report) => report.key === key);
  if (!found) throw new Error(`Unknown report: ${key}`);
  return found;
}

/* -------------------------------------------------------------- filters */

export const ORDER_STATUSES = ['CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const REPORT_CHANNELS = ['web', 'pos'] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

export const REPORT_GROUP_BY = ['day', 'week', 'month'] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];

/** At most two years, so an accidental wide range cannot pin the database. */
export const MAX_REPORT_DAYS = 731;
export const DEFAULT_REPORT_DAYS = 30;

export interface ReportFilters {
  /** `YYYY-MM-DD`, inclusive. */
  fromDay: string;
  /** `YYYY-MM-DD`, inclusive. */
  toDay: string;
  /** Start of `fromDay`, UTC. */
  fromIso: string;
  /** Start of the day after `toDay` — the exclusive upper bound. */
  toIso: string;
  groupBy: ReportGroupBy;
  status: 'all' | OrderStatus;
  channel: 'all' | ReportChannel;
  categoryId: string | null;
  brandId: string | null;
}

export type ReportFilterParse =
  | { ok: true; filters: ReportFilters }
  | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Today at midnight UTC — the reports bucket on UTC days. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function defaultReportRange(now: Date = new Date()): { fromDay: string; toDay: string } {
  const today = todayUtc(now);
  return {
    fromDay: dayString(addDays(today, -(DEFAULT_REPORT_DAYS - 1))),
    toDay: dayString(today),
  };
}

export function parseReportFilters(
  params: Record<string, string | undefined>,
  now: Date = new Date(),
): ReportFilterParse {
  const defaults = defaultReportRange(now);

  const rawFrom = (params.from ?? '').trim();
  const rawTo = (params.to ?? '').trim();

  const fromDate = rawFrom ? parseIsoDay(rawFrom) : parseIsoDay(defaults.fromDay);
  if (!fromDate) return { ok: false, error: 'The start date is not a valid date.' };

  const toDate = rawTo ? parseIsoDay(rawTo) : parseIsoDay(defaults.toDay);
  if (!toDate) return { ok: false, error: 'The end date is not a valid date.' };

  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  if (spanDays > MAX_REPORT_DAYS) {
    return {
      ok: false,
      error: `Choose a range of ${MAX_REPORT_DAYS} days or fewer.`,
    };
  }

  const rawGroup = (params.group ?? '').trim().toLowerCase();
  const groupBy: ReportGroupBy = (REPORT_GROUP_BY as readonly string[]).includes(rawGroup)
    ? (rawGroup as ReportGroupBy)
    : spanDays > 62
      ? 'month'
      : 'day';

  const rawStatus = (params.status ?? '').trim().toUpperCase();
  const status: 'all' | OrderStatus = (ORDER_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as OrderStatus)
    : 'all';

  const rawChannel = (params.channel ?? '').trim().toLowerCase();
  const channel: 'all' | ReportChannel = (REPORT_CHANNELS as readonly string[]).includes(rawChannel)
    ? (rawChannel as ReportChannel)
    : 'all';

  const rawCategory = (params.category ?? '').trim();
  if (rawCategory && !ID_PATTERN.test(rawCategory)) {
    return { ok: false, error: 'That category filter is not valid.' };
  }

  const rawBrand = (params.brand ?? '').trim();
  if (rawBrand && !ID_PATTERN.test(rawBrand)) {
    return { ok: false, error: 'That brand filter is not valid.' };
  }

  return {
    ok: true,
    filters: {
      fromDay: dayString(fromDate),
      toDay: dayString(toDate),
      fromIso: fromDate.toISOString(),
      toIso: addDays(toDate, 1).toISOString(),
      groupBy,
      status,
      channel,
      categoryId: rawCategory || null,
      brandId: rawBrand || null,
    },
  };
}

/** Rebuild the query string for links: export buttons and the group toggle. */
export function reportQuery(
  filters: ReportFilters,
  overrides: Record<string, string | null> = {},
): string {
  const params = new URLSearchParams({
    from: filters.fromDay,
    to: filters.toDay,
  });
  if (filters.groupBy !== 'day') params.set('group', filters.groupBy);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.channel !== 'all') params.set('channel', filters.channel);
  if (filters.categoryId) params.set('category', filters.categoryId);
  if (filters.brandId) params.set('brand', filters.brandId);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

/* ---------------------------------------------------------- table shape */

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportColumnFormat = 'text' | 'int' | 'money' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  format?: ReportColumnFormat;
  align?: 'left' | 'right';
  /**
   * Render the cell as a link into the store admin. The target id comes from
   * `linkKey` on the row when given, otherwise from the cell's own value.
   */
  link?: 'order' | 'product' | 'customer';
  linkKey?: string;
}

export interface ReportStat {
  label: string;
  value: ReportCell;
  format?: ReportColumnFormat;
  hint?: string;
}

export interface ReportData {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  stats: ReportStat[];
  /** Shown under the table — definitions, caps and caveats. */
  note?: string;
  /** True when the query hit its row cap and the table is incomplete. */
  truncated?: boolean;
}

/** How many rows a report table will hold before it is cut off. */
export const REPORT_ROW_LIMIT = 500;

export function formatReportValue(value: ReportCell, format: ReportColumnFormat = 'text'): string {
  if (value === null || value === '') return '—';
  if (format === 'money') return formatPaise(Number(value));
  if (format === 'date') return String(value).slice(0, 10);
  if (format === 'int') {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('en-IN') : '—';
  }
  return String(value);
}

function csvValue(value: ReportCell, format: ReportColumnFormat): string {
  if (value === null) return '';
  if (format === 'money') return (Number(value) / 100).toFixed(2);
  // Timestamps are stored as full ISO strings; the screen and the CSV both
  // show the day, so a downloaded report matches what was reviewed on screen.
  if (format === 'date') return String(value).slice(0, 10);
  return String(value);
}

function linkSegment(link: NonNullable<ReportColumn['link']>): string {
  if (link === 'order') return 'orders';
  if (link === 'product') return 'products';
  return 'customers';
}

/** Route for a linked cell, or null when the row has no id to link to. */
export function reportHref(row: ReportRow, column: ReportColumn): string | null {
  if (!column.link) return null;
  const id = row[column.linkKey ?? column.key];
  if (id === null || id === undefined || id === '') return null;
  return `/store-admin/${linkSegment(column.link)}/${encodeURIComponent(String(id))}`;
}

/** CSV built from the same columns and rows the page renders. */
export function reportCsv(data: ReportData): string {
  const header = data.columns.map((column) => column.label);
  const body = data.rows.map((row) =>
    data.columns.map((column) => csvValue(row[column.key] ?? null, column.format ?? 'text')),
  );
  if (data.totals) {
    body.push(
      data.columns.map((column) =>
        csvValue(data.totals?.[column.key] ?? null, column.format ?? 'text'),
      ),
    );
  }
  return toCsv(header, body);
}

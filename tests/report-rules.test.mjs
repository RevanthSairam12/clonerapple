import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  DEFAULT_REPORT_DAYS,
  MAX_REPORT_DAYS,
  REPORTS,
  REPORT_KEYS,
  REPORT_ROW_LIMIT,
  defaultReportRange,
  formatReportValue,
  isReportKey,
  parseReportFilters,
  reportCsv,
  reportDefinition,
  reportHref,
  reportQuery,
} = await jiti.import('../src/lib/store-admin/report-rules.ts');

const NOW = new Date('2026-10-24T09:30:00.000Z');

test('the report catalogue covers exactly the ten planned reports', () => {
  assert.equal(REPORT_KEYS.length, 10);
  assert.equal(new Set(REPORT_KEYS).size, 10);
  assert.equal(REPORTS.length, 10);

  for (const key of REPORT_KEYS) {
    assert.equal(isReportKey(key), true);
    const definition = reportDefinition(key);
    assert.equal(definition.key, key);
    assert.ok(definition.title.length > 3);
    assert.ok(['Sales', 'Money', 'Catalogue', 'Customers'].includes(definition.group));
  }

  assert.equal(isReportKey('tax'), false);
  assert.equal(isReportKey(''), false);
  assert.equal(isReportKey(undefined), false);
});

test('the default range is the last 30 UTC days, both ends inclusive', () => {
  const range = defaultReportRange(NOW);
  assert.equal(range.toDay, '2026-10-24');
  assert.equal(range.fromDay, '2026-09-25');
  assert.equal(DEFAULT_REPORT_DAYS, 30);

  const parsed = parseReportFilters({}, NOW);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.fromDay, '2026-09-25');
  assert.equal(parsed.filters.toDay, '2026-10-24');
  assert.equal(parsed.filters.fromIso, '2026-09-25T00:00:00.000Z');
  // The upper bound is exclusive: the day after `to`.
  assert.equal(parsed.filters.toIso, '2026-10-25T00:00:00.000Z');
  assert.equal(parsed.filters.groupBy, 'day');
  assert.equal(parsed.filters.status, 'all');
  assert.equal(parsed.filters.channel, 'all');
  assert.equal(parsed.filters.categoryId, null);
  assert.equal(parsed.filters.brandId, null);
});

test('a single day is a valid range', () => {
  const parsed = parseReportFilters({ from: '2026-10-24', to: '2026-10-24' }, NOW);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.fromDay, '2026-10-24');
  assert.equal(parsed.filters.toIso, '2026-10-25T00:00:00.000Z');
});

test('ranges wider than 62 days default to monthly buckets', () => {
  const parsed = parseReportFilters({ from: '2026-01-01', to: '2026-06-30' }, NOW);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.groupBy, 'month');

  const short = parseReportFilters({ from: '2026-06-01', to: '2026-06-30' }, NOW);
  assert.equal(short.ok, true);
  assert.equal(short.filters.groupBy, 'day');

  const explicit = parseReportFilters(
    { from: '2026-01-01', to: '2026-06-30', group: 'week' },
    NOW,
  );
  assert.equal(explicit.ok, true);
  assert.equal(explicit.filters.groupBy, 'week');
});

test('bad ranges are rejected rather than clamped', () => {
  assert.equal(parseReportFilters({ from: '24-10-2026' }, NOW).ok, false);
  assert.equal(parseReportFilters({ to: '2026-02-30' }, NOW).ok, false);
  assert.equal(
    parseReportFilters({ from: '2026-10-24', to: '2026-10-23' }, NOW).ok,
    false,
  );

  const tooWide = parseReportFilters({ from: '2024-01-01', to: '2026-01-01' }, NOW);
  assert.equal(tooWide.ok, false);
  assert.match(tooWide.error, new RegExp(String(MAX_REPORT_DAYS)));

  const exactlyAtCap = parseReportFilters({ from: '2025-10-24', to: '2026-10-24' }, NOW);
  assert.equal(exactlyAtCap.ok, true);
});

test('unknown status and channel values fall back to all', () => {
  const parsed = parseReportFilters(
    { status: 'refunded', channel: 'app', group: 'year' },
    NOW,
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.status, 'all');
  assert.equal(parsed.filters.channel, 'all');
  assert.equal(parsed.filters.groupBy, 'day');

  const valid = parseReportFilters({ status: 'paid', channel: 'POS' }, NOW);
  assert.equal(valid.ok, true);
  assert.equal(valid.filters.status, 'PAID');
  assert.equal(valid.filters.channel, 'pos');
});

test('category and brand filters must look like ids', () => {
  const ok = parseReportFilters({ category: 'cases-protection' }, NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.filters.categoryId, 'cases-protection');

  const bad = parseReportFilters({ category: 'cases protection' }, NOW);
  assert.equal(bad.ok, false);

  const badBrand = parseReportFilters({ brand: 'a'.repeat(65) }, NOW);
  assert.equal(badBrand.ok, false);
});

test('reportQuery rebuilds the URL the export and paging links use', () => {
  const parsed = parseReportFilters(
    { from: '2026-10-01', to: '2026-10-07', status: 'PAID', channel: 'web' },
    NOW,
  );
  assert.equal(parsed.ok, true);

  assert.equal(
    reportQuery(parsed.filters),
    '?from=2026-10-01&to=2026-10-07&status=PAID&channel=web',
  );

  assert.equal(
    reportQuery(parsed.filters, { report: 'orders' }),
    '?from=2026-10-01&to=2026-10-07&status=PAID&channel=web&report=orders',
  );

  // null removes the key, which "Clear" and the group toggle rely on.
  assert.equal(
    reportQuery(parsed.filters, { status: null, page: '2' }),
    '?from=2026-10-01&to=2026-10-07&channel=web&page=2',
  );
});

test('money, integer, date and empty cells format for the table', () => {
  assert.equal(formatReportValue(349900, 'money'), '₹3,499.00');
  assert.equal(formatReportValue(-15000, 'money'), '-₹150.00');
  assert.equal(formatReportValue(1234567, 'int'), '12,34,567');
  assert.equal(formatReportValue('2026-10-24', 'date'), '2026-10-24');
  assert.equal(formatReportValue(null, 'money'), '—');
  assert.equal(formatReportValue('', 'text'), '—');
  assert.equal(formatReportValue('Matched'), 'Matched');
});

test('CSV is built from the same columns and rows as the screen', () => {
  const data = {
    columns: [
      { key: 'day', label: 'Day', format: 'date' },
      { key: 'orders', label: 'Orders', format: 'int' },
      { key: 'revenue', label: 'Revenue', format: 'money' },
    ],
    rows: [
      { day: '2026-10-23', orders: 3, revenue: 349900 },
      { day: '2026-10-24', orders: 1, revenue: 149900 },
    ],
    totals: { day: 'Total', orders: 4, revenue: 499800 },
    stats: [],
  };

  const csv = reportCsv(data);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Day,Orders,Revenue');
  assert.equal(lines[1], '2026-10-23,3,3499.00');
  assert.equal(lines[2], '2026-10-24,1,1499.00');
  assert.equal(lines[3], 'Total,4,4998.00');
});

test('CSV prints a timestamp date column as the same day the table shows', () => {
  const csv = reportCsv({
    columns: [{ key: 'day', label: 'Day', format: 'date' }],
    rows: [{ day: '2026-10-24T00:00:00.000Z' }],
    totals: null,
    stats: [],
  });
  assert.equal(csv, 'Day\r\n2026-10-24');
});

test('CSV keeps a signed refund line negative in rupees', () => {
  const csv = reportCsv({
    columns: [{ key: 'amount', label: 'Amount', format: 'money' }],
    rows: [{ amount: -59900 }],
    totals: null,
    stats: [],
  });
  assert.equal(csv, 'Amount\r\n-599.00');
});

test('linked cells resolve to store-admin routes and skip missing ids', () => {
  const orderColumn = { key: 'order', label: 'Order', link: 'order' };
  assert.equal(
    reportHref({ order: 'txn 1/2' }, orderColumn),
    '/store-admin/orders/txn%201%2F2',
  );

  const productColumn = { key: 'product', label: 'Product', link: 'product', linkKey: 'productId' };
  assert.equal(
    reportHref({ product: 'Some name', productId: 'pa-gadzio-20w-usbc' }, productColumn),
    '/store-admin/products/pa-gadzio-20w-usbc',
  );
  assert.equal(reportHref({ product: 'Unlinked', productId: null }, productColumn), null);

  assert.equal(reportHref({ order: 'txn' }, { key: 'order', label: 'Order' }), null);
});

test('the shared row cap is a bounded number', () => {
  assert.equal(REPORT_ROW_LIMIT, 500);
});

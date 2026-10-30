/**
 * Pure rules behind the report numbers: store-timezone days, the expense date
 * guard, per-report definitions and number formatting. No database needed; the
 * dataset checks live in reports-correctness-integration.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  DEFAULT_REPORT_TIME_ZONE,
  REPORTS,
  REPORT_EXPORT_ROW_LIMIT,
  REPORT_ROW_LIMIT,
  defaultReportRange,
  formatReportValue,
  normaliseTimeZone,
  parseReportFilters,
  reportCsv,
  storeDay,
  zonedDayStart,
} = await jiti.import('../src/lib/store-admin/report-rules.ts');
const { validateSpentOn } = await jiti.import('../src/lib/store-admin/expense-rules.ts');
const { formatPaise } = await jiti.import('../src/lib/store-admin/amount.ts');

test('a store day starts at local midnight, not UTC midnight', () => {
  assert.equal(DEFAULT_REPORT_TIME_ZONE, 'Asia/Kolkata');
  assert.equal(zonedDayStart('2026-04-01', 'Asia/Kolkata').toISOString(), '2026-03-31T18:30:00.000Z');
  assert.equal(zonedDayStart('2026-04-01', 'UTC').toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(zonedDayStart('2026-04-01', 'Asia/Tokyo').toISOString(), '2026-03-31T15:00:00.000Z');
});

test('daylight-saving days are 23 or 25 hours long, never mis-cut', () => {
  const start = zonedDayStart('2026-03-08', 'America/New_York');
  const next = zonedDayStart('2026-03-09', 'America/New_York');
  assert.equal(start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(next.toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal((next.getTime() - start.getTime()) / 3_600_000, 23);
});

test('an unknown timezone falls back to the store default', () => {
  assert.equal(normaliseTimeZone('Mars/Olympus'), 'Asia/Kolkata');
  assert.equal(normaliseTimeZone(''), 'Asia/Kolkata');
  assert.equal(normaliseTimeZone(undefined), 'Asia/Kolkata');
  assert.equal(normaliseTimeZone('Europe/London'), 'Europe/London');
});

test('the store day of an instant follows the store timezone', () => {
  // 31 Mar 18:40 UTC is 1 Apr 00:10 in India.
  const instant = new Date('2026-03-31T18:40:00.000Z');
  assert.equal(storeDay(instant, 'Asia/Kolkata'), '2026-04-01');
  assert.equal(storeDay(instant, 'UTC'), '2026-03-31');
  // Exactly IST midnight belongs to the new day, one millisecond earlier to the old.
  assert.equal(storeDay(new Date('2026-03-31T18:30:00.000Z'), 'Asia/Kolkata'), '2026-04-01');
  assert.equal(storeDay(new Date('2026-03-31T18:29:59.999Z'), 'Asia/Kolkata'), '2026-03-31');
});

test('"today" in the default range is the store day at the database clock', () => {
  // 20:00 UTC on 30 Oct is already 31 Oct 01:30 in India.
  const now = new Date('2026-10-30T20:00:00.000Z');
  assert.equal(defaultReportRange(now).toDay, '2026-10-31');
  assert.equal(defaultReportRange(now, 'UTC').toDay, '2026-10-30');
  const parsed = parseReportFilters({}, now, 'Asia/Kolkata');
  assert.equal(parsed.filters.toDay, '2026-10-31');
  assert.equal(parsed.filters.toIso, '2026-10-31T18:30:00.000Z');
});

test('the filter range is inclusive of both store days and exclusive of the next', () => {
  const parsed = parseReportFilters({ from: '2026-04-01', to: '2026-04-01' }, new Date(), 'Asia/Kolkata');
  assert.equal(parsed.ok, true);
  const first = Date.parse('2026-04-01T00:00:00+05:30');
  const last = Date.parse('2026-04-01T23:59:59.999+05:30');
  const next = Date.parse('2026-04-02T00:00:00+05:30');
  assert.equal(Date.parse(parsed.filters.fromIso), first);
  assert.ok(Date.parse(parsed.filters.toIso) > last);
  assert.equal(Date.parse(parsed.filters.toIso), next);
});

test('an expense dated today is accepted in the small hours of the store day', () => {
  // 02:00 IST on 1 Apr is still 31 Mar in UTC; the store day is already 1 Apr.
  const now = new Date('2026-03-31T20:30:00.000Z');
  assert.deepEqual(validateSpentOn('2026-04-01', now), { ok: true, value: '2026-04-01' });
  assert.equal(validateSpentOn('2026-04-02', now).ok, false);
});

test('the CSV export keeps far more rows than a table so lines add up to totals', () => {
  assert.ok(REPORT_EXPORT_ROW_LIMIT > REPORT_ROW_LIMIT * 10);
});

test('every report states how it is calculated, in one line', () => {
  for (const report of REPORTS) {
    assert.ok(report.howCalculated.length > 40, `${report.key} has a definition`);
    assert.ok(!report.howCalculated.includes('\n'), `${report.key} definition is one line`);
  }
  const pages = [
    'src/app/(store-admin)/store-admin/(protected)/reports/[report]/page.tsx',
    'src/app/(store-admin)/store-admin/(protected)/reports/coupon-usage/page.tsx',
    'src/app/(store-admin)/store-admin/(protected)/page.tsx',
  ];
  for (const page of pages) {
    const source = readFileSync(path.join(root, page), 'utf8');
    assert.match(source, /className="sa-note"/, `${page} has an sa-note`);
    assert.match(source, /How this is calculated/, `${page} says how it is calculated`);
  }
});

test('no report page or API cuts days with the web server clock', () => {
  const files = [
    'src/app/(store-admin)/store-admin/(protected)/reports/[report]/page.tsx',
    'src/app/(store-admin)/store-admin/(protected)/reports/coupon-usage/page.tsx',
    'src/app/(store-admin)/store-admin/(protected)/reports/page.tsx',
    'src/app/api/store-admin/reports/export/route.ts',
    'src/app/api/store-admin/reports/route.ts',
    'src/app/api/store-admin/transactions/export/route.ts',
    'src/lib/store-admin/analytics.ts',
    'src/lib/store-admin/reports.ts',
  ];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8');
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(executable, /current_date/, `${file} must not use current_date`);
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)/, `${file} must not use the server clock`);
    assert.doesNotMatch(source, /at time zone 'UTC'/, `${file} must not bucket by UTC`);
  }
});

test('the report clock uses the database and never substitutes the host clock', async () => {
  const { getDatabaseNow } = await jiti.import('../src/lib/store-admin/store-clock.ts');
  const previousUrl = process.env.DATABASE_URL;
  const previousSql = globalThis.__gadzioSql;
  process.env.DATABASE_URL = previousUrl || 'postgres://fixture.invalid/test';
  try {
    const instant = new Date('2026-03-31T20:30:00.000Z');
    globalThis.__gadzioSql = async () => [{ now: instant }];
    assert.equal(await getDatabaseNow(), instant);
    globalThis.__gadzioSql = async () => { throw new Error('private connection detail'); };
    await assert.rejects(getDatabaseNow(), {
      message: 'The store database clock is unavailable. Please try again.',
    });
    globalThis.__gadzioSql = async () => [{ now: null }];
    await assert.rejects(getDatabaseNow(), /database clock is unavailable/);
  } finally {
    globalThis.__gadzioSql = previousSql;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});

test('money is formatted with the rupee sign, Indian grouping and two decimals', () => {
  assert.equal(formatPaise(0), '₹0.00');
  assert.equal(formatPaise(5), '₹0.05');
  assert.equal(formatPaise(1234567), '₹12,345.67');
  assert.equal(formatPaise(12345678900), '₹12,34,56,789.00');
  assert.equal(formatPaise(-50000), '-₹500.00');
  assert.equal(formatReportValue(-50000, 'money'), '-₹500.00');
  assert.equal(formatReportValue(null, 'money'), '—');
  assert.equal(formatReportValue(1234567, 'int'), '12,34,567');
  assert.equal(formatReportValue('2026-04-01 00:10', 'datetime'), '2026-04-01 00:10');
});

test('the CSV writes refunds as negative rupees and date-times as shown', () => {
  const csv = reportCsv({
    columns: [
      { key: 'date', label: 'Date', format: 'datetime' },
      { key: 'amount', label: 'Amount', format: 'money' },
    ],
    rows: [
      { date: '2026-04-01 00:10', amount: -50000 },
      { date: '2026-04-01 09:00', amount: 1234567 },
    ],
    totals: { date: 'Net settled', amount: 1184567 },
    stats: [],
  });
  assert.equal(
    csv,
    ['Date,Amount', '2026-04-01 00:10,-500.00', '2026-04-01 09:00,12345.67', 'Net settled,11845.67'].join('\r\n'),
  );
  assert.ok(!/NaN|undefined|null/.test(csv));
});

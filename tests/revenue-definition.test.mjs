import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { orderRevenuePaise } from '../src/lib/store-admin/amount.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(path.join(here, '..', relative), 'utf8');

test('revenue is the order total as charged, with a legacy rupee fallback', () => {
  assert.equal(orderRevenuePaise(12345, '123.45'), 12345);
  assert.equal(orderRevenuePaise(null, 123.45), 12345, 'pre-0014 rows only have amount');
  assert.equal(orderRevenuePaise(undefined, '59.00'), 5900);
  assert.equal(orderRevenuePaise(0, '59.00'), 5900, 'zero total falls back rather than dropping the order');
  assert.equal(orderRevenuePaise(null, null), 0);
  assert.equal(orderRevenuePaise('nonsense', 'nonsense'), 0);
});

test('every order-level revenue sum uses the same total and legacy fallback', () => {
  for (const file of ['src/lib/store-admin/reports.ts', 'src/lib/store-admin/analytics.ts']) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /sum\(o\.total_paise\)/,
      `${file} must not sum total_paise without the amount fallback`,
    );
    assert.match(
      source,
      /coalesce\(o\.total_paise, round\(o\.amount \* 100\)::bigint\)/,
      `${file} must fall back to amount for legacy rows`,
    );
  }
});

test('the definition is documented, and item reports say they exclude shipping', () => {
  const reports = read('src/lib/store-admin/reports.ts');
  assert.match(reports, /Revenue\*\* is the order total as charged/);
  assert.match(reports, /excludes shipping/);
  // Item-wise revenue is line revenue after discount, not the order total:
  // item revenue + shipping = order-level revenue.
  assert.match(
    reports,
    /coalesce\(sum\(oi\.line_total_paise - oi\.discount_paise\), 0\)::bigint as revenue/,
  );
});

test('an unconfirmed (PROCESSING) payment is labelled and counted, never revenue', () => {
  // Overview: the status table must label PROCESSING, and the "Pending" tile
  // counts it through the pure rule rather than dropping it.
  const overview = read('src/app/(store-admin)/store-admin/(protected)/page.tsx');
  assert.match(overview, /PROCESSING: 'Processing'/);
  assert.match(overview, /data\.pending/);

  const analytics = read('src/lib/store-admin/analytics.ts');
  assert.match(analytics, /countPendingTransactions/);
  assert.match(analytics, /isRevenueStatus/);
  const analyticsProcessing = analytics
    .split('\n')
    .filter((line) => line.includes('PROCESSING'));
  assert.equal(analyticsProcessing.length > 0, true);
  for (const line of analyticsProcessing) {
    assert.match(line.trim(), /^\/\//, 'PROCESSING may only be commented on in revenue code');
  }

  // The reports module computes money from PAID rows only; the status filter
  // itself lives in report-rules.ts (see tests/report-rules.test.mjs).
  assert.doesNotMatch(read('src/lib/store-admin/reports.ts'), /PROCESSING/);

  // The accountant export carries captured payments only.
  assert.match(
    read('src/lib/store-admin/transactions.ts'),
    /p\.id is not null or o\.status = 'PAID'/,
  );
});

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
  assert.match(reports, /it excludes shipping; order-level revenue includes it/);
  // Item-wise revenue is line revenue, not the order total.
  assert.match(reports, /coalesce\(sum\(oi\.line_total_paise\), 0\)::bigint as revenue/);
});

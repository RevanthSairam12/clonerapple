/**
 * Option A ("Mark as test order") verification:
 *   1. Pure validation rules (`parseOrderTestFilter`, `validateTestOrderReason`).
 *   2. Migration 0073 is strictly additive (no DELETE/TRUNCATE/DROP, no renumbering).
 *   3. Owner-only API route enforces same-origin, `store_owner`, and PII-free audit.
 *   4. `setOrderTestFlagUsing` enforces owner role, handles missing migration 42703,
 *      returns not-found cleanly, and updates ONLY test-order metadata columns.
 *   5. Revenue, overview, customers, and reports SQL exclude `is_test = true`
 *      using the migration-safe JSONB check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { parseOrderTestFilter, validateTestOrderReason } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'order-rules.ts'),
);
const { setOrderTestFlagUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'orders.ts'),
);

test('parseOrderTestFilter normalizes all/live/test safely', () => {
  assert.equal(parseOrderTestFilter(undefined), 'all');
  assert.equal(parseOrderTestFilter(''), 'all');
  assert.equal(parseOrderTestFilter('LIVE'), 'live');
  assert.equal(parseOrderTestFilter(' test '), 'test');
  assert.equal(parseOrderTestFilter('other'), 'all');
});

test('validateTestOrderReason enforces 3..200 chars', () => {
  assert.equal(validateTestOrderReason('').ok, false);
  assert.equal(validateTestOrderReason('  ab  ').ok, false);
  assert.equal(validateTestOrderReason('a'.repeat(201)).ok, false);
  assert.deepEqual(validateTestOrderReason('  QA sandbox check  '), {
    ok: true,
    reason: 'QA sandbox check',
  });
});

test('migration 0073 is additive and never deletes or renumbers orders', async () => {
  const sql = await readFile(
    path.join(root, 'migrations', '0073_mark_test_order.sql'),
    'utf8',
  );
  assert.match(sql, /alter table orders/i);
  assert.match(sql, /add column if not exists is_test boolean not null default false/i);
  assert.match(sql, /add column if not exists test_marked_by text/i);
  assert.match(sql, /add column if not exists test_marked_at timestamptz/i);
  assert.match(sql, /add column if not exists test_note text not null default ''/i);
  assert.match(sql, /create index if not exists idx_orders_is_test/i);
  assert.doesNotMatch(sql, /\b(truncate|delete from|drop table|drop column|order_number\s*=|invoice_number\s*=)\b/i);
});

test('setOrderTestFlagUsing rejects non-owners before touching DB', async () => {
  let called = false;
  const fakeSql = {
    begin() {
      called = true;
      throw new Error('should not be called');
    },
  };
  const result = await setOrderTestFlagUsing(fakeSql, {
    txnid: 'TXN123',
    isTest: true,
    reason: 'QA test order',
    staffId: 'staff_1',
    role: 'store_admin',
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'owner-required');
});

test('setOrderTestFlagUsing handles pending migration 42703 cleanly', async () => {
  const fakeSql = {
    async begin() {
      const err = new Error('column "is_test" does not exist');
      err.code = '42703';
      throw err;
    },
  };
  const result = await setOrderTestFlagUsing(fakeSql, {
    txnid: 'TXN123',
    isTest: true,
    reason: 'QA test order',
    staffId: 'owner_1',
    role: 'store_owner',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'migration-pending');
  assert.match(result.error, /0073_mark_test_order\.sql/);
});

test('setOrderTestFlagUsing updates only test metadata without deleting or renumbering', async () => {
  const queries = [];
  const fakeTx = Object.assign(
    async (strings, ...values) => {
      const sqlText = strings.join(' ? ');
      queries.push({ sqlText, values });
      if (/from orders/i.test(sqlText)) {
        return [
          {
            id: 'ord_1',
            txnid: 'TXN_TEST_1',
            order_number: 1031,
            is_test: false,
          },
        ];
      }
      return [];
    },
    {},
  );
  const fakeSql = {
    async begin(fn) {
      return fn(fakeTx);
    },
  };

  const result = await setOrderTestFlagUsing(fakeSql, {
    txnid: ' TXN_TEST_1 ',
    isTest: true,
    reason: 'PayU staging sandbox order',
    staffId: 'owner_1',
    role: 'store_owner',
  });

  assert.deepEqual(result, {
    ok: true,
    orderId: 'ord_1',
    txnid: 'TXN_TEST_1',
    orderNumber: 1031,
    previousIsTest: false,
    isTest: true,
  });

  assert.equal(queries.length, 2);
  const updateQuery = queries[1].sqlText;
  assert.match(updateQuery, /update orders/i);
  assert.match(updateQuery, /is_test\s*=/i);
  assert.match(updateQuery, /test_marked_by\s*=/i);
  assert.match(updateQuery, /test_marked_at\s*=/i);
  assert.match(updateQuery, /test_note\s*=/i);
  assert.doesNotMatch(updateQuery, /order_number|invoice_number|invoice_sequence|status\s*=|delete/i);
});

test('test-order route checks same-origin, owner role, and audits without PII', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'orders', '[txnid]', 'test-order', 'route.ts'),
    'utf8',
  );
  assert.match(source, /assertSameOrigin\(request\)/);
  assert.match(source, /requireStoreRole\('store_owner'\)/);
  assert.match(source, /writeAudit\(/);
  assert.match(source, /order\.test\.mark/);
  assert.match(source, /order\.test\.unmark/);
  assert.doesNotMatch(source, /customer_email|customer_phone|customer_name/);
});

test('revenue, overview, customers, and reports queries exclude marked test orders', async () => {
  const expectations = [
    ['src/lib/store-admin/analytics.ts', 16],
    ['src/lib/store-admin/transactions.ts', 1],
    ['src/lib/store-admin/needs-attention.ts', 4],
    ['src/lib/store-admin/customers.ts', 7],
    ['src/lib/store-admin/customer-accounts.ts', 1],
    ['src/lib/store-admin/reports.ts', 25],
    ['src/lib/store-admin/coupons.ts', 3],
    ['src/lib/store-admin/spin-wheel.ts', 1],
    ['src/lib/store-admin/free-gifts.ts', 3],
  ];

  for (const [relPath, minMatches] of expectations) {
    const content = await readFile(path.join(root, ...relPath.split('/')), 'utf8');
    const matches = content.match(
      /coalesce\(\(to_jsonb\([a-z0-9_]+\)->>'is_test'\)::boolean,\s*false\)\s*=\s*false/g,
    );
    const count = matches ? matches.length : 0;
    assert.ok(
      count >= minMatches,
      `${relPath}: expected at least ${minMatches} is_test exclusions, found ${count}`,
    );
  }
});


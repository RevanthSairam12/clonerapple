import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFixtureSchema, dropFixtureSchema, withFixtureSchema, isolateCopiedTables, addFixtureInventoryColumns } from './helpers/isolated-schema.mjs';

// Pure SQL recorder: deliberately no postgres import, URL or network connection.
function recorder({ defaults = [], failOn, schema = 'itest_unit' } = {}) {
  const statements = [];
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    statements.push({ text, values });
    if (text.includes('information_schema.columns')) return defaults;
    if (text.includes('current_schema()')) return [{ schema }];
    throw new Error(`Unexpected query: ${text}`);
  };
  sql.unsafe = async (text) => {
    statements.push({ text });
    if (failOn?.test(text)) throw new Error('simulated SQL failure');
    return [];
  };
  return { sql, statements, text: () => statements.map((statement) => statement.text).join('\n') };
}

test('copied serial defaults are rebound, owned locally and protected before use', async () => {
  const fake = recorder({ defaults: [
    { table_name: 'order_items', column_name: 'id' },
    { table_name: 'stock_movements', column_name: 'id' },
  ] });
  const previous = globalThis.__gadzioSql;
  await createFixtureSchema(fake.sql, 'itest_unit', ['order_items', 'stock_movements']);
  try {
    assert.equal(globalThis.__gadzioSql, fake.sql);
    const text = fake.text();
    assert.equal((text.match(/create sequence /g) ?? []).length, 2);
    assert.match(text, /owned by "itest_unit"\."order_items"\."id"/);
    assert.match(text, /default nextval\('"itest_unit"\."fixture_serial_0_seq"'::regclass\)/);
    assert.match(text, /default nextval\('"itest_unit"\."fixture_serial_1_seq"'::regclass\)/);
    assert.equal((text.match(/enable row level security/g) ?? []).length, 2);
    assert.ok(text.indexOf('set default nextval') < text.indexOf('set search_path'));
    assert.ok(text.indexOf('enable row level security') < text.indexOf('set search_path'));
  } finally {
    await dropFixtureSchema(fake.sql, 'itest_unit');
  }
  assert.equal(globalThis.__gadzioSql, previous);
  assert.match(fake.text(), /set search_path to pg_catalog\ndrop schema "itest_unit" cascade/);
  assert.doesNotMatch(fake.text(), /set search_path to public|alter (?:table|sequence) public/);
});

test('Phase4 compatibility changes are additive and confined to copied fixture tables', async () => {
  const fake = recorder();
  await addFixtureInventoryColumns(fake.sql, 'itest_unit', ['products', 'order_items', 'product_variants']);
  const text = fake.text();
  assert.match(text, /alter table "itest_unit"\.products add column if not exists inventory_mode/);
  assert.match(text, /alter table "itest_unit"\.order_items add column if not exists variant_id text, add column if not exists variant_sku text, add column if not exists variant_label text/);
  assert.match(text, /alter table "itest_unit"\.product_variants add column if not exists is_purchasable/);
  assert.doesNotMatch(text, /public\.|insert into|update |delete from|drop /i);
  const empty = recorder();
  await addFixtureInventoryColumns(empty.sql, 'itest_unit', ['coupons']);
  assert.equal(empty.statements.length, 0);
  await assert.rejects(addFixtureInventoryColumns(empty.sql, 'public', ['products']), /temporary/);
});

test('failed CREATE never authorizes dropping an existing schema', async () => {
  const fake = recorder({ failOn: /^create schema/ });
  await assert.rejects(createFixtureSchema(fake.sql, 'itest_unit', ['orders']), /simulated/);
  await dropFixtureSchema(fake.sql, 'itest_unit');
  assert.doesNotMatch(fake.text(), /drop schema|set search_path/);
});

test('partial setup can clean up only its own successfully created schema', async () => {
  const fake = recorder({ failOn: /^create table/ });
  await assert.rejects(createFixtureSchema(fake.sql, 'itest_unit', ['orders']), /simulated/);
  await dropFixtureSchema(fake.sql, 'itest_other');
  assert.doesNotMatch(fake.text(), /drop schema/);
  await dropFixtureSchema(fake.sql, 'itest_unit');
  assert.match(fake.text(), /drop schema "itest_unit" cascade/);
  const count = fake.statements.length;
  await dropFixtureSchema(fake.sql, 'itest_unit');
  assert.equal(fake.statements.length, count, 'cleanup is idempotent');
});

test('a failed drop still restores the process-wide connection', async () => {
  const fake = recorder({ failOn: /^drop schema/ });
  const previous = globalThis.__gadzioSql;
  await createFixtureSchema(fake.sql, 'itest_unit', []);
  await assert.rejects(dropFixtureSchema(fake.sql, 'itest_unit'), /simulated/);
  assert.equal(globalThis.__gadzioSql, previous);
});

test('schema names reject public, injection and truncation before any SQL', async () => {
  for (const schema of ['public', 'itest_bad";drop schema public cascade;--', `itest_${'x'.repeat(60)}`]) {
    const fake = recorder();
    await assert.rejects(createFixtureSchema(fake.sql, schema, []), /temporary/);
    assert.equal(fake.statements.length, 0);
  }
});

test('flash-sale names are accepted and identity-only tables need no replacement sequence', async () => {
  const fake = recorder({ schema: 'fs_unit' });
  await createFixtureSchema(fake.sql, 'fs_unit', ['orders']);
  await dropFixtureSchema(fake.sql, 'fs_unit');
  assert.doesNotMatch(fake.text(), /create sequence/);
  assert.match(fake.text(), /alter table "fs_unit"\."orders" enable row level security/);
});

test('serial introspection is schema-scoped and rejects unrelated tables', async () => {
  const fake = recorder({ defaults: [{ table_name: 'unexpected', column_name: 'id' }] });
  await assert.rejects(isolateCopiedTables(fake.sql, 'itest_unit', ['orders']), /outside copied/);
  assert.deepEqual(fake.statements[0].values, ['itest_unit']);
  assert.doesNotMatch(fake.text(), /create sequence|alter table/);
});

test('all scoped fixture clients start fail-closed and delegate creation and cleanup', async () => {
  const files = [
    'helpers/flash-sale-schema.mjs', 'helpers/reports-fixture.mjs',
    ...['coupon-order-integration', 'inventory-controls', 'late-payment-stock-integration',
      'maintenance-integration', 'order-cancel-stock-integration', 'order-stock-integration',
      'pos-entered-prices', 'sale-admin', 'sale-pricing', 'sale-price-entry', 'sale-boundary-display',
      'coupon-db-integration', 'notifications-enqueue-integration', 'notifications-outbox-integration',
      'staff-accounts-integration', 'stock-behaviour', 'payu-callback-integration']
      .map((name) => `${name}.test.mjs`),
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /connection: \{ search_path: 'pg_catalog' \}/, file);
    assert.match(source, /await createFixtureSchema\(/, file);
    assert.match(source, /await dropFixtureSchema\(/, file);
    assert.doesNotMatch(source, /set search_path to public|drop schema if exists/, file);
    assert.doesNotMatch(source, /await .*create schema/, file);
  }
});

test('flash-sale cleanup contracts and POS invoice prerequisites are fixture-local', async () => {
  const flash = await readFile(new URL('helpers/flash-sale-schema.mjs', import.meta.url), 'utf8');
  const tables = flash.match(/export const TABLES = \[([\s\S]*?)\];/)[1];
  assert.doesNotMatch(tables, /waiting_list_entries|stock_reservations/);
  assert.doesNotMatch(tables, /payment_events/);
  for (const table of ['waiting_list_entries', 'stock_reservations', 'payment_events']) {
    assert.ok(flash.includes(`create table "\${schema}".${table}`));
    assert.ok(flash.includes(`alter table "\${schema}".${table} enable row level security`));
  }
  const pos = await readFile(new URL('pos-entered-prices.test.mjs', import.meta.url), 'utf8');
  assert.match(pos, /create table "\$\{schema\}"\.invoice_number_counters/);
  assert.match(pos, /alter table "\$\{schema\}"\.invoice_number_counters enable row level security/);
  assert.match(pos, /add column if not exists invoice_number text/);
  assert.match(pos, /'store_admin_audit'/);
  assert.match(pos, /insert into invoice_number_counters \(name, last_number\) values \('invoice', 0\)/);
  assert.match(pos, /catch \(error\) \{[\s\S]*?await dropFixtureSchema\(sql, schema\);[\s\S]*?throw error/);
});

test('pinning failures never install the application pool and remain cleanable', async () => {
  const fake = recorder({ schema: 'public' });
  const previous = globalThis.__gadzioSql;
  await assert.rejects(createFixtureSchema(fake.sql, 'itest_unit', ['orders']), /not pinned/);
  assert.equal(globalThis.__gadzioSql, previous);
  await dropFixtureSchema(fake.sql, 'itest_unit');
  assert.match(fake.text(), /drop schema "itest_unit" cascade/);
});

test('withFixtureSchema drops the schema in a finally block even when the test body throws', async () => {
  const fake = recorder({ schema: 'itest_unit' });
  const previous = globalThis.__gadzioSql;
  await assert.rejects(
    withFixtureSchema(fake.sql, 'itest_unit', ['orders'], async () => {
      assert.equal(globalThis.__gadzioSql, fake.sql);
      throw new Error('intentional test failure inside fixture');
    }),
    /intentional test failure inside fixture/,
  );
  assert.equal(globalThis.__gadzioSql, previous);
  assert.match(fake.text(), /set search_path to pg_catalog\ndrop schema "itest_unit" cascade/);
});

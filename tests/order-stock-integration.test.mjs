/**
 * Live concurrency proof: two separate database connections race to buy the
 * last unit of the same product. Exactly one order may be created; the other
 * must fail with the 409 path (`InsufficientStockError`).
 *
 * The test runs against a throwaway schema that mirrors the order tables
 * (`create table ... (like public.x including all)`). That keeps the real
 * `createOrderUsing` SQL, real PostgreSQL row locking and the real concurrency
 * behaviour, while cleanup is a single `drop schema` — no production row is
 * touched and the append-only history trigger is never bypassed.
 *
 * Skipped when DATABASE_URL is unset, and on a transaction pooler (port 6543),
 * where session-level `search_path` is not stable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(here, '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; the test stays skipped.
  }
}

function connectionDetails() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    isPooler: url.hostname.includes('pooler') && url.port === '6543',
    transactionPooler: url.port === '6543',
  };
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  const { isPooler } = connectionDetails();
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    connection: { search_path: 'pg_catalog' },
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});
const { createOrderUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'orders.ts'),
);

const TABLES = [
  'categories',
  'products',
  'stock',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'stock_movements',
];

function orderParams({ productId, txnid }) {
  return {
    txnid,
    items: [
      { id: productId, name: 'Integration last unit', quantity: 1, unitPrice: 500, totalPrice: 500 },
    ],
    subtotalPaise: 50000,
    shippingPaise: 0,
    totalPaise: 50000,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: 'Integration Buyer',
    customerEmail: 'integration@example.test',
    customerPhone: '9000000000',
    shippingAddress: {
      name: 'Integration Buyer',
      phone: '9000000000',
      line1: '1 Test Lane',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
  };
}

test('two buyers of the last unit: one order, one 409 path', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_${suffix}`;
  const productId = `itestprod${suffix}`;
  const stockId = `iteststk${suffix}`;
  const categoryId = `itestcat${suffix}`;
  const txnida = `ITESTA${suffix}`;
  const txnidb = `ITESTB${suffix}`;
  const a = client();
  const b = client();

  try {
    await createFixtureSchema(a, schema, TABLES);
    await b.unsafe(`set search_path to "${schema}"`);
    // Hard guard: every statement below must resolve inside the throwaway
    // schema. If the SET did not stick, fail before writing any fixture.
    for (const [client, label] of [[a, 'a'], [b, 'b']]) {
      const rows = await client`show search_path`;
      assert.ok(
        String(rows[0].search_path).includes(schema),
        `connection ${label} is not pinned to ${schema}`,
      );
    }

    await a`
      insert into categories (id, slug, name)
      values (${categoryId}, ${categoryId}, 'Integration category')
    `;
    await a`
      insert into products (id, category_id, slug, name, price_paise)
      values (${productId}, ${categoryId}, ${productId}, 'Integration last unit', 50000)
    `;
    await a`
      insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
      values (${stockId}, ${productId}, null, 1, 0, true)
    `;

    // Warm both connections so the two transactions start together.
    await Promise.all([a`select 1`, b`select 1`]);

    const results = await Promise.allSettled([
      createOrderUsing(a, orderParams({ productId, txnid: txnida })),
      createOrderUsing(b, orderParams({ productId, txnid: txnidb })),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one buyer gets the unit');
    assert.equal(rejected.length, 1, 'the other buyer is refused');
    assert.equal(
      rejected[0].reason?.name,
      'InsufficientStockError',
      'the loser takes the 409 path',
    );
    assert.equal(rejected[0].reason.code, 'insufficient_stock');

    const winner = fulfilled[0].value.order;
    const rows = await a`
      select id, txnid from orders where txnid in (${txnida}, ${txnidb})
    `;
    assert.equal(rows.length, 1, 'no order row is left behind for the loser');
    assert.equal(String(rows[0].id), winner.id);

    const stockRows = await a`
      select on_hand from stock where id = ${stockId}
    `;
    assert.equal(Number(stockRows[0].on_hand), 0, 'the single unit was claimed once');

    const movements = await a`
      select delta, reason from stock_movements where order_id = ${winner.id}
    `;
    assert.equal(movements.length, 1);
    assert.equal(Number(movements[0].delta), -1);
    assert.equal(String(movements[0].reason), 'sale');
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } catch (error) {
      console.warn('[order-stock-integration] cleanup did not finish:', error?.message ?? error);
    }
    await Promise.all([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
  }
});

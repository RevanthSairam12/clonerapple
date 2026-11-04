/**
 * Real processor SQL against a throwaway schema; explicit opt-in only.
 * RUN_PAYU_CALLBACK_INTEGRATION=1 node --test tests/payu-callback-integration.test.mjs
 * Supply DATABASE_URL explicitly after approval. Never reads .env.local.
 * No production order, sequence, audit, notification or cache is changed.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { createOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));
const { processPayUCallback } = await jiti.import(path.join(root, 'src/lib/payu/process-response.ts'));
const { computeReverseHash } = await jiti.import(path.join(root, 'src/lib/payu/hash.ts'));
const skip = process.env.RUN_PAYU_CALLBACK_INTEGRATION !== '1'
  ? 'opt-in only: database-test approval required'
  : !process.env.DATABASE_URL ? 'DATABASE_URL is not set' : false;
const schema = `itest_payu_${randomBytes(10).toString('hex')}`;
const envKeys = ['PAYU_KEY', 'PAYU_SALT', 'APP_BASE_URL', 'PAYU_RETURN_SECRET'];
let sql;
let saved;

before(async () => {
  if (skip) return;
  if (new URL(process.env.DATABASE_URL).port === '6543') throw new Error('Requires a session connection, not transaction pooler port 6543.');
  saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.PAYU_KEY = 'integration-key';
  process.env.PAYU_SALT = 'integration-salt';
  process.env.APP_BASE_URL = 'https://store.example.test';
  delete process.env.PAYU_RETURN_SECRET;
  sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {}, connection: { search_path: 'pg_catalog' } });
  const tables = ['categories', 'products', 'stock', 'stock_movements', 'orders', 'order_items', 'order_addresses', 'order_status_history', 'store_settings', 'coupons', 'coupon_targets', 'coupon_redemptions', 'refund_obligations'];
  await createFixtureSchema(sql, schema, tables);
  assert.equal((await sql`select current_schema() as name`)[0].name, schema);
  // Run the real additive migration inside the fixture: includes the gateway
  // unique index, append-only trigger and timeline RLS. No public fallback.
  await sql.unsafe(await readFile(path.join(root, 'migrations/0047_payment_events.sql'), 'utf8'));
  await sql`insert into store_settings (key, value) values ('auto_confirm', 'off'), ('default_fulfilment_status', 'PENDING')`;
  await sql`insert into categories (id, slug, name) values ('fixture-category', 'fixture-category', 'Fixture')`;
  await sql`insert into products (id, category_id, slug, name, price_paise) values ('fixture-product', 'fixture-category', 'fixture-product', 'Fixture product', 50000)`;
  await sql`insert into stock (id, product_id, on_hand, reserved, track_inventory) values ('fixture-stock', 'fixture-product', 100, 0, true)`;
});
after(async () => {
  try {
    if (sql) await dropFixtureSchema(sql, schema);
  } finally {
    try {
      if (sql) await sql.end({ timeout: 5 });
    } finally {
      if (saved) for (const key of envKeys) {
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
      }
    }
  }
});

async function makeOrder() {
  const txnid = `FIX${randomBytes(8).toString('hex')}`;
  return (await createOrderUsing(sql, {
    txnid, items: [{ id: 'fixture-product', name: 'Fixture product', quantity: 1, unitPrice: 500, totalPrice: 500 }],
    subtotalPaise: 50000, shippingPaise: 0, totalPaise: 50000,
    customerName: 'Test Buyer', customerEmail: 'buyer@example.test', customerPhone: '9000000000',
    shippingAddress: { name: 'Test Buyer', phone: '9000000000', line1: '1 Test Lane', city: 'Test City', state: 'Test State', pincode: '560001' },
  })).order;
}
function callback(order, status = 'success', extra = {}) {
  const data = { key: process.env.PAYU_KEY, txnid: order.txnid, amount: '500.00', status,
    unmappedstatus: status === 'success' ? 'captured' : status, ...extra };
  return { ...data, hash: computeReverseHash({ ...data, salt: process.env.PAYU_SALT }) };
}
function opts(order, result = {}) {
  return { sql, sideEffects: false,
    policy: { reservationSeconds: 600, failureGraceSeconds: 0, unresolvedMinutes: 60 },
    verifier: async (txnid, amount) => {
      assert.equal(txnid, order.txnid); assert.equal(amount, 500);
      return { verified: true, status: 'success', unmappedstatus: 'captured', mihpayid: `gateway_${order.txnid}`, mode: 'UPI', amount: '500.00', amountPaise: 50000, raw: null, ...result };
    },
  };
}

test('concurrent duplicate callbacks pay once with one history and stock claim', { skip }, async () => {
  const order = await makeOrder();
  const results = await Promise.all(['webhook', 'redirect', 'webhook'].map((source) => processPayUCallback(callback(order), source, opts(order))));
  assert.ok(results.every((result) => result.status === 'PAID'));
  const history = await sql`select count(*)::int as n from order_status_history where order_id = ${order.id} and to_status = 'PAID'`;
  assert.equal(history[0].n, 1);
  const movements = await sql`select count(*)::int as n from stock_movements where order_id = ${order.id} and reason = 'sale'`;
  assert.equal(movements[0].n, 1);
  const events = await sql`select outcome from payment_events where order_id = ${order.id}`;
  assert.equal(events.filter((event) => event.outcome === 'paid').length, 1);
  assert.equal(events.length, 3);
});

test('failure then late capture reclaims stock, stale failure cannot downgrade paid', { skip }, async () => {
  const order = await makeOrder();
  const failure = opts(order, { verified: false, status: 'failure', unmappedstatus: 'failed' });
  assert.equal((await processPayUCallback(callback(order, 'failure'), 'redirect', failure)).status, 'FAILED');
  assert.equal((await processPayUCallback(callback(order), 'webhook', opts(order))).status, 'PAID');
  assert.equal((await processPayUCallback(callback(order, 'failure'), 'redirect', failure)).status, 'PAID');
  const moves = await sql`select reason, delta from stock_movements where order_id = ${order.id} order by id`;
  assert.deepEqual(moves.map((row) => [row.reason, row.delta]), [['sale', -1], ['release', 1], ['sale', -1]]);
});

test('gateway id cannot pay two orders; signed mismatches cannot pay', { skip }, async () => {
  const first = await makeOrder();
  const second = await makeOrder();
  await processPayUCallback(callback(first), 'webhook', opts(first));
  const replay = await processPayUCallback(callback(second), 'webhook', opts(second, { mihpayid: `gateway_${first.txnid}` }));
  assert.equal(replay.reason, 'duplicate_gateway_payment');
  const mismatch = await processPayUCallback(callback(second, 'success', { amount: '499.00' }), 'webhook', opts(second));
  assert.equal(mismatch.reason, 'amount_mismatch');
  const rows = await sql`select status, payment_review_required from orders where id = ${second.id}`;
  assert.equal(rows[0].status, 'CREATED'); assert.equal(rows[0].payment_review_required, true);
});

test('timeline migration enforces append-only rows and RLS', { skip }, async () => {
  const order = await makeOrder();
  await processPayUCallback(callback(order), 'webhook', opts(order));
  await assert.rejects(sql`update payment_events set reason = 'changed' where order_id = ${order.id}`, /immutable/);
  await assert.rejects(sql`delete from payment_events where order_id = ${order.id}`, /immutable/);
  const rows = await sql`select relrowsecurity from pg_class where oid = 'payment_events'::regclass`;
  assert.equal(rows[0].relrowsecurity, true);
});

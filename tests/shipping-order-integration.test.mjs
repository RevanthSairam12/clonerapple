/**
 * Authoritative Part 1 shipping checkout coverage.
 *
 * This suite is opt-in because it creates an isolated PostgreSQL schema and
 * exercises real transactions. It never reads .env.local implicitly:
 *
 *   RUN_SHIPPING_ORDER_INTEGRATION=1 node --test tests/shipping-order-integration.test.mjs
 *
 * The schema is copied from public tables, all fixture serials use local
 * sequences, and teardown drops only that schema. Do not run this command
 * without explicit database-test approval.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

import {
  checkoutParams,
  createShippingFixtureSchema,
  dropShippingFixtureSchema,
  seedCheckoutConfiguration,
  seedCoupon,
  seedProduct,
  token,
  txnid,
} from './helpers/shipping-order-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const fixtureConnectionUrl = () => (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
const run = process.env.RUN_SHIPPING_ORDER_INTEGRATION === '1';
const skip = run
  ? (!fixtureConnectionUrl() ? 'DATABASE_MIGRATION_URL / DATABASE_URL is not set' : false)
  : 'opt-in only: set RUN_SHIPPING_ORDER_INTEGRATION=1 after database-test approval';

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});
const [{ createOrderUsing }, { TotalChangedError }] = await Promise.all([
  jiti.import(path.join(root, 'src', 'lib', 'payu', 'orders.ts')),
  jiti.import(path.join(root, 'src', 'lib', 'coupons', 'errors.ts')),
]);

function connectionDetails() {
  const url = new URL(fixtureConnectionUrl());
  return {
    transactionPooler: url.port === '6543',
    isPooler: url.hostname.includes('pooler'),
  };
}

function client() {
  return postgres(fixtureConnectionUrl(), {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    onnotice: () => {},
    connection: { search_path: 'pg_catalog' },
  });
}

const schema = `itest_shipping_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
let sql;
let product;

function localOrderParams(options = {}) {
  return checkoutParams({
    productId: product.id,
    unitPaise: options.unitPaise ?? 49900,
    expectedTotalPaise: options.expectedTotalPaise,
    couponCode: options.couponCode,
    quantity: options.quantity ?? 1,
  });
}

async function setShipping(sqlConnection, chargePaise, thresholdPaise = 99900) {
  await sqlConnection`
    update store_settings
    set value = case key
      when 'shipping_charge_paise' then ${String(chargePaise)}
      when 'free_shipping_threshold_paise' then ${String(thresholdPaise)}
      else value
    end
    where key in ('shipping_charge_paise', 'free_shipping_threshold_paise')
  `;
}

async function orderRows() {
  return sql`
    select id, txnid, subtotal_paise, discount_paise, shipping_paise,
           total_paise, pricing_snapshot
    from orders order by created_at, id
  `;
}

before(async () => {
  if (skip) return;
  const details = connectionDetails();
  if (details.transactionPooler) {
    throw new Error('Shipping fixture requires a session connection, not port 6543.');
  }
  sql = client();
  try {
    await createShippingFixtureSchema(sql, schema);
    await sql`create table users (id text primary key, customer_group text)`;
    await sql`alter table users enable row level security`;
    await seedCheckoutConfiguration(sql, { chargePaise: 5000, thresholdPaise: 99900 });
    product = await seedProduct(sql, { pricePaise: 49900, stock: 100 });
  } catch (error) {
    try {
      await dropShippingFixtureSchema(sql, schema);
    } finally {
      await sql.end({ timeout: 5 });
    }
    throw error;
  }
});

beforeEach(async () => {
  if (skip) return;
  for (const table of ['coupon_redemptions', 'coupon_targets', 'coupons', 'order_status_history', 'order_addresses', 'order_items', 'orders', 'stock_movements', 'product_images', 'stock', 'products', 'categories']) {
    await sql.unsafe(`delete from ${table}`);
  }
  // Each test gets a fresh product row so stock and sale snapshots cannot leak.
  product = await seedProduct(sql, { pricePaise: 49900, stock: 100 });
  await seedCheckoutConfiguration(sql, { chargePaise: 5000, thresholdPaise: 99900, saleEnabled: false });
});

after(async () => {
  if (skip) return;
  try {
    await dropShippingFixtureSchema(sql, schema);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test('canonical ₹50/₹999 policy covers examples and threshold boundaries', { skip }, async () => {
  const cases = [
    [49900, 54900],
    [89900, 94900],
    [99900, 99900],
    [149900, 149900],
    [99899, 104899],
    [99901, 99901],
  ];
  for (const [unitPaise, totalPaise] of cases) {
    await sql`update products set price_paise = ${unitPaise}, sale_price_paise = null where id = ${product.id}`;
    const result = await createOrderUsing(sql, localOrderParams({
      unitPaise,
      expectedTotalPaise: totalPaise,
    }));
    assert.equal(result.order.subtotalPaise, unitPaise);
    assert.equal(result.order.shippingPaise, unitPaise >= 99900 ? 0 : 5000);
    assert.equal(result.order.totalPaise, totalPaise);
  }
});

test('no-coupon shipping changes return TotalChangedError and roll back stock/order/history', { skip }, async () => {
  const beforeStock = Number((await sql`select on_hand from stock where product_id = ${product.id}`)[0].on_hand);
  const params = localOrderParams({ unitPaise: 49900, expectedTotalPaise: 54900 });
  await setShipping(sql, 7000);

  await assert.rejects(
    createOrderUsing(sql, params),
    (error) => {
      assert.equal(error?.name, 'TotalChangedError');
      assert.deepEqual(error.totals, {
        subtotalPaise: 49900, discountPaise: 0, shippingPaise: 7000, totalPaise: 56900,
      });
      assert.equal(error.items.length, 1);
      assert.equal(error.shippingPolicy.chargePaise, 7000);
      return true;
    },
  );
  assert.equal((await orderRows()).length, 0);
  assert.equal(Number((await sql`select on_hand from stock where product_id = ${product.id}`)[0].on_hand), beforeStock);
  assert.equal((await sql`select count(*)::int as count from order_status_history`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from stock_movements`)[0].count, 0);
});

test('sale activation changes the authoritative subtotal and returns a complete 409 payload', { skip }, async () => {
  product = await seedProduct(sql, { pricePaise: 120000, salePricePaise: 90000, stock: 100 });
  const params = checkoutParams({ productId: product.id, unitPaise: 120000, expectedTotalPaise: 125000 });
  await sql`
    update sale_settings
    set enabled = true, starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
    where id = 'default'
  `;

  await assert.rejects(
    createOrderUsing(sql, params),
    (error) => {
      assert.equal(error?.name, 'TotalChangedError');
      assert.deepEqual(error.totals, {
        subtotalPaise: 90000, discountPaise: 0, shippingPaise: 5000, totalPaise: 95000,
      });
      assert.equal(error.items[0].unitPaise, 90000);
      assert.equal(error.shippingPolicy.freeShippingThresholdPaise, 99900);
      return true;
    },
  );
  assert.equal((await orderRows()).length, 0);
});

test('percent coupon discounts the sale-priced subtotal before shipping', { skip }, async () => {
  product = await seedProduct(sql, { pricePaise: 60000, salePricePaise: 50000, stock: 100 });
  const coupon = await seedCoupon(sql, { value: 10, allowWithSalePrice: true });
  await sql`
    update sale_settings
    set enabled = true, starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
    where id = 'default'
  `;
  const result = await createOrderUsing(sql, checkoutParams({
    productId: product.id, unitPaise: 50000, expectedTotalPaise: 50000, couponCode: coupon.code,
  }));
  assert.equal(result.order.subtotalPaise, 50000);
  assert.equal(result.order.discountPaise, 5000);
  assert.equal(result.order.shippingPaise, 5000);
  assert.equal(result.order.totalPaise, 50000);
  const redemption = (await sql`
    select discount_paise, state from coupon_redemptions where order_id = ${result.order.id}
  `)[0];
  assert.equal(Number(redemption.discount_paise), 5000);
  assert.equal(String(redemption.state), 'RESERVED');
});

test('free-shipping coupon overrides the configured charge and preserves the order history snapshot', { skip }, async () => {
  const coupon = await seedCoupon(sql, { code: `SHIP${randomBytes(3).toString('hex').toUpperCase()}`, type: 'FREE_SHIPPING', value: 0 });
  const result = await createOrderUsing(sql, localOrderParams({
    unitPaise: 49900, expectedTotalPaise: 49900, couponCode: coupon.code,
  }));
  assert.equal(result.order.shippingPaise, 0);
  assert.equal(result.order.discountPaise, 0);
  assert.equal(result.order.totalPaise, 49900);
  const row = (await sql`
    select shipping_paise, total_paise, pricing_snapshot
    from orders where id = ${result.order.id}
  `)[0];
  assert.equal(Number(row.shipping_paise), 0);
  assert.equal(Number(row.total_paise), 49900);
  assert.equal(row.pricing_snapshot.shipping.shippingPaise, 0);
  assert.equal((await sql`select count(*)::int as count from order_status_history where order_id = ${result.order.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from order_items where order_id = ${result.order.id}`)[0].count, 1);
});

test('successful orders retain immutable shipping even when current settings change', { skip }, async () => {
  const result = await createOrderUsing(sql, localOrderParams({ unitPaise: 49900, expectedTotalPaise: 54900 }));
  await setShipping(sql, 12000, 200000);
  const row = (await sql`
    select shipping_paise, total_paise from orders where id = ${result.order.id}
  `)[0];
  assert.equal(Number(row.shipping_paise), 5000);
  assert.equal(Number(row.total_paise), 54900);
  assert.equal((await sql`select count(*)::int as count from order_status_history where order_id = ${result.order.id}`)[0].count, 1);
});

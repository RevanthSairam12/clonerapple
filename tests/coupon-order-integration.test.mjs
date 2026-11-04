/**
 * Coupons end to end, through the real order transaction.
 *
 * These tests call `createOrderUsing` — the same function `/api/payu/initiate`
 * calls — inside a throwaway schema that mirrors the shipped order and coupon
 * tables. They pin the three things the checkout must get right for free
 * shipping, sale items and scoped codes: the order's money breakdown, the
 * per-line discounts, and whether a redemption row is written at all.
 *
 * Skipped when DATABASE_URL is unset, and on a transaction pooler (port 6543),
 * where session-level `search_path` is not stable.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; the integration tests stay skipped.
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
  alias: { '@': path.join(root, 'src') },
});

const { createOrderUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'payu', 'orders.ts'),
);
const { checkRefund } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'return-rules.ts'),
);

// Every one of these tables exists in the shipped schema; the copy keeps the
// real columns, checks and defaults while the data stays in the throwaway
// schema. `users` is minimal because only `customer_group` is read.
const COPIED_TABLES = [
  'stock',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'coupons',
  'coupon_targets',
  'coupon_redemptions',
];

const SCHEMA = `itest_coupon_order_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

let sql;

function newTxnid() {
  return `ITC${randomBytes(6).toString('hex').toUpperCase()}`;
}

function address() {
  return {
    name: 'Integration Buyer',
    phone: '9000000000',
    line1: '1 Test Lane',
    line2: '',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  };
}

function orderParams({ txnid, items, subtotalPaise, shippingPaise, coupon }) {
  return {
    txnid,
    items,
    subtotalPaise,
    shippingPaise,
    totalPaise: subtotalPaise + shippingPaise,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: 'Integration Buyer',
    customerEmail: 'buyer@example.test',
    customerPhone: '9000000000',
    shippingAddress: address(),
    reservationSeconds: 0,
    ...(coupon ? { coupon } : {}),
  };
}

function item(id, unitPaise, extra = {}) {
  return {
    id,
    name: `Item ${id}`,
    quantity: 1,
    unitPrice: unitPaise / 100,
    totalPrice: unitPaise / 100,
    ...extra,
  };
}

async function insertCoupon(overrides = {}) {
  const row = {
    id: `coupon_${randomBytes(4).toString('hex')}`,
    code: `CODE${randomBytes(3).toString('hex').toUpperCase()}`,
    type: 'PERCENT',
    value: 10,
    scope: 'ORDER',
    status: 'active',
    allow_with_sale_price: false,
    ...overrides,
  };
  await sql`
    insert into coupons (
      id, code, name, type, value, scope, status, allow_with_sale_price
    ) values (
      ${row.id}, ${row.code}, ${'Integration coupon'}, ${row.type}, ${row.value},
      ${row.scope}, ${row.status}, ${row.allow_with_sale_price}
    )
  `;
  return row;
}

async function lineDiscounts(orderId) {
  const rows = await sql`
    select line_number, product_id, discount_paise
    from order_items
    where order_id = ${orderId}
    order by line_number
  `;
  return rows.map((row) => ({
    productId: String(row.product_id),
    discountPaise: Number(row.discount_paise),
  }));
}

async function redemptionRows(orderId) {
  return await sql`
    select coupon_id, discount_paise, state
    from coupon_redemptions
    where order_id = ${orderId}
  `;
}

before(async () => {
  if (skip) return;
  sql = client();
  await createFixtureSchema(sql, SCHEMA, COPIED_TABLES);
  await sql.unsafe(`create table "${SCHEMA}".users (id text primary key, customer_group text)`);
  await sql.unsafe(`alter table "${SCHEMA}".users enable row level security`);

  const pinned = await sql`show search_path`;
  assert.ok(
    String(pinned[0].search_path).includes(SCHEMA),
    'the connection must be pinned to the throwaway schema',
  );
});

beforeEach(async () => {
  if (skip) return;
  for (const table of [
    'coupon_redemptions',
    'coupon_targets',
    'coupons',
    'order_status_history',
    'order_addresses',
    'order_items',
    'orders',
    'users',
  ]) {
    await sql.unsafe(`delete from ${table}`);
  }
});

after(async () => {
  if (skip) return;
  try {
    if (sql) await dropFixtureSchema(sql, SCHEMA);
  } catch (error) {
    console.warn('[coupon-order] cleanup did not finish:', error?.message ?? error);
  }
  if (sql) await sql.end({ timeout: 5 });
});

/* -------------------------------------------------- free shipping, end to end */

test('free shipping zeroes the shipping charge, the order total and the PayU amount', { skip }, async () => {
  await insertCoupon({ code: 'SHIPFREE', type: 'FREE_SHIPPING', value: 0 });
  const txnid = newTxnid();

  const created = await createOrderUsing(sql, orderParams({
    txnid,
    items: [item('p_free', 20000)],
    subtotalPaise: 20000,
    shippingPaise: 4900,
    coupon: { code: 'SHIPFREE' },
  }));

  const order = created.order;
  assert.equal(order.shippingPaise, 0, 'the shipping charge is gone');
  assert.equal(order.discountPaise, 0, 'no line value is discounted');
  assert.equal(order.subtotalPaise, 20000);
  assert.equal(order.totalPaise, 20000);
  assert.equal(order.amount, 200, 'the amount PayU is asked for equals the total');

  const row = (await sql`select shipping_paise, total_paise, amount from orders where txnid = ${txnid}`)[0];
  assert.equal(Number(row.shipping_paise), 0);
  assert.equal(Number(row.total_paise), 20000);
  assert.equal(Number(row.amount), 200);

  assert.deepEqual(await lineDiscounts(order.id), [
    { productId: 'p_free', discountPaise: 0 },
  ]);

  const redemptions = await redemptionRows(order.id);
  assert.equal(redemptions.length, 1);
  assert.equal(String(redemptions[0].state), 'RESERVED');
  assert.equal(Number(redemptions[0].discount_paise), 0);

  // A refund is capped at what was captured. With free shipping, captured is
  // exactly the subtotal, so a full refund is possible and one paise more is
  // refused — the free-shipping coupon cannot make the order over-refundable.
  const full = checkRefund({
    amountPaise: order.totalPaise,
    capturedPaise: order.totalPaise,
    refundedPaise: 0,
  });
  assert.equal(full.ok, true);
  const over = checkRefund({
    amountPaise: order.totalPaise + 1,
    capturedPaise: order.totalPaise,
    refundedPaise: 0,
  });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'refund-exceeds-captured');
});

/* ----------------------------------------------------------- sale items */

test('sale-priced lines are skipped unless the code allows sale prices', { skip }, async () => {
  await insertCoupon({ code: 'NOSALE', value: 10, scope: 'ORDER' });
  const txnid = newTxnid();

  const created = await createOrderUsing(sql, orderParams({
    txnid,
    items: [
      item('p_sale', 20000, { onSale: true }),
      item('p_full', 30000, { onSale: false }),
    ],
    subtotalPaise: 50000,
    shippingPaise: 0,
    coupon: { code: 'NOSALE' },
  }));

  const order = created.order;
  assert.equal(order.discountPaise, 3000, 'only the full-price line is discounted');
  assert.equal(order.totalPaise, 47000);
  assert.deepEqual(await lineDiscounts(order.id), [
    { productId: 'p_sale', discountPaise: 0 },
    { productId: 'p_full', discountPaise: 3000 },
  ]);

  const allowed = await insertCoupon({
    code: 'YESALE',
    value: 10,
    scope: 'ORDER',
    allow_with_sale_price: true,
  });
  assert.equal(allowed.allow_with_sale_price, true);
  const withSale = await createOrderUsing(sql, orderParams({
    txnid: newTxnid(),
    items: [
      item('p_sale2', 20000, { onSale: true }),
      item('p_full2', 30000, { onSale: false }),
    ],
    subtotalPaise: 50000,
    shippingPaise: 0,
    coupon: { code: 'YESALE' },
  }));
  assert.equal(withSale.order.discountPaise, 5000);
});

/* --------------------------------------------------------------- scopes */

test('category and brand scopes discount only the matching lines', { skip }, async () => {
  const byCategory = await insertCoupon({ code: 'CAT10', value: 10, scope: 'CATEGORIES' });
  await sql`
    insert into coupon_targets (coupon_id, category_id)
    values (${byCategory.id}, ${'cat_a'})
  `;

  const categoryOrder = await createOrderUsing(sql, orderParams({
    txnid: newTxnid(),
    items: [
      item('p1', 20000, { categoryId: 'cat_a' }),
      item('p2', 10000, { categoryId: 'cat_b' }),
    ],
    subtotalPaise: 30000,
    shippingPaise: 0,
    coupon: { code: 'CAT10' },
  }));
  assert.equal(categoryOrder.order.discountPaise, 2000);
  assert.deepEqual(await lineDiscounts(categoryOrder.order.id), [
    { productId: 'p1', discountPaise: 2000 },
    { productId: 'p2', discountPaise: 0 },
  ]);

  const byBrand = await insertCoupon({ code: 'BRAND10', value: 10, scope: 'BRANDS' });
  await sql`
    insert into coupon_targets (coupon_id, brand_id)
    values (${byBrand.id}, ${'brand_b'})
  `;

  const brandOrder = await createOrderUsing(sql, orderParams({
    txnid: newTxnid(),
    items: [
      item('p3', 20000, { brandId: 'brand_a' }),
      item('p4', 10000, { brandId: 'brand_b' }),
    ],
    subtotalPaise: 30000,
    shippingPaise: 0,
    coupon: { code: 'BRAND10' },
  }));
  assert.equal(brandOrder.order.discountPaise, 1000);
  assert.deepEqual(await lineDiscounts(brandOrder.order.id), [
    { productId: 'p3', discountPaise: 0 },
    { productId: 'p4', discountPaise: 1000 },
  ]);
});

/* -------------------------------------------------- no benefit, no record */

test('a code that takes nothing off creates no order and no redemption', { skip }, async () => {
  await insertCoupon({ code: 'SHIPFREE', type: 'FREE_SHIPPING', value: 0 });
  const txnid = newTxnid();

  await assert.rejects(
    createOrderUsing(sql, orderParams({
      txnid,
      items: [item('p_free', 20000)],
      subtotalPaise: 20000,
      shippingPaise: 0,
      coupon: { code: 'SHIPFREE' },
    })),
    (error) => {
      assert.equal(error?.name, 'CouponRejectedError');
      assert.equal(error.reason, 'no_discount');
      return true;
    },
  );

  assert.equal(Number((await sql`select count(*)::int as n from orders`)[0].n), 0);
  assert.equal(
    Number((await sql`select count(*)::int as n from coupon_redemptions`)[0].n),
    0,
    'a zero-value use is never recorded',
  );
});

test('a scoped code with no matching line is refused before any write', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'CASE10', value: 10, scope: 'PRODUCTS' });
  await sql`
    insert into coupon_targets (coupon_id, product_id)
    values (${coupon.id}, ${'product_elsewhere'})
  `;

  await assert.rejects(
    createOrderUsing(sql, orderParams({
      txnid: newTxnid(),
      items: [item('p_other', 20000)],
      subtotalPaise: 20000,
      shippingPaise: 0,
      coupon: { code: 'CASE10' },
    })),
    (error) => {
      assert.equal(error?.name, 'CouponRejectedError');
      assert.equal(error.reason, 'no_eligible_items');
      assert.equal(error.message, 'This code is not valid for your cart.');
      return true;
    },
  );

  assert.equal(Number((await sql`select count(*)::int as n from orders`)[0].n), 0);
  assert.equal(Number((await sql`select count(*)::int as n from coupon_redemptions`)[0].n), 0);
});

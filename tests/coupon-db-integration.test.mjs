/**
 * Coupon limits and the redemption lifecycle, against PostgreSQL.
 *
 * These tests exercise the database half of the coupon rules: the counts come
 * from the database on the database clock, and a redemption is taken under a
 * `for update` row lock, so two buyers cannot both take the last use. The
 * lifecycle (RESERVED → CONSUMED / RELEASED, duplicate callbacks, late
 * payments, refunds) is exercised through the same helpers checkout uses.
 *
 * The schema is a throwaway copy in a temporary schema; the tests are skipped
 * when DATABASE_URL is unset or points at a transaction pooler (temporary
 * schemas need a session connection).
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

if (!process.env.DATABASE_URL) {
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

const skip = !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  const { isPooler } = connectionDetails();
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  consumeCouponInTx,
  evaluateCouponFromDatabase,
  insertReservedRedemption,
  loadCouponDefinition,
  lookupCouponForCart,
  releaseConsumedCouponOnRefund,
  releaseCouponInTx,
  restoreCouponAfterLatePayment,
} = await jiti.import(path.join(root, 'src', 'lib', 'coupons', 'store.ts'));

const { MIN_PAYABLE_PAISE } = await jiti.import(
  path.join(root, 'src', 'lib', 'coupons', 'rules.ts'),
);

const { archiveCouponOnDelete } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'coupons.ts'),
);

/* ------------------------------------------------------------- fixtures */

const SCHEMA = `itest_coupons_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

let sql;
let secondSql;

function line(overrides = {}) {
  const quantity = overrides.quantity ?? 1;
  const unitPaise = overrides.unitPaise ?? 10000;
  return {
    productId: 'product_1',
    categoryId: 'category_1',
    brandId: 'brand_1',
    quantity,
    unitPaise,
    linePaise: unitPaise * quantity,
    onSale: false,
    ...overrides,
  };
}

function cart(overrides = {}) {
  const lines = overrides.lines ?? [line()];
  return {
    lines,
    subtotalPaise: lines.reduce((sum, entry) => sum + entry.linePaise, 0),
    shippingPaise: overrides.shippingPaise ?? 0,
    customer: overrides.customer ?? { userId: 'user_a', email: 'a@example.com', group: null },
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
    total_redemption_limit: null,
    per_customer_limit: null,
    min_order_paise: 0,
    max_discount_paise: null,
    allow_with_sale_price: false,
    only_new_customers: false,
    allowed_customer_groups: null,
    restricted_to_emails: null,
    starts_at: null,
    ends_at: null,
    ...overrides,
  };
  await sql`
    insert into coupons (
      id, code, name, type, value, scope, status,
      total_redemption_limit, per_customer_limit, min_order_paise, max_discount_paise,
      allow_with_sale_price, only_new_customers, allowed_customer_groups,
      restricted_to_emails, starts_at, ends_at
    ) values (
      ${row.id}, ${row.code}, ${'Test coupon'}, ${row.type}, ${row.value}, ${row.scope},
      ${row.status}, ${row.total_redemption_limit}, ${row.per_customer_limit},
      ${row.min_order_paise}, ${row.max_discount_paise}, ${row.allow_with_sale_price},
      ${row.only_new_customers}, ${row.allowed_customer_groups},
      ${row.restricted_to_emails}, ${row.starts_at}, ${row.ends_at}
    )
  `;
  return row;
}

async function insertOrder(id, status = 'PENDING') {
  await sql`
    insert into orders (id, status, user_id, customer_email)
    values (${id}, ${status}, ${'user_a'}, ${'a@example.com'})
    on conflict (id) do nothing
  `;
}

async function reserve(coupon, orderId, customerEmail = 'a@example.com', userId = 'user_a', discountPaise = 1000) {
  await insertOrder(orderId);
  await insertReservedRedemption(sql, {
    couponId: coupon.id,
    orderId,
    customerUserId: userId,
    customerEmail,
    discountPaise,
  });
}

async function redemptionState(orderId) {
  const rows = await sql`select state, release_reason from coupon_redemptions where order_id = ${orderId}`;
  return rows[0] ?? null;
}

before(async () => {
  if (skip) return;
  sql = client();
  secondSql = client();
  await sql.unsafe(`create schema "${SCHEMA}"`);
  await sql.unsafe(`set search_path to "${SCHEMA}"`);
  await secondSql.unsafe(`set search_path to "${SCHEMA}"`);

  // The coupon table is copied from the real one, so its constraints and
  // indexes are the shipped ones. The other three are the minimum columns the
  // helpers read; their foreign keys point outside this throwaway schema.
  await sql.unsafe(`create table coupons (like public.coupons including all)`);
  await sql.unsafe(`
    create table coupon_targets (
      id bigserial primary key,
      coupon_id text not null,
      product_id text,
      category_id text,
      brand_id text
    )
  `);
  await sql.unsafe(`
    create table coupon_redemptions (
      id bigserial primary key,
      coupon_id text not null,
      order_id text not null,
      customer_user_id text,
      customer_email text not null default '',
      discount_paise bigint not null default 0,
      state text not null default 'RESERVED',
      created_at timestamptz not null default now(),
      consumed_at timestamptz,
      released_at timestamptz,
      release_reason text,
      unique (coupon_id, order_id)
    )
  `);
  await sql.unsafe(`create table users (id text primary key, customer_group text)`);
  await sql.unsafe(`
    create table orders (
      id text primary key,
      status text,
      user_id text,
      customer_email text
    )
  `);
});

beforeEach(async () => {
  if (skip) return;
  await sql.unsafe(`delete from coupon_redemptions`);
  await sql.unsafe(`delete from coupon_targets`);
  await sql.unsafe(`delete from orders`);
  await sql.unsafe(`delete from coupons`);
});

after(async () => {
  if (skip) return;
  try {
    await sql.unsafe('set search_path to public');
    await sql.unsafe(`drop schema if exists "${SCHEMA}" cascade`);
  } catch (error) {
    console.warn('[coupon-db] cleanup did not finish:', error?.message ?? error);
  }
  await sql.end({ timeout: 5 });
  await secondSql.end({ timeout: 5 });
});

/* ---------------------------------------------------------------- reads */

test('a valid code is priced from the database subtotal', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'SAVE10', value: 10 });

  const { coupon: loaded, evaluation } = await lookupCouponForCart(sql, ' save10 ', cart());
  assert.equal(loaded.id, coupon.id);
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.discountPaise, 1000);
  assert.equal(evaluation.totalPaise, 9000);

  const aboveFloor = await lookupCouponForCart(sql, 'SAVE10', cart({ lines: [line({ unitPaise: 50 })] }));
  assert.equal(aboveFloor.evaluation.ok, false);
  assert.equal(aboveFloor.evaluation.reason, 'below_minimum_payable');
  assert.ok(MIN_PAYABLE_PAISE >= 100);
});

test('an unknown code answers the generic refusal', { skip }, async () => {
  const { coupon, evaluation } = await lookupCouponForCart(sql, 'NOPE', cart());
  assert.equal(coupon, null);
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.reason, 'not_found');
  assert.equal(evaluation.message, 'This code is not valid for your cart.');
});

test('a scoped coupon loads its targets and only discounts matching lines', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'CASE10', scope: 'PRODUCTS', value: 10 });
  await sql`
    insert into coupon_targets (coupon_id, product_id)
    values (${coupon.id}, ${'product_2'})
  `;

  const scoped = cart({
    lines: [line({ productId: 'product_1' }), line({ productId: 'product_2' })],
  });
  const { coupon: loaded, evaluation } = await lookupCouponForCart(sql, 'CASE10', scoped);
  assert.equal(loaded.targets.length, 1);
  assert.equal(loaded.targets[0].productId, 'product_2');
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.discountPaise, 1000);
  assert.deepEqual(evaluation.allocations, [0, 1000]);
});

test('category and brand targets load and match a mixed cart', { skip }, async () => {
  const byCategory = await insertCoupon({ code: 'CAT10', scope: 'CATEGORIES' });
  await sql`
    insert into coupon_targets (coupon_id, category_id)
    values (${byCategory.id}, ${'cat_a'})
  `;
  const categoryResult = await lookupCouponForCart(sql, 'CAT10', cart({
    lines: [
      line({ productId: 'p1', categoryId: 'cat_a' }),
      line({ productId: 'p2', categoryId: 'cat_b' }),
    ],
  }));
  assert.equal(categoryResult.evaluation.ok, true);
  assert.equal(categoryResult.evaluation.discountPaise, 1000);
  assert.deepEqual(categoryResult.evaluation.eligibleLineIndexes, [0]);

  const byBrand = await insertCoupon({ code: 'BRAND10', scope: 'BRANDS' });
  await sql`
    insert into coupon_targets (coupon_id, brand_id)
    values (${byBrand.id}, ${'brand_b'})
  `;
  const brandResult = await lookupCouponForCart(sql, 'BRAND10', cart({
    lines: [
      line({ productId: 'p3', brandId: 'brand_a' }),
      line({ productId: 'p4', brandId: 'brand_b' }),
    ],
  }));
  assert.equal(brandResult.evaluation.ok, true);
  assert.equal(brandResult.evaluation.discountPaise, 1000);
  assert.deepEqual(brandResult.evaluation.eligibleLineIndexes, [1]);
});

test('sale-priced lines are skipped and the cart sees the sale message', { skip }, async () => {
  await insertCoupon({ code: 'NOSALE', value: 10 });
  const saleLine = line({ productId: 'sale', unitPaise: 20000, onSale: true });
  const fullLine = line({ productId: 'full', unitPaise: 30000, onSale: false });

  const mixed = await lookupCouponForCart(sql, 'NOSALE', cart({ lines: [saleLine, fullLine] }));
  assert.equal(mixed.evaluation.ok, true);
  assert.equal(mixed.evaluation.discountPaise, 3000);
  assert.deepEqual(mixed.evaluation.eligibleLineIndexes, [1]);
  assert.equal(mixed.evaluation.message, 'Not valid on sale items.');

  const onlySale = await lookupCouponForCart(sql, 'NOSALE', cart({ lines: [saleLine] }));
  assert.equal(onlySale.evaluation.ok, false);
  assert.equal(onlySale.evaluation.reason, 'sale_items_excluded');
  assert.equal(onlySale.evaluation.message, 'This code is not valid on sale items.');
});

/* --------------------------------------------------------------- limits */

test('a RESERVED use counts against the total limit, a RELEASED one does not', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'ONCE', total_redemption_limit: 1 });

  const first = await lookupCouponForCart(sql, 'ONCE', cart());
  assert.equal(first.evaluation.ok, true);

  await reserve(coupon, 'order_1');

  const second = await lookupCouponForCart(sql, 'ONCE', cart({
    customer: { userId: 'user_b', email: 'b@example.com', group: null },
  }));
  assert.equal(second.evaluation.ok, false);
  assert.equal(second.evaluation.reason, 'used_up');
  assert.equal(second.evaluation.message, 'This code is no longer available.');

  assert.equal(await releaseCouponInTx(sql, 'order_1', 'reservation expired'), true);

  const third = await lookupCouponForCart(sql, 'ONCE', cart({
    customer: { userId: 'user_b', email: 'b@example.com', group: null },
  }));
  assert.equal(third.evaluation.ok, true);
});

test('the per-customer limit counts the signed-in user and their email', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'PERONE', per_customer_limit: 1 });
  await reserve(coupon, 'order_1', 'a@example.com', 'user_a');

  const sameUser = await lookupCouponForCart(sql, 'PERONE', cart({
    customer: { userId: 'user_a', email: 'other@example.com', group: null },
  }));
  assert.equal(sameUser.evaluation.reason, 'already_used');

  const sameEmail = await lookupCouponForCart(sql, 'PERONE', cart({
    customer: { userId: null, email: 'A@Example.com', group: null },
  }));
  assert.equal(sameEmail.evaluation.reason, 'already_used');

  const someoneElse = await lookupCouponForCart(sql, 'PERONE', cart({
    customer: { userId: 'user_b', email: 'b@example.com', group: null },
  }));
  assert.equal(someoneElse.evaluation.ok, true);
});

test('only_new_customers reads the paid-order history by user or email', { skip }, async () => {
  await insertCoupon({ code: 'NEW10', only_new_customers: true });

  const fresh = await lookupCouponForCart(sql, 'NEW10', cart());
  assert.equal(fresh.evaluation.ok, true);

  await sql`
    insert into orders (id, status, user_id, customer_email)
    values ('paid_1', 'PAID', 'someone_else', 'a@example.com')
  `;
  const known = await lookupCouponForCart(sql, 'NEW10', cart());
  assert.equal(known.evaluation.ok, false);
  assert.equal(known.evaluation.reason, 'not_eligible_customer');
});

test('the group is read from the users row on the database clock', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'VIP10', allowed_customer_groups: ['vip'] });
  await sql`insert into users (id, customer_group) values ('user_a', 'vip')`;

  const evaluation = await lookupCouponForCart(sql, 'VIP10', cart());
  assert.equal(evaluation.evaluation.ok, true);

  await sql`update users set customer_group = 'retail' where id = 'user_a'`;
  const after = await lookupCouponForCart(sql, 'VIP10', cart());
  assert.equal(after.evaluation.reason, 'not_eligible_customer');
});

/* ----------------------------------------------------------------- lock */

test('the row lock serialises two buyers competing for the last use', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'LAST', total_redemption_limit: 1 });
  await insertOrder('order_first');
  await insertOrder('order_second');

  let firstLocked;
  const firstHasLock = new Promise((resolve) => {
    firstLocked = resolve;
  });

  const first = sql.begin(async (tx) => {
    const locked = await loadCouponDefinition(tx, 'LAST', { forUpdate: true });
    const evaluation = await evaluateCouponFromDatabase(tx, locked, cart());
    assert.equal(evaluation.ok, true, 'the first buyer wins');
    await insertReservedRedemption(tx, {
      couponId: locked.id,
      orderId: 'order_first',
      customerUserId: 'user_a',
      customerEmail: 'a@example.com',
      discountPaise: evaluation.discountPaise,
    });
    firstLocked();
    // Hold the lock long enough for the second transaction to queue on it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return evaluation;
  });

  await firstHasLock;

  const second = secondSql.begin(async (tx) => {
    const locked = await loadCouponDefinition(tx, 'LAST', { forUpdate: true });
    const evaluation = await evaluateCouponFromDatabase(tx, locked, cart({
      customer: { userId: 'user_b', email: 'b@example.com', group: null },
    }));
    if (evaluation.ok) {
      await insertReservedRedemption(tx, {
        couponId: locked.id,
        orderId: 'order_second',
        customerUserId: 'user_b',
        customerEmail: 'b@example.com',
        discountPaise: evaluation.discountPaise,
      });
    }
    return evaluation;
  });

  const [firstEvaluation, secondEvaluation] = await Promise.all([first, second]);
  assert.equal(firstEvaluation.ok, true);
  assert.equal(secondEvaluation.ok, false);
  assert.equal(secondEvaluation.reason, 'used_up', 'the second buyer sees the first use');

  const rows = await sql`select order_id from coupon_redemptions where coupon_id = ${coupon.id}`;
  assert.deepEqual(rows.map((row) => row.order_id), ['order_first']);
});

/* ------------------------------------------------------------ lifecycle */

test('a reservation is consumed once, and duplicate callbacks are no-ops', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'LIFE10' });
  await reserve(coupon, 'order_life');

  assert.equal(await consumeCouponInTx(sql, 'order_life'), true);
  assert.equal(await redemptionState('order_life').then((row) => row.state), 'CONSUMED');
  assert.equal(await consumeCouponInTx(sql, 'order_life'), false, 'a duplicate callback is ignored');
  assert.equal(await releaseCouponInTx(sql, 'order_life', 'too late'), false, 'a consumed use is not released');
});

test('a released reservation cannot be consumed or released twice', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'REL10' });
  await reserve(coupon, 'order_rel');

  assert.equal(await releaseCouponInTx(sql, 'order_rel', 'reservation expired'), true);
  const row = await redemptionState('order_rel');
  assert.equal(row.state, 'RELEASED');
  assert.equal(row.release_reason, 'reservation expired');

  assert.equal(await releaseCouponInTx(sql, 'order_rel', 'again'), false);
  assert.equal(await consumeCouponInTx(sql, 'order_rel'), false);
});

test('a late verified payment restores a released use when the limit allows', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'LATE10', per_customer_limit: 1 });
  await reserve(coupon, 'order_late');
  await releaseCouponInTx(sql, 'order_late', 'reservation expired');

  assert.equal(await restoreCouponAfterLatePayment(sql, 'order_late'), 'restored');
  assert.equal((await redemptionState('order_late')).state, 'CONSUMED');
  assert.equal(await restoreCouponAfterLatePayment(sql, 'order_late'), 'none', 'already consumed');
  assert.equal(await restoreCouponAfterLatePayment(sql, 'missing_order'), 'none');
});

test('a late payment that cannot restore is flagged for review, not deleted', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'FULL10', total_redemption_limit: 1 });
  await reserve(coupon, 'order_late');
  await releaseCouponInTx(sql, 'order_late', 'reservation expired');

  // Someone else has taken the only use in the meantime.
  await reserve(coupon, 'order_other', 'c@example.com', 'user_c');

  assert.equal(await restoreCouponAfterLatePayment(sql, 'order_late'), 'limit-unavailable');
  assert.equal((await redemptionState('order_late')).state, 'RELEASED');
  assert.equal((await redemptionState('order_other')).state, 'RESERVED');
});

test('a refund restores a consumed use only through the explicit helper', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'REFUND10' });
  await reserve(coupon, 'order_refund');
  await consumeCouponInTx(sql, 'order_refund');

  // The plain release path never takes a consumed use back.
  assert.equal(await releaseCouponInTx(sql, 'order_refund', 'refund'), false);
  assert.equal((await redemptionState('order_refund')).state, 'CONSUMED');

  assert.equal(await releaseConsumedCouponOnRefund(sql, 'order_refund', 'full refund'), true);
  const row = await redemptionState('order_refund');
  assert.equal(row.state, 'RELEASED');
  assert.equal(row.release_reason, 'full refund');
});

test('a duplicate reservation for the same order is not double-counted', { skip }, async () => {
  const coupon = await insertCoupon({ code: 'DUP10', total_redemption_limit: 2 });
  await reserve(coupon, 'order_dup');
  await reserve(coupon, 'order_dup');

  const rows = await sql`select count(*)::int as total from coupon_redemptions where order_id = 'order_dup'`;
  assert.equal(rows[0].total, 1);
});

/* ------------------------------------------------ retirement and deletion */

test('DELETE archives an unused coupon and refuses one with any redemption', { skip }, async () => {
  const unused = await insertCoupon({ code: 'UNUSED1' });
  const archived = await archiveCouponOnDelete(unused.id, sql);
  assert.equal(archived.ok, true);
  assert.equal(archived.data.deleted, false);
  assert.equal(archived.data.after.status, 'archived');

  const archivedRow = (await sql`
    select status, archived_at from coupons where id = ${unused.id}
  `)[0];
  assert.equal(String(archivedRow.status), 'archived');
  assert.ok(archivedRow.archived_at, 'the archive timestamp is written');

  const used = await insertCoupon({ code: 'USED1' });
  await reserve(used, 'order_used');
  const refused = await archiveCouponOnDelete(used.id, sql);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'conflict');
  assert.match(refused.error, /Archive it instead/);
  assert.equal(
    String((await sql`select status from coupons where id = ${used.id}`)[0].status),
    'active',
    'a coupon with usage is left untouched',
  );

  // A RELEASED use is still history, so the row still cannot be deleted.
  await releaseCouponInTx(sql, 'order_used', 'reservation expired');
  assert.equal((await archiveCouponOnDelete(used.id, sql)).ok, false);

  const missing = await archiveCouponOnDelete('coupon_missing', sql);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'not-found');

  const remaining = await sql`select count(*)::int as n from coupons`;
  assert.equal(remaining[0].n, 2, 'no coupon row is ever removed');
});

/* ------------------------------------------------ the checkout authority */

test('the order transaction validates through the same rules, not the request body', async () => {
  const source = await readFile(path.join(root, 'src', 'lib', 'payu', 'orders.ts'), 'utf8');
  assert.match(source, /loadCouponDefinition\(tx, code, \{ forUpdate: true \}\)/);
  assert.match(source, /evaluateCouponFromDatabase\(tx/);
  assert.match(source, /evaluate\.allocations|evaluation\.allocations/);
  assert.match(source, /couponSnapshot\(/);
  // Only the code and an expected total may come from the browser.
  assert.doesNotMatch(source, /body\.(discount|discountPaise|totalPaise|couponId)/);
});

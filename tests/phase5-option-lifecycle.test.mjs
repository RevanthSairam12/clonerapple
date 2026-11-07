/**
 * Phase 5, database half: one option's stock through a whole order life.
 *
 * Real PostgreSQL, real transactions and the real stock engine, all inside a
 * throwaway `itest_*` schema copied from the deployed tables. Nothing in
 * `public` is read or written, and cleanup is a single `drop schema`.
 *
 * Skipped unless `RUN_LEGACY_DB_TESTS=1` and a session (not port 6543)
 * `DATABASE_URL` are supplied, so it can never touch a live store by accident.
 *
 * The offline half — labels, report copy and source contracts — is
 * `phase5-option-admin-surfaces.test.mjs`.
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

function fixtureConnectionUrl() {
  return (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
}

function connectionDetails() {
  const url = new URL(fixtureConnectionUrl());
  return { transactionPooler: url.port === '6543' };
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !fixtureConnectionUrl()
    ? 'DATABASE_MIGRATION_URL / DATABASE_URL is not set'
    : connectionDetails().transactionPooler
      ? 'temporary-schema isolation needs a session connection (not port 6543)'
      : false;

function client(schema = 'pg_catalog') {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  const raw = fixtureConnectionUrl();
  const url = new URL(raw);
  if (url.port === '6543') throw new Error('Requires a session connection, not port 6543.');
  return postgres(raw, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 1800,
    connection: { search_path: schema, statement_timeout: 20000 },
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !(url.hostname.includes('pooler') && url.port === '6543'),
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});
const { createOrderUsing, transitionOrderStatusUsing, releaseOrderReservation } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'orders.ts'),
);
const { restoreSoldStock } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'stock.ts'),
);
const { resolveCartItemsFromDbUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'db-catalog.ts'),
);
const { updateVariantPricingUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'product-draft.ts'),
);
const { listStockOverview, getStockDetail } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'catalog-crud.ts'),
);
const { listLowStock } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'catalog.ts'),
);

const TABLES = [
  'categories',
  'products',
  'product_types',
  'product_variants',
  'product_device_models',
  'device_brands',
  'device_models',
  'colours',
  'product_variant_colours',
  'product_images',
  'sale_settings',
  'stock',
  'stock_movements',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'store_settings',
  'store_admins',
  'store_admin_audit',
  'price_history',
  'coupons',
  'coupon_redemptions',
];

const POLICY = { reservationSeconds: 600, failureGraceSeconds: 0, unresolvedMinutes: 60 };

function suffix() {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

function fixtureKeys(tag) {
  return {
    categoryId: `itestcat${tag}`,
    brandId: `itestbrand${tag}`,
    modelId: `itestmodel${tag}`,
    productId: `itestprod${tag}`,
    redId: `itestred${tag}`,
    blueId: `itestblue${tag}`,
    redSku: `ITEST-RED-${tag}`,
    blueSku: `ITEST-BLUE-${tag}`,
    redStockId: `iteststkred${tag}`,
    blueStockId: `iteststkblue${tag}`,
    staffId: `iteststaff${tag}`,
    redOnHand: 3,
    blueOnHand: 3,
    threshold: 3,
  };
}

async function seedOptions(sql, k) {
  // Checkout's authoritative sale read requires the single settings row.
  await sql`insert into sale_settings (id) values ('default')`;
  await sql`insert into categories (id, slug, name) values (${k.categoryId}, ${k.categoryId}, 'Options category')`;
  await sql`insert into device_brands (id, name) values (${k.brandId}, 'Apple')`;
  await sql`insert into device_models (id, brand_id, name) values (${k.modelId}, ${k.brandId}, 'iPhone 16')`;
  await sql`
    insert into products (id, category_id, slug, name, price_paise, inventory_mode, is_active)
    values (${k.productId}, ${k.categoryId}, ${k.productId}, 'Fixture phone', 50000, 'variant', true)
  `;
  await sql`
    insert into product_variants (
      id, product_id, sku, option_name, option_value, is_purchasable, is_active,
      device_model_id, combination_key
    ) values
      (${k.redId}, ${k.productId}, ${k.redSku}, 'Colour', 'Red', true, true, ${k.modelId}, ${k.redId}),
      (${k.blueId}, ${k.productId}, ${k.blueSku}, 'Colour', 'Blue', true, true, ${k.modelId}, ${k.blueId})
  `;
  await sql`
    insert into product_device_models (product_id, device_model_id)
    values (${k.productId}, ${k.modelId})
  `;
  await sql`
    insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold)
    values
      (${k.redStockId}, ${k.productId}, ${k.redId}, ${k.redOnHand}, 0, true, ${k.threshold}),
      (${k.blueStockId}, ${k.productId}, ${k.blueId}, ${k.blueOnHand}, 0, true, ${k.threshold})
  `;
  // Fixture-only identity: a throwaway schema and a password hash that cannot log in.
  await sql`
    insert into store_admins (id, email, password_hash, name, role)
    values (${k.staffId}, ${`${k.staffId}@example.invalid`}, 'fixture-only-not-a-credential', 'Fixture staff', 'store_owner')
  `;
}

function orderParams({ k, txnid, variantId, quantity = 1, unitPrice = 500, reservationSeconds = 600, withModel = true }) {
  return {
    txnid,
    items: [{
      id: k.productId,
      name: 'Fixture phone',
      variantId,
      variantSku: variantId === k.redId ? k.redSku : k.blueSku,
      variantLabel: 'iPhone 16 / Red',
      ...(withModel ? { deviceModelId: k.modelId, deviceModelName: 'iPhone 16' } : {}),
      quantity,
      unitPrice,
      totalPrice: unitPrice * quantity,
    }],
    subtotalPaise: unitPrice * quantity * 100,
    shippingPaise: 0,
    totalPaise: unitPrice * quantity * 100,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: 'Option Buyer',
    customerEmail: 'option-buyer@example.test',
    customerPhone: '9000000001',
    reservationSeconds,
    shippingAddress: {
      name: 'Option Buyer',
      phone: '9000000001',
      line1: '1 Test Lane',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
  };
}

async function stockRows(sql, k) {
  const rows = await sql`
    select variant_id, on_hand, reserved from stock
    where product_id = ${k.productId}
    order by variant_id
  `;
  const byVariant = new Map(rows.map((row) => [String(row.variant_id), {
    onHand: Number(row.on_hand),
    reserved: Number(row.reserved),
  }]));
  return {
    red: byVariant.get(k.redId) ?? { onHand: 0, reserved: 0 },
    blue: byVariant.get(k.blueId) ?? { onHand: 0, reserved: 0 },
  };
}

async function movementsFor(sql, orderId) {
  const rows = await sql`
    select variant_id, delta, reason from stock_movements
    where order_id = ${orderId} order by id asc
  `;
  return rows.map((row) => ({
    variantId: row.variant_id === null ? null : String(row.variant_id),
    delta: Number(row.delta),
    reason: String(row.reason),
  }));
}

/** Every stock number must equal its opening count plus the ledger. */
async function assertLedgerMatchesStock(sql, k, opening) {
  const rows = await sql`
    select s.variant_id, s.on_hand,
           coalesce((
             select sum(m.delta)::int from stock_movements m
             where m.product_id = s.product_id
               and m.variant_id is not distinct from s.variant_id
           ), 0) as ledger
    from stock s
    where s.product_id = ${k.productId}
    order by s.variant_id
  `;
  assert.equal(rows.length, 2, 'one stock row per option');
  for (const row of rows) {
    const variantId = String(row.variant_id);
    const start = variantId === k.redId ? opening.red : opening.blue;
    assert.equal(
      Number(row.on_hand) - Number(row.ledger),
      start,
      `option ${variantId}: on hand must equal opening + ledger`,
    );
  }
}

test('one option through claim, payment, failure, cancel, expiry, late capture and return', { skip }, async () => {
  const tag = suffix();
  const schema = `itest_${tag}`;
  const k = fixtureKeys(tag);
  const a = client();

  try {
    await createFixtureSchema(a, schema, TABLES);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is not pinned to the fixture schema');
    await seedOptions(a, k);

    // 1. Checkout claims the exact option and leaves its sibling alone.
    const order1 = await createOrderUsing(a, orderParams({ k, txnid: `ITEST1${tag}`, variantId: k.redId }));
    assert.equal(order1.stockClaimed, true);
    let stock = await stockRows(a, k);
    assert.equal(stock.red.onHand, 2, 'only the red option loses a unit');
    assert.equal(stock.blue.onHand, 3, 'blue is untouched');
    let movements = await movementsFor(a, order1.order.id);
    assert.deepEqual(movements, [{ variantId: k.redId, delta: -1, reason: 'sale' }]);
    assert.equal(order1.order.reservationState, 'ACTIVE');

    const lines = await a`
      select variant_id, unit_price_paise, variant_device_model_name, variant_colour_name
      from order_items where order_id = ${order1.order.id}
    `;
    assert.equal(lines.length, 1);
    assert.equal(String(lines[0].variant_id), k.redId, 'the line keeps the exact option');
    assert.equal(lines[0].variant_device_model_name, 'iPhone 16');

    // 2. Verified payment consumes the hold without a second deduction.
    const paid = await transitionOrderStatusUsing(a, { txnid: `ITEST1${tag}`, targetStatus: 'PAID' });
    assert.equal(paid.firstTimePaid, true);
    assert.equal(paid.order.reservationState, 'CONSUMED');
    assert.equal(paid.stockReleased, false);
    assert.equal(paid.stockReclaimed, false);
    stock = await stockRows(a, k);
    assert.equal(stock.red.onHand, 2, 'paying does not deduct twice');
    movements = await movementsFor(a, order1.order.id);
    assert.equal(movements.length, 1, 'paying writes no stock movement');

    // 3. A duplicate callback changes nothing.
    const duplicatePaid = await transitionOrderStatusUsing(a, { txnid: `ITEST1${tag}`, targetStatus: 'PAID' });
    assert.equal(duplicatePaid.transitioned, false);
    stock = await stockRows(a, k);
    assert.equal(stock.red.onHand, 2);
    assert.equal((await movementsFor(a, order1.order.id)).length, 1);

    // 4. A failed payment releases its claim exactly once.
    const order2 = await createOrderUsing(a, orderParams({ k, txnid: `ITEST2${tag}`, variantId: k.redId }));
    assert.equal((await stockRows(a, k)).red.onHand, 1);
    const failed = await transitionOrderStatusUsing(a, {
      txnid: `ITEST2${tag}`,
      targetStatus: 'FAILED',
      policy: POLICY,
    });
    assert.equal(failed.stockReleased, true);
    assert.equal(failed.order.reservationState, 'RELEASED');
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    assert.deepEqual(await movementsFor(a, order2.order.id), [
      { variantId: k.redId, delta: -1, reason: 'sale' },
      { variantId: k.redId, delta: 1, reason: 'release' },
    ]);

    const duplicateFailed = await transitionOrderStatusUsing(a, {
      txnid: `ITEST2${tag}`,
      targetStatus: 'FAILED',
      policy: POLICY,
    });
    assert.equal(duplicateFailed.transitioned, false);
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    assert.equal((await movementsFor(a, order2.order.id)).length, 2, 'no second release');

    // 5. A failed order cannot be released again by cancelling it.
    const cancelAfterFailure = await transitionOrderStatusUsing(a, {
      txnid: `ITEST2${tag}`,
      targetStatus: 'CANCELLED',
      cancelReason: 'customer cancelled',
      policy: POLICY,
    });
    assert.equal(cancelAfterFailure.transitioned, false);
    assert.equal((await stockRows(a, k)).red.onHand, 2);

    // 6. Cancelling an order that still holds its claim releases once.
    const order3 = await createOrderUsing(a, orderParams({ k, txnid: `ITEST3${tag}`, variantId: k.redId }));
    assert.equal((await stockRows(a, k)).red.onHand, 1);
    const cancelled = await transitionOrderStatusUsing(a, {
      txnid: `ITEST3${tag}`,
      targetStatus: 'CANCELLED',
      cancelReason: 'customer cancelled',
      policy: POLICY,
    });
    assert.equal(cancelled.stockReleased, true);
    assert.equal(cancelled.order.status, 'CANCELLED');
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    assert.equal((await movementsFor(a, order3.order.id)).length, 2);
    const duplicateCancel = await transitionOrderStatusUsing(a, {
      txnid: `ITEST3${tag}`,
      targetStatus: 'CANCELLED',
      policy: POLICY,
    });
    assert.equal(duplicateCancel.transitioned, false);
    assert.equal((await stockRows(a, k)).red.onHand, 2);

    // 7. An abandoned checkout expires: release once, then it is already released.
    const order4 = await createOrderUsing(a, orderParams({ k, txnid: `ITEST4${tag}`, variantId: k.redId }));
    assert.equal((await stockRows(a, k)).red.onHand, 1);
    await a`update orders set reservation_expires_at = now() - interval '1 second' where id = ${order4.order.id}`;
    const expired = await releaseOrderReservation(
      { txnid: `ITEST4${tag}`, state: 'EXPIRED', reason: 'checkout window closed', cancelOrder: true },
      a,
    );
    assert.equal(expired.outcome, 'released');
    assert.equal(expired.stockReleased, true);
    assert.equal(expired.order?.reservationState, 'EXPIRED');
    assert.equal(expired.order?.status, 'CANCELLED');
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    const expiredAgain = await releaseOrderReservation(
      { txnid: `ITEST4${tag}`, state: 'EXPIRED', reason: 'checkout window closed', cancelOrder: true },
      a,
    );
    assert.equal(expiredAgain.outcome, 'already-released');
    assert.equal(expiredAgain.stockReleased, false);
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    assert.equal((await movementsFor(a, order4.order.id)).length, 2);

    // 8. A payment that arrives after expiry takes back exactly what was released.
    const order5 = await createOrderUsing(a, orderParams({ k, txnid: `ITEST5${tag}`, variantId: k.redId }));
    await a`update orders set reservation_expires_at = now() - interval '1 second' where id = ${order5.order.id}`;
    await releaseOrderReservation(
      { txnid: `ITEST5${tag}`, state: 'EXPIRED', reason: 'checkout window closed', cancelOrder: true },
      a,
    );
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    const latePaid = await transitionOrderStatusUsing(a, { txnid: `ITEST5${tag}`, targetStatus: 'PAID' });
    assert.equal(latePaid.firstTimePaid, true);
    assert.equal(latePaid.stockReclaimed, true);
    assert.equal(latePaid.order.reservationState, 'CONSUMED');
    assert.equal((await stockRows(a, k)).red.onHand, 1, 'the released unit is taken back once');
    assert.deepEqual(await movementsFor(a, order5.order.id), [
      { variantId: k.redId, delta: -1, reason: 'sale' },
      { variantId: k.redId, delta: 1, reason: 'release' },
      { variantId: k.redId, delta: -1, reason: 'sale' },
    ]);
    const duplicateLate = await transitionOrderStatusUsing(a, { txnid: `ITEST5${tag}`, targetStatus: 'PAID' });
    assert.equal(duplicateLate.transitioned, false);
    assert.equal((await stockRows(a, k)).red.onHand, 1, 'a duplicate late callback does not deduct again');

    // 9. A return restocks the option sold and never more than it sold.
    const restored = await a.begin((tx) => restoreSoldStock(tx, order1.order.id, [
      { productId: k.productId, variantId: k.redId, quantity: 5 },
    ], { createdBy: k.staffId }));
    assert.deepEqual(restored, [{ productId: k.productId, variantId: k.redId, quantity: 1 }]);
    stock = await stockRows(a, k);
    assert.equal(stock.red.onHand, 2, 'order1 sold one, so a five-unit return restores one');
    assert.equal(stock.blue.onHand, 3, 'the sibling option is never restocked');
    const restoredAgain = await a.begin((tx) => restoreSoldStock(tx, order1.order.id, [
      { productId: k.productId, variantId: k.redId, quantity: 1 },
    ]));
    assert.deepEqual(restoredAgain, [], 'nothing is left to restore');
    assert.equal((await stockRows(a, k)).red.onHand, 2);
    assert.equal((await a`select count(*)::int n from stock_movements where variant_id = ${k.blueId}`)[0].n, 0);

    // 10. Every admin number matches the ledger.
    await assertLedgerMatchesStock(a, k, { red: k.redOnHand, blue: k.blueOnHand });

    const overview = await listStockOverview();
    assert.equal(overview.ok, true, 'stock overview loads');
    const redRow = overview.data.find((row) => row.variantId === k.redId);
    assert.ok(redRow, 'the red option has its own overview row');
    assert.equal(redRow.onHand, 2);
    assert.equal(redRow.productOnHand, 5, 'product total is the sum of sellable options');
    assert.equal(redRow.productAvailable, 5);

    const detail = await getStockDetail(k.productId);
    assert.equal(detail.ok, true, 'stock detail loads');
    assert.equal(detail.data.inventoryMode, 'variant');
    assert.equal(detail.data.options.length, 2);
    assert.equal(detail.data.totalOnHand, 5);
    const redOption = detail.data.options.find((option) => option.variantId === k.redId);
    assert.equal(redOption.onHand, 2);
    assert.match(redOption.variantLabel, /iPhone 16 \/ Red/);
    const labelled = detail.data.movements.filter((movement) => movement.variantId === k.redId);
    assert.ok(labelled.length > 0);
    assert.ok(labelled.every((movement) => /iPhone 16 \/ Red/.test(movement.variantLabel ?? '')));

    const low = await listLowStock(200);
    assert.equal(low.ok, true, 'low stock loads');
    assert.equal(low.data.trackedCount, 2, 'both options are tracked');
    assert.equal(low.data.lowCount, 2, 'both options are at or below their threshold');
    const redLow = low.data.rows.find((row) => row.variantId === k.redId);
    assert.ok(redLow, 'the red option is listed on its own');
    assert.equal(redLow.variantSku, k.redSku);
    assert.match(redLow.name, /iPhone 16 \/ Red/);
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } catch (error) {
      console.warn('[phase5-option-lifecycle] cleanup did not finish:', error?.message ?? error);
    }
    await a.end({ timeout: 5 });
  }
});

test('two buyers of the last unit of one option: one order; a sibling option still sells', { skip }, async () => {
  const tag = suffix();
  const schema = `itest_${tag}`;
  const k = fixtureKeys(tag);
  const a = client();
  const b = client(schema);

  try {
    await createFixtureSchema(a, schema, TABLES);
    await b.unsafe(`set search_path to "${schema}"`);
    for (const [connection, label] of [[a, 'a'], [b, 'b']]) {
      const rows = await connection`show search_path`;
      assert.ok(String(rows[0].search_path).includes(schema), `connection ${label} is not pinned`);
    }
    await seedOptions(a, k);
    await a`update stock set on_hand = 1 where id = ${k.redStockId}`;
    await a`update stock set on_hand = 1 where id = ${k.blueStockId}`;
    k.redOnHand = 1;
    k.blueOnHand = 1;

    await Promise.all([a`select 1`, b`select 1`]);
    const results = await Promise.allSettled([
      createOrderUsing(a, orderParams({ k, txnid: `ITESTA${tag}`, variantId: k.redId })),
      createOrderUsing(b, orderParams({ k, txnid: `ITESTB${tag}`, variantId: k.redId })),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one buyer gets the last unit');
    assert.equal(rejected.length, 1, 'the other buyer is refused');
    assert.equal(rejected[0].reason?.name, 'InsufficientStockError');
    assert.equal(rejected[0].reason?.code, 'insufficient_stock');

    const winner = fulfilled[0].value.order;
    const orders = await a`select id from orders where txnid in (${`ITESTA${tag}`}, ${`ITESTB${tag}`})`;
    assert.equal(orders.length, 1, 'no order row is left behind for the loser');
    assert.equal(String(orders[0].id), winner.id);
    let stock = await stockRows(a, k);
    assert.equal(stock.red.onHand, 0, 'the single unit was claimed once');
    assert.equal((await movementsFor(a, winner.id)).length, 1);

    // A different option never blocks on the first one.
    const sibling = await createOrderUsing(a, orderParams({ k, txnid: `ITESTC${tag}`, variantId: k.blueId }));
    assert.equal(sibling.stockClaimed, true);
    stock = await stockRows(a, k);
    assert.equal(stock.blue.onHand, 0);
    assert.deepEqual(await movementsFor(a, sibling.order.id), [
      { variantId: k.blueId, delta: -1, reason: 'sale' },
    ]);
    await assertLedgerMatchesStock(a, k, { red: 1, blue: 1 });
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } catch (error) {
      console.warn('[phase5-option-lifecycle] cleanup did not finish:', error?.message ?? error);
    }
    await Promise.all([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
  }
});

test('a price edit leaves the held order, its coupon use and its reservation alone', { skip }, async () => {
  const tag = suffix();
  const schema = `itest_${tag}`;
  const k = fixtureKeys(tag);
  const a = client();

  try {
    await createFixtureSchema(a, schema, TABLES);
    await seedOptions(a, k);
    await a`update stock set on_hand = 2 where id = ${k.redStockId}`;

    // The price the customer is looking at comes from the database.
    const shown = await resolveCartItemsFromDbUsing(a, [{ id: k.productId, variantId: k.redId, quantity: 1 }]);
    assert.equal(shown.items[0].unitPaise, 50000);
    const order1 = await createOrderUsing(a, orderParams({
      k,
      txnid: `ITESTP1${tag}`,
      variantId: k.redId,
      unitPrice: shown.items[0].unitPrice,
    }));
    const couponId = `itestcoup${tag}`;
    const couponCode = `ITEST${tag.slice(-10).toUpperCase()}`;
    await a`
      insert into coupons (id, code, type, value) values (${couponId}, ${couponCode}, 'PERCENT', 10)
    `;
    await a`
      insert into coupon_redemptions (coupon_id, order_id, customer_email, discount_paise, state)
      values (${couponId}, ${order1.order.id}, 'option-buyer@example.test', 5000, 'RESERVED')
    `;
    assert.equal((await stockRows(a, k)).red.onHand, 1);

    await a.begin((tx) => updateVariantPricingUsing(
      tx,
      k.productId,
      k.redId,
      { pricePaise: 90000, confirmLargeChange: true },
      k.staffId,
    ));

    // The order already placed keeps the price it was charged.
    const line = await a`
      select unit_price_paise from order_items where order_id = ${order1.order.id}
    `;
    assert.equal(Number(line[0].unit_price_paise), 50000);
    const orderRow = await a`
      select total_paise, reservation_state, discount_paise from orders where id = ${order1.order.id}
    `;
    assert.equal(Number(orderRow[0].total_paise), 50000);
    assert.equal(orderRow[0].reservation_state, 'ACTIVE', 'the held reservation is not touched');
    assert.equal(Number(orderRow[0].discount_paise), 0, 'the order total is not repriced');

    // The coupon use already counted against the order stays exactly as it was.
    const redemption = await a`
      select state, discount_paise from coupon_redemptions where order_id = ${order1.order.id}
    `;
    assert.equal(redemption[0].state, 'RESERVED');
    assert.equal(Number(redemption[0].discount_paise), 5000);

    // Stock and its ledger are untouched by a price edit.
    assert.equal((await stockRows(a, k)).red.onHand, 1);
    assert.deepEqual(await movementsFor(a, order1.order.id), [
      { variantId: k.redId, delta: -1, reason: 'sale' },
    ]);
    await assertLedgerMatchesStock(a, k, { red: 2, blue: k.blueOnHand });

    // The edit is recorded against the option itself.
    const variant = await a`
      select price_paise_override from product_variants where id = ${k.redId}
    `;
    assert.equal(Number(variant[0].price_paise_override), 90000);
    const history = await a`
      select variant_id, old_price_paise, new_price_paise, change_group, price_kind
      from price_history where variant_id = ${k.redId}
    `;
    assert.equal(history.length, 1);
    assert.equal(Number(history[0].new_price_paise), 90000);
    assert.equal(history[0].old_price_paise, null);
    assert.match(String(history[0].change_group), /^pcg_/);
    assert.equal(history[0].price_kind, 'regular');

    // The next purchase is priced from the new option price.
    const repriced = await resolveCartItemsFromDbUsing(a, [{ id: k.productId, variantId: k.redId, quantity: 1 }]);
    assert.equal(repriced.items[0].unitPaise, 90000);
    const order2 = await createOrderUsing(a, orderParams({
      k,
      txnid: `ITESTP2${tag}`,
      variantId: k.redId,
      unitPrice: repriced.items[0].unitPrice,
    }));
    const line2 = await a`
      select unit_price_paise from order_items where order_id = ${order2.order.id}
    `;
    assert.equal(Number(line2[0].unit_price_paise), 90000);
    assert.equal(Number((await a`select total_paise from orders where id = ${order2.order.id}`)[0].total_paise), 90000);
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } catch (error) {
      console.warn('[phase5-option-lifecycle] cleanup did not finish:', error?.message ?? error);
    }
    await a.end({ timeout: 5 });
  }
});

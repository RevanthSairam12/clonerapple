/**
 * Live proof that cancellation gives stock back exactly once.
 *
 * Three paths share the same ledger-guarded transaction:
 * - admin cancel of a paid order (restore through the sale ledger);
 * - admin cancel of an unpaid order (release the outstanding claim);
 * - the fulfilment screen's CANCELED transition (same two branches).
 *
 * A paid order created before Phase 2 has no `sale` movement, so it restores
 * nothing even though a stock row exists. A repeat cancel is refused and can
 * never add the units twice.
 *
 * Everything runs in a throwaway schema created with
 * `create table ... (like public.x including all)`, so the real SQL, row locks
 * and append-only ledger are exercised without writing to a production table.
 * Skipped when DATABASE_URL is unset or uses a transaction pooler (port 6543).
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
const { cancelOrderUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'returns.ts'),
);
const { transitionFulfilmentUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'orders.ts'),
);

const TABLES = [
  'categories',
  'products',
  'stock',
  'orders',
  'order_items',
  'order_addresses',
  'order_deliveries',
  'order_status_history',
  'stock_movements',
  'cancellation_reasons',
];

function orderParams({ productId, txnid, quantity = 1 }) {
  return {
    txnid,
    items: [
      {
        id: productId,
        name: `Cancel fixture ${productId}`,
        quantity,
        unitPrice: 500,
        totalPrice: 500 * quantity,
      },
    ],
    subtotalPaise: 50000 * quantity,
    shippingPaise: 0,
    totalPaise: 50000 * quantity,
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

async function markPaid(sql, txnid) {
  const rows = await sql`
    update orders set status = 'PAID', paid_at = now(), updated_at = now()
    where txnid = ${txnid}
    returning id
  `;
  assert.equal(rows.length, 1, `order ${txnid} should exist`);
  return String(rows[0].id);
}

async function movements(sql, orderId) {
  return await sql`
    select reason, delta, product_id from stock_movements
    where order_id = ${orderId}
    order by id asc
  `;
}

test('cancelling a paid order restores its claimed stock exactly once', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_cancel_${suffix}`;
  const categoryId = `itestcat${suffix}`;
  const paidProduct = `itestpaid${suffix}`;
  const paidStock = `itestpaidstk${suffix}`;
  const unpaidProduct = `itestunpaid${suffix}`;
  const unpaidStock = `itestunpaidstk${suffix}`;
  const fulfilProduct = `itestfulfil${suffix}`;
  const fulfilStock = `itestfulfilstk${suffix}`;
  const legacyProduct = `itestlegacy${suffix}`;
  const legacyStock = `itestlegacystk${suffix}`;
  const a = client();

  try {
    await createFixtureSchema(a, schema, TABLES);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    await a`
      insert into categories (id, slug, name)
      values (${categoryId}, ${categoryId}, 'Integration category')
    `;
    for (const productId of [paidProduct, unpaidProduct, fulfilProduct, legacyProduct]) {
      await a`
        insert into products (id, category_id, slug, name, price_paise)
        values (${productId}, ${categoryId}, ${productId}, ${productId}, 50000)
      `;
    }
    for (const [stockId, productId, onHand] of [
      [paidStock, paidProduct, 2],
      [unpaidStock, unpaidProduct, 2],
      [fulfilStock, fulfilProduct, 3],
    ]) {
      await a`
        insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
        values (${stockId}, ${productId}, null, ${onHand}, 0, true)
      `;
    }
    await a`
      insert into cancellation_reasons (id, label)
      values ('cancel_customer_request', 'Customer asked to cancel')
    `;

    /* ------------------------------------------------ paid admin cancel */
    const paidTxnid = `ITESTPAID${suffix}`;
    await createOrderUsing(a, orderParams({ productId: paidProduct, txnid: paidTxnid }));
    const paidOrderId = await markPaid(a, paidTxnid);

    const paidCancel = await cancelOrderUsing(a, {
      txnid: paidTxnid,
      reasonId: 'cancel_customer_request',
      note: 'paid cancellation',
      actorId: 'itest_admin',
      role: 'store_admin',
    });
    assert.equal(paidCancel.ok, true, JSON.stringify(paidCancel));
    assert.equal(paidCancel.stockRestored, true);
    assert.equal(paidCancel.stockReleased, false);

    let stockRows = await a`select on_hand from stock where id = ${paidStock}`;
    assert.equal(Number(stockRows[0].on_hand), 2, 'the paid unit is back on the shelf');
    let moves = await movements(a, paidOrderId);
    assert.deepEqual(
      moves.map((row) => [String(row.reason), Number(row.delta)]),
      [['sale', -1], ['return', 1]],
    );

    const secondCancel = await cancelOrderUsing(a, {
      txnid: paidTxnid,
      reasonId: 'cancel_customer_request',
      note: 'second attempt',
      actorId: 'itest_admin',
      role: 'store_admin',
    });
    assert.equal(secondCancel.ok, false);
    assert.equal(secondCancel.reason, 'already-cancelled');
    stockRows = await a`select on_hand from stock where id = ${paidStock}`;
    assert.equal(Number(stockRows[0].on_hand), 2, 'a repeat cancel changes nothing');
    moves = await movements(a, paidOrderId);
    assert.equal(moves.length, 2, 'no second return movement');

    /* ---------------------------------------------- unpaid admin cancel */
    const unpaidTxnid = `ITESTUNPAID${suffix}`;
    await createOrderUsing(a, orderParams({ productId: unpaidProduct, txnid: unpaidTxnid }));
    const unpaidOrderId = await markPaid(a, unpaidTxnid);
    // Put it back to an unpaid claim to exercise the release branch.
    await a`update orders set status = 'CREATED', paid_at = null where id = ${unpaidOrderId}`;

    const unpaidCancel = await cancelOrderUsing(a, {
      txnid: unpaidTxnid,
      reasonId: 'cancel_customer_request',
      note: 'unpaid cancellation',
      actorId: 'itest_admin',
      role: 'store_admin',
    });
    assert.equal(unpaidCancel.ok, true);
    assert.equal(unpaidCancel.stockReleased, true);
    assert.equal(unpaidCancel.stockRestored, false);
    stockRows = await a`select on_hand from stock where id = ${unpaidStock}`;
    assert.equal(Number(stockRows[0].on_hand), 2, 'the unpaid claim is released once');
    moves = await movements(a, unpaidOrderId);
    assert.deepEqual(
      moves.map((row) => [String(row.reason), Number(row.delta)]),
      [['sale', -1], ['release', 1]],
    );

    /* ------------------------------------------- fulfilment-screen cancel */
    const fulfilTxnid = `ITESTFULFIL${suffix}`;
    await createOrderUsing(a, orderParams({ productId: fulfilProduct, txnid: fulfilTxnid }));
    const fulfilOrderId = await markPaid(a, fulfilTxnid);

    const fulfilmentCancel = await transitionFulfilmentUsing(a, {
      txnid: fulfilTxnid,
      target: 'CANCELED',
      staffId: 'itest_admin',
      role: 'store_admin',
      reason: 'customer changed their mind',
    });
    assert.equal(fulfilmentCancel.ok, true, JSON.stringify(fulfilmentCancel));
    assert.equal(fulfilmentCancel.stockMoved, true);
    stockRows = await a`select on_hand from stock where id = ${fulfilStock}`;
    assert.equal(Number(stockRows[0].on_hand), 3, 'the fulfilment cancel restocks');
    moves = await movements(a, fulfilOrderId);
    assert.deepEqual(
      moves.map((row) => [String(row.reason), Number(row.delta)]),
      [['sale', -1], ['return', 1]],
    );

    /* -------------------------------------- pre-Phase-2 order (no ledger) */
    const legacyTxnid = `ITESTLEGACY${suffix}`;
    // No stock row exists yet, so creation makes no claim and writes no sale.
    await createOrderUsing(a, orderParams({ productId: legacyProduct, txnid: legacyTxnid }));
    const legacyOrderId = await markPaid(a, legacyTxnid);
    await a`
      insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
      values (${legacyStock}, ${legacyProduct}, null, 5, 0, true)
    `;

    const legacyCancel = await cancelOrderUsing(a, {
      txnid: legacyTxnid,
      reasonId: 'cancel_customer_request',
      note: 'legacy cancellation',
      actorId: 'itest_admin',
      role: 'store_admin',
    });
    assert.equal(legacyCancel.ok, true);
    assert.equal(legacyCancel.stockRestored, false, 'no sale movement means nothing to restore');
    stockRows = await a`select on_hand from stock where id = ${legacyStock}`;
    assert.equal(Number(stockRows[0].on_hand), 5, 'a legacy cancel never invents stock');
    moves = await movements(a, legacyOrderId);
    assert.equal(moves.length, 0, 'no movement is written for a legacy cancel');
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } catch (error) {
      console.warn('[order-cancel-stock-integration] cleanup did not finish:', error?.message ?? error);
    }
    await a.end({ timeout: 5 });
  }
});

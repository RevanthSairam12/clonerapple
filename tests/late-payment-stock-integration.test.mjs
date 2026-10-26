/**
 * Live proof that a payment which arrives after cancellation cannot sell the
 * same unit twice.
 *
 * - When the released units are still on the shelf, the late PAID transition
 *   takes them back atomically and the order continues normally.
 * - When they are gone, the order is still marked PAID (the money was taken)
 *   but flagged for manual review, with no partial claim and no extra ledger
 *   row. A duplicate callback changes nothing.
 *
 * Runs in a throwaway schema cloned from the public tables, so the real SQL,
 * row locks and ledger are exercised. Skipped when DATABASE_URL is unset or
 * points at a transaction pooler (port 6543).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
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
  alias: { '@': path.join(here, '..', 'src') },
});
const { createOrderUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'orders.ts'),
);
const {
  LATE_PAYMENT_REVIEW_REASON,
  transitionOrderStatusUsing,
} = await jiti.import(
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
  'store_settings',
];

function orderParams({ productId, txnid, quantity = 2 }) {
  return {
    txnid,
    items: [
      {
        id: productId,
        name: `Late payment fixture ${productId}`,
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

async function onHand(sql, productId) {
  const rows = await sql`select on_hand from stock where product_id = ${productId}`;
  return Number(rows[0]?.on_hand);
}

async function movements(sql, orderId) {
  return await sql`
    select reason, delta from stock_movements
    where order_id = ${orderId}
    order by id asc
  `;
}

async function createFixture(sql, suffix) {
  const categoryId = `itestlc${suffix}`;
  await sql`
    insert into categories (id, slug, name)
    values (${categoryId}, ${categoryId}, 'Integration category')
  `;
  return categoryId;
}

async function addProduct(sql, categoryId, productId, stockId, quantity) {
  await sql`
    insert into products (id, category_id, slug, name, price_paise)
    values (${productId}, ${categoryId}, ${productId}, ${productId}, 50000)
  `;
  await sql`
    insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
    values (${stockId}, ${productId}, null, ${quantity}, 0, true)
  `;
}

async function orderId(sql, txnid) {
  const rows = await sql`select id from orders where txnid = ${txnid}`;
  return String(rows[0].id);
}

async function cancelUnpaid(sql, txnid, expectReleased = true) {
  const result = await transitionOrderStatusUsing(sql, {
    txnid,
    targetStatus: 'CANCELLED',
    cancelReason: 'Abandoned checkout expired after 2 hours',
  });
  assert.equal(result.transitioned, true);
  assert.equal(result.stockReleased, expectReleased, 'cancel returns any unpaid claim');
  return result;
}

test('late payment re-claims released stock and continues normally', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_late_ok_${suffix}`;
  const productId = `itestlateok${suffix}`;
  const stockId = `itestlateokstk${suffix}`;
  const txnid = `ITESTLATEOK${suffix}`;
  const a = client();

  try {
    await a.unsafe(`create schema "${schema}"`);
    for (const table of TABLES) {
      await a.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
    }
    await a.unsafe(`set search_path to "${schema}"`);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    await createFixture(a, suffix);
    await addProduct(a, `itestlc${suffix}`, productId, stockId, 2);
    await createOrderUsing(a, orderParams({ productId, txnid }));
    assert.equal(await onHand(a, productId), 0, 'the order claimed both units');

    await cancelUnpaid(a, txnid);
    assert.equal(await onHand(a, productId), 2, 'cancel put both units back');

    const paid = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PAID',
      mihpayid: `mihpay_${suffix}`,
    });
    assert.equal(paid.transitioned, true);
    assert.equal(paid.previousStatus, 'CANCELLED');
    assert.equal(paid.firstTimePaid, true);
    assert.equal(paid.stockReclaimed, true);
    assert.equal(paid.paymentReviewRequired, false);
    assert.equal(await onHand(a, productId), 0, 'the late payment took both units back');

    const moves = await movements(a, await orderId(a, txnid));
    assert.deepEqual(
      moves.map((row) => [String(row.reason), Number(row.delta)]),
      [['sale', -2], ['release', 2], ['sale', -2]],
    );

    const flagged = await a`
      select payment_review_required, payment_review_reason from orders where txnid = ${txnid}
    `;
    assert.equal(flagged[0].payment_review_required, false);
    assert.equal(String(flagged[0].payment_review_reason), '');

    // A second callback is a no-op: the row lock sees PAID before any claim.
    const duplicate = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PAID',
      mihpayid: `mihpay_${suffix}`,
    });
    assert.equal(duplicate.transitioned, false);
    assert.equal(duplicate.firstTimePaid, false);
    assert.equal(await onHand(a, productId), 0, 'a duplicate never claims again');
    assert.equal((await movements(a, await orderId(a, txnid))).length, 3);
  } finally {
    await a.unsafe('set search_path to public');
    await a.unsafe(`drop schema if exists "${schema}" cascade`);
    await a.end();
  }
});

test('late payment with no stock flags the order, claims nothing and never retries', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_late_gone_${suffix}`;
  const productId = `itestlategone${suffix}`;
  const stockId = `itestlategonestk${suffix}`;
  const txnid = `ITESTLATEGONE${suffix}`;
  const a = client();

  try {
    await a.unsafe(`create schema "${schema}"`);
    for (const table of TABLES) {
      await a.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
    }
    await a.unsafe(`set search_path to "${schema}"`);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    await createFixture(a, suffix);
    await addProduct(a, `itestlc${suffix}`, productId, stockId, 2);
    await createOrderUsing(a, orderParams({ productId, txnid }));
    await cancelUnpaid(a, txnid);

    // Another buyer takes one unit. The order needs two, so the re-claim must
    // take none rather than half an order.
    await a`update stock set on_hand = 1 where product_id = ${productId}`;
    const beforeMovements = (await movements(a, await orderId(a, txnid))).length;

    const paid = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PAID',
      mihpayid: `mihpay_${suffix}`,
    });
    assert.equal(paid.transitioned, true);
    assert.equal(paid.firstTimePaid, true);
    assert.equal(paid.stockReclaimed, false);
    assert.equal(paid.paymentReviewRequired, true);
    assert.deepEqual(paid.fulfilmentSteps, [], 'a flagged order is not auto-confirmed');
    assert.equal(await onHand(a, productId), 1, 'no partial claim was written');
    assert.equal(
      (await movements(a, await orderId(a, txnid))).length,
      beforeMovements,
      'no new sale movement for a failed reclaim',
    );

    const flagged = await a`
      select status, fulfilment_status, payment_review_required, payment_review_reason,
             payment_reviewed_at
      from orders where txnid = ${txnid}
    `;
    assert.equal(String(flagged[0].status), 'PAID');
    assert.equal(String(flagged[0].fulfilment_status), 'PENDING');
    assert.equal(flagged[0].payment_review_required, true);
    assert.equal(String(flagged[0].payment_review_reason), LATE_PAYMENT_REVIEW_REASON);
    assert.equal(flagged[0].payment_reviewed_at, null);

    // Duplicate callback: already PAID, so no recount and no extra flag work.
    const duplicate = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PAID',
      mihpayid: `mihpay_${suffix}`,
    });
    assert.equal(duplicate.transitioned, false);
    assert.equal(duplicate.paymentReviewRequired, false);
    assert.equal(await onHand(a, productId), 1);
    assert.equal(
      (await movements(a, await orderId(a, txnid))).length,
      beforeMovements,
      'a duplicate callback never claims stock',
    );

    const stillFlagged = await a`
      select payment_review_required from orders where txnid = ${txnid}
    `;
    assert.equal(stillFlagged[0].payment_review_required, true);
  } finally {
    await a.unsafe('set search_path to public');
    await a.unsafe(`drop schema if exists "${schema}" cascade`);
    await a.end();
  }
});

test('a late payment for a legacy order with no claim is paid without a flag', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_late_legacy_${suffix}`;
  const productId = `itestlatelegacy${suffix}`;
  const txnid = `ITESTLATELEGACY${suffix}`;
  const a = client();

  try {
    await a.unsafe(`create schema "${schema}"`);
    for (const table of TABLES) {
      await a.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
    }
    await a.unsafe(`set search_path to "${schema}"`);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    await createFixture(a, suffix);
    // No stock row at all: this is the untracked/legacy shape. The order has
    // no `sale` movement, so cancellation released nothing and a late payment
    // has nothing to take back.
    await a`
      insert into products (id, category_id, slug, name, price_paise)
      values (${productId}, ${`itestlc${suffix}`}, ${productId}, ${productId}, 50000)
    `;
    await createOrderUsing(a, orderParams({ productId, txnid }));
    await cancelUnpaid(a, txnid, false);

    const paid = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PAID',
      mihpayid: `mihpay_${suffix}`,
    });
    assert.equal(paid.transitioned, true);
    assert.equal(paid.stockReclaimed, false);
    assert.equal(paid.paymentReviewRequired, false, 'nothing was released, so nothing is missing');

    const row = await a`
      select status, payment_review_required from orders where txnid = ${txnid}
    `;
    assert.equal(String(row[0].status), 'PAID');
    assert.equal(row[0].payment_review_required, false);
  } finally {
    await a.unsafe('set search_path to public');
    await a.unsafe(`drop schema if exists "${schema}" cascade`);
    await a.end();
  }
});

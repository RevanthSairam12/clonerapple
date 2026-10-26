/**
 * Live flash-sale reservation, reconciliation and waiting-list proof.
 *
 * Every test creates a throwaway schema cloned from the public tables
 * (`create table ... (like public.x including all)`), pins a dedicated
 * connection to it, and exercises the real SQL: row locks, the append-only
 * stock ledger, the guarded claim, the partial unique indexes and the durable
 * reconcile lease. Cleanup is one `drop schema`; no production row is touched.
 *
 * Skipped when DATABASE_URL is unset, or on a transaction pooler (6543) where
 * a session-level `search_path` is not stable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
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
    // No .env.local; the tests stay skipped.
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
const {
  claimDueOrders,
  createOrderUsing,
  findActiveReservationForUser,
  releaseOrderReservation,
  transitionOrderStatusUsing,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'payu', 'orders.ts'));
const { DEFAULT_RESERVATION_POLICY } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'checkout', 'reservation-rules.ts'),
);
const {
  allocateWaitlistInvitations,
  expireWaitlistInvitations,
  joinWaitingList,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'waitlist', 'store.ts'));

const TABLES = [
  'categories',
  'products',
  'users',
  'stock',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'stock_movements',
  'store_settings',
  'waiting_list_entries',
  'stock_reservations',
  'refund_obligations',
];

const POLICY = { ...DEFAULT_RESERVATION_POLICY, waitlistEnabled: true };

function suffix() {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

async function openSchema(a, schema) {
  await a.unsafe(`create schema "${schema}"`);
  for (const table of TABLES) {
    await a.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
  }
  await a.unsafe(`set search_path to "${schema}"`);
  const pinned = await a`show search_path`;
  assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');
}

async function closeSchema(a, schema) {
  await a.unsafe('set search_path to public');
  await a.unsafe(`drop schema if exists "${schema}" cascade`);
  await a.end();
}

async function addProduct(a, { categoryId, productId, stockId, quantity }) {
  await a`
    insert into categories (id, slug, name)
    values (${categoryId}, ${categoryId}, 'Integration category')
    on conflict do nothing
  `;
  await a`
    insert into products (id, category_id, slug, name, price_paise, is_active)
    values (${productId}, ${categoryId}, ${productId}, ${productId}, 50000, true)
  `;
  await a`
    insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
    values (${stockId}, ${productId}, null, ${quantity}, 0, true)
  `;
}

async function addUser(a, id) {
  await a`
    insert into users (id, email, password_hash, first_name, last_name, phone)
    values (${id}, ${`${id}@example.test`}, 'x', 'Test', ${id}, '9000000000')
  `;
}

function orderParams({ productId, txnid, userId = null, quantity = 1, reservationSeconds = 120, token = null }) {
  return {
    txnid,
    userId,
    items: [
      { id: productId, name: `Fixture ${productId}`, quantity, unitPrice: 500, totalPrice: 500 * quantity },
    ],
    subtotalPaise: 50000 * quantity,
    shippingPaise: 0,
    totalPaise: 50000 * quantity,
    currency: 'INR',
    paymentMethod: 'payu',
    reservationSeconds,
    reservationToken: token,
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

async function stockState(a, productId) {
  const rows = await a`select on_hand, reserved from stock where product_id = ${productId}`;
  return { onHand: Number(rows[0].on_hand), reserved: Number(rows[0].reserved) };
}

async function orderRow(a, txnid) {
  const rows = await a`select * from orders where txnid = ${txnid}`;
  return rows[0];
}

async function movementCount(a, orderId) {
  const rows = await a`
    select count(*)::int as count from stock_movements where order_id = ${orderId}
  `;
  return Number(rows[0].count);
}

async function insertHeldInvitation(a, { productId, userId, entryId, rawToken, minutes = 15 }) {
  await a`
    update stock set reserved = reserved + 1 where product_id = ${productId}
  `;
  await a`
    insert into stock_reservations (
      id, product_id, user_id, waiting_list_entry_id, quantity, status, token_hash, expires_at
    ) values (
      ${`srv_${randomBytes(6).toString('hex')}`}, ${productId}, ${userId}, ${entryId}, 1, 'HELD',
      ${createHash('sha256').update(rawToken).digest('hex')},
      now() + ${`${minutes} minutes`}::interval
    )
  `;
}

test('one unit: a fresh checkout claims it, expiry releases it, and stock is re-checked', { skip }, async () => {
  const s = suffix();
  const schema = `fs_one_${s}`;
  const productId = `fsone${s}`;
  const user1 = `fsuser1${s}`;
  const user2 = `fsuser2${s}`;
  const txnid = `FSONE${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user1);
    await addUser(a, user2);

    const created = await createOrderUsing(
      a,
      orderParams({ productId, txnid, userId: user1 }),
    );
    assert.equal(created.order.reservationState, 'ACTIVE');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    const active = await findActiveReservationForUser(user1, a);
    assert.equal(active?.txnid, txnid, 'the hold is discoverable by the initiate route');

    // A second customer cannot reserve the same last unit.
    await assert.rejects(
      () => createOrderUsing(a, orderParams({ productId, txnid: `FSTWO${s}`, userId: user2 })),
      (error) => error?.code === 'insufficient_stock',
    );
    const count = await a`select count(*)::int as count from orders`;
    assert.equal(Number(count[0].count), 1);

    // Expiry: the order can no longer initiate a payment.
    await a`update orders set reservation_expires_at = now() - interval '1 second' where txnid = ${txnid}`;
    assert.equal(await findActiveReservationForUser(user1, a), null);

    const released = await releaseOrderReservation(
      { txnid, state: 'EXPIRED', reason: 'reservation window closed', cancelOrder: true },
      a,
    );
    assert.equal(released.outcome, 'released');
    assert.equal(released.statusChanged, true);
    assert.equal(released.stockReleased, true);
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });
    assert.equal(String((await orderRow(a, txnid)).status), 'CANCELLED');

    const second = await releaseOrderReservation(
      { txnid, state: 'EXPIRED', reason: 'again', cancelOrder: true },
      a,
    );
    assert.equal(second.outcome, 'already-released');
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 }, 'never released twice');

    // The next customer starts a genuinely new checkout against fresh stock.
    const fresh = await createOrderUsing(
      a,
      orderParams({ productId, txnid: `FSFRESH${s}`, userId: user2 }),
    );
    assert.equal(fresh.order.reservationState, 'ACTIVE');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
  } finally {
    await closeSchema(a, schema);
  }
});

test('a definitive failure keeps the unit through the grace window, then releases once', { skip }, async () => {
  const s = suffix();
  const schema = `fs_grace_${s}`;
  const productId = `fsgrace${s}`;
  const user = `fsgraceuser${s}`;
  const txnid = `FSGRACE${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));

    const failed = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'FAILED',
      policy: { ...POLICY, failureGraceSeconds: 120 },
    });
    assert.equal(failed.transitioned, true);
    assert.equal(failed.stockReleased, false, 'a timed failure does not release immediately');

    const afterFailure = await orderRow(a, txnid);
    assert.equal(String(afterFailure.status), 'FAILED');
    assert.equal(String(afterFailure.reservation_state), 'ACTIVE');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.ok(
      new Date(afterFailure.reservation_expires_at).getTime() > Date.now() + 60_000,
      'the hold is extended by the grace window',
    );

    // The durable queue must pick up a FAILED row that still holds stock.
    await a`update orders set next_reconcile_at = now() - interval '1 second' where txnid = ${txnid}`;
    const claimed = await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a);
    assert.deepEqual(claimed.map((row) => row.txnid), [txnid]);

    // The grace window ends; the worker releases the claim but keeps FAILED.
    await a`update orders set reservation_expires_at = now() - interval '1 second' where txnid = ${txnid}`;
    const released = await releaseOrderReservation(
      { txnid, state: 'RELEASED', reason: 'payment failed; the grace window has ended' },
      a,
    );
    assert.equal(released.outcome, 'released');
    assert.equal(String((await orderRow(a, txnid)).status), 'FAILED');
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });

    // A delayed verified capture re-claims the released unit exactly once.
    const paid = await transitionOrderStatusUsing(a, { txnid, targetStatus: 'PAID', policy: POLICY });
    assert.equal(paid.transitioned, true);
    assert.equal(paid.stockReclaimed, true);
    assert.equal(paid.paymentReviewRequired, false);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(String((await orderRow(a, txnid)).reservation_state), 'CONSUMED');
  } finally {
    await closeSchema(a, schema);
  }
});

test('an ambiguous payment stays processing and is never failed early', { skip }, async () => {
  const s = suffix();
  const schema = `fs_ambiguous_${s}`;
  const productId = `fsamb${s}`;
  const user = `fsambuser${s}`;
  const txnid = `FSAMB${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));

    const processing = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PROCESSING',
      policy: { ...POLICY, unresolvedMinutes: 60 },
    });
    assert.equal(processing.transitioned, true);
    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PROCESSING');
    assert.equal(String(row.reservation_state), 'ACTIVE');
    assert.ok(row.processing_deadline, 'a safe recovery deadline is recorded');
    assert.ok(row.next_reconcile_at, 'the durable queue is scheduled');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    const deadline = new Date(row.processing_deadline).getTime();
    const repeat = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PROCESSING',
      policy: { ...POLICY, unresolvedMinutes: 60 },
    });
    assert.equal(repeat.transitioned, false, 'a repeated status callback is a no-op');
    assert.equal(
      new Date((await orderRow(a, txnid)).processing_deadline).getTime(),
      deadline,
      'a repeated callback cannot extend the deadline',
    );

    // The safe window closes: the claim is returned, the order still processes.
    // (The reservation expiry and the processing deadline are the same instant.)
    await a`update orders
      set processing_deadline = now() - interval '1 second',
          reservation_expires_at = now() - interval '1 second'
      where txnid = ${txnid}`;
    const released = await releaseOrderReservation(
      { txnid, state: 'EXPIRED', reason: 'unresolved payment window closed' },
      a,
    );
    assert.equal(released.outcome, 'released');
    const afterRelease = await orderRow(a, txnid);
    assert.equal(String(afterRelease.status), 'PROCESSING');
    assert.equal(String(afterRelease.reservation_state), 'EXPIRED');
    assert.equal(afterRelease.processing_deadline, null);
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });

    // A delayed confirmation still records the capture and re-takes the unit.
    const paid = await transitionOrderStatusUsing(a, { txnid, targetStatus: 'PAID', policy: POLICY });
    assert.equal(paid.transitioned, true);
    assert.equal(paid.stockReclaimed, true);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
  } finally {
    await closeSchema(a, schema);
  }
});

test('duplicate paid callbacks change stock exactly once', { skip }, async () => {
  const s = suffix();
  const schema = `fs_dup_paid_${s}`;
  const productId = `fsdup${s}`;
  const user = `fsdupuser${s}`;
  const txnid = `FSDUP${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const created = await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));
    const orderId = created.order.id;

    const first = await transitionOrderStatusUsing(a, { txnid, targetStatus: 'PAID', policy: POLICY });
    assert.equal(first.transitioned, true);
    assert.equal(String((await orderRow(a, txnid)).reservation_state), 'CONSUMED');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(await movementCount(a, orderId), 1);

    const duplicate = await transitionOrderStatusUsing(a, { txnid, targetStatus: 'PAID', policy: POLICY });
    assert.equal(duplicate.transitioned, false);
    assert.equal(duplicate.stockReleased, false);
    assert.equal(duplicate.stockReclaimed, false);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(await movementCount(a, orderId), 1, 'no second ledger row');
  } finally {
    await closeSchema(a, schema);
  }
});

test('a verified payment racing expiry leaves one consistent paid order', { skip }, async () => {
  const s = suffix();
  const schema = `fs_race_${s}`;
  const productId = `fsrace${s}`;
  const user = `fsraceuser${s}`;
  const txnid = `FSRACE${s}`;
  const a = client();
  const b = client();

  try {
    await openSchema(a, schema);
    await b.unsafe(`set search_path to "${schema}"`);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const created = await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));
    await a`update orders set reservation_expires_at = now() - interval '1 second' where txnid = ${txnid}`;

    const [released, paid] = await Promise.allSettled([
      releaseOrderReservation(
        { txnid, state: 'EXPIRED', reason: 'reservation window closed', cancelOrder: true },
        a,
      ),
      transitionOrderStatusUsing(b, { txnid, targetStatus: 'PAID', policy: POLICY }),
    ]);

    assert.equal(released.status, 'fulfilled');
    assert.equal(paid.status, 'fulfilled');
    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PAID', 'a verified capture always wins');
    assert.equal(String(row.reservation_state), 'CONSUMED');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 }, 'never oversold');
    assert.ok(['released', 'paid', 'already-released'].includes(released.value.outcome));

    // The loser is a no-op afterwards.
    const again = await releaseOrderReservation(
      { txnid, state: 'EXPIRED', reason: 'after the race', cancelOrder: true },
      a,
    );
    assert.notEqual(again.outcome, 'released');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.ok(await movementCount(a, created.order.id) <= 3);
  } finally {
    await b.end();
    await closeSchema(a, schema);
  }
});

test('the reconcile queue is a durable lease, not an in-memory timer', { skip }, async () => {
  const s = suffix();
  const schema = `fs_lease_${s}`;
  const productId = `fslease${s}`;
  const user = `fsleaseuser${s}`;
  const txnid = `FSLEASE${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    await createOrderUsing(a, orderParams({ productId, txnid, userId: user, reservationSeconds: 1 }));
    await a`update orders set next_reconcile_at = now() - interval '1 second' where txnid = ${txnid}`;

    const claimed = await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a);
    assert.deepEqual(claimed.map((row) => row.txnid), [txnid]);
    const afterClaim = await orderRow(a, txnid);
    assert.equal(Number(afterClaim.reconcile_attempts), 1);
    assert.ok(new Date(afterClaim.next_reconcile_at).getTime() > Date.now(), 'the lease is in the future');

    const immediately = await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a);
    assert.deepEqual(immediately, [], 'a second worker cannot take the same row');

    // Simulate a crash: no in-memory state survived, only the row. Once the
    // lease is due again the work is picked up by a fresh worker.
    await a`update orders set next_reconcile_at = now() - interval '1 second' where txnid = ${txnid}`;
    const restarted = await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a);
    assert.deepEqual(restarted.map((row) => row.txnid), [txnid]);
    assert.equal(Number((await orderRow(a, txnid)).reconcile_attempts), 2);
  } finally {
    await closeSchema(a, schema);
  }
});

test('waiting list: duplicate joins prevented, one invitation per unit, FIFO, expiry returns stock', { skip }, async () => {
  const s = suffix();
  const schema = `fs_wl_${s}`;
  const productId = `fswl${s}`;
  const u1 = `fswl1${s}`;
  const u2 = `fswl2${s}`;
  const u3 = `fswl3${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    // Sold out when the customers join; a unit arrives before allocation.
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 0 });
    await addUser(a, u1);
    await addUser(a, u2);
    await addUser(a, u3);

    const first = await joinWaitingList({ userId: u1, productId, sql: a, policy: POLICY, sendNotifications: false });
    assert.equal(first.ok, true);
    assert.equal(first.alreadyOnList, false);
    const duplicate = await joinWaitingList({ userId: u1, productId, sql: a, policy: POLICY, sendNotifications: false });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.alreadyOnList, true);
    const entryCount = await a`select count(*)::int as count from waiting_list_entries`;
    assert.equal(Number(entryCount[0].count), 1, 'a double click cannot create a second place');
    await joinWaitingList({ userId: u2, productId, sql: a, policy: POLICY, sendNotifications: false });
    await joinWaitingList({ userId: u3, productId, sql: a, policy: POLICY, sendNotifications: false });

    await a`update stock set on_hand = 1 where product_id = ${productId}`;
    const allocated = await allocateWaitlistInvitations({
      policy: POLICY,
      now: new Date(),
      sql: a,
      sendNotifications: false,
    });
    assert.equal(allocated.invited, 1);
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 1 });
    const invited = await a`
      select user_id, status from waiting_list_entries where status = 'INVITED'
    `;
    assert.equal(invited.length, 1);
    assert.equal(String(invited[0].user_id), u1, 'the oldest entry is offered the unit');

    const secondTick = await allocateWaitlistInvitations({
      policy: POLICY,
      now: new Date(),
      sql: a,
      sendNotifications: false,
    });
    assert.equal(secondTick.invited, 0, 'one live invitation per product');
    assert.equal(
      Number((await a`select count(*)::int as count from stock_reservations where status = 'HELD'`)[0].count),
      1,
    );

    await a`update stock_reservations set expires_at = now() - interval '1 second' where status = 'HELD'`;
    const expired = await expireWaitlistInvitations({
      policy: POLICY,
      now: new Date(),
      sql: a,
      sendNotifications: false,
    });
    assert.equal(expired, 1);
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 }, 'the held unit returns');
    const entry = await a`select status from waiting_list_entries where user_id = ${u1}`;
    assert.equal(String(entry[0].status), 'EXPIRED');

    const nextTick = await allocateWaitlistInvitations({
      policy: POLICY,
      now: new Date(),
      sql: a,
      sendNotifications: false,
    });
    assert.equal(nextTick.invited, 1, 'the next entry is offered the returned unit');
    const nextInvited = await a`
      select user_id from waiting_list_entries where status = 'INVITED'
    `;
    assert.equal(String(nextInvited[0].user_id), u2);
  } finally {
    await closeSchema(a, schema);
  }
});

test('a live invitation is consumed once and a stale one cannot buy a sold-out unit', { skip }, async () => {
  const s = suffix();
  const schema = `fs_token_${s}`;
  const productId = `fstok${s}`;
  const user = `fstokuser${s}`;
  const other = `fstokother${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    await addUser(a, other);

    const entryId = `wl_${randomBytes(8).toString('hex')}`;
    await a`
      insert into waiting_list_entries (id, product_id, user_id, status, invited_at)
      values (${entryId}, ${productId}, ${user}, 'INVITED', now())
    `;
    const rawToken = randomBytes(32).toString('hex');
    await insertHeldInvitation(a, { productId, userId: user, entryId, rawToken });
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 1 });

    const created = await createOrderUsing(
      a,
      orderParams({ productId, txnid: `FSTOK${s}`, userId: user, token: rawToken }),
    );
    assert.equal(created.stockClaimed, true);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    const hold = await a`select status, claimed_order_id from stock_reservations`;
    assert.equal(String(hold[0].status), 'CLAIMED');
    assert.equal(String(hold[0].claimed_order_id), created.order.id);
    const entry = await a`select status from waiting_list_entries where id = ${entryId}`;
    assert.equal(String(entry[0].status), 'PURCHASED');

    // Replaying the same claim link starts no second order.
    await assert.rejects(
      () => createOrderUsing(a, orderParams({ productId, txnid: `FSTOK2${s}`, userId: user, token: rawToken })),
      (error) => error?.code === 'reservation_unavailable',
    );

    // A stale hold is released; the same token then buys nothing.
    const staleRaw = randomBytes(32).toString('hex');
    const staleEntry = `wl_${randomBytes(8).toString('hex')}`;
    await a`
      insert into waiting_list_entries (id, product_id, user_id, status, invited_at)
      values (${staleEntry}, ${productId}, ${other}, 'INVITED', now())
    `;
    await a`update stock set on_hand = 1 where product_id = ${productId}`;
    await insertHeldInvitation(a, { productId, userId: other, entryId: staleEntry, rawToken: staleRaw });
    await a`update stock_reservations set expires_at = now() - interval '1 second' where status = 'HELD'`;
    await expireWaitlistInvitations({ policy: POLICY, now: new Date(), sql: a, sendNotifications: false });
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });

    // Another customer takes the unit first.
    await createOrderUsing(a, orderParams({ productId, txnid: `FSTOK3${s}`, userId: user }));
    await assert.rejects(
      () => createOrderUsing(a, orderParams({ productId, txnid: `FSTOK4${s}`, userId: other, token: staleRaw })),
      (error) => error?.code === 'reservation_unavailable',
    );
    const ordersForOther = await a`select count(*)::int as count from orders where user_id = ${other}`;
    assert.equal(Number(ordersForOther[0].count), 0);
  } finally {
    await closeSchema(a, schema);
  }
});

test('high concurrency: many buyers, one unit, exactly one order', { skip }, async () => {
  const s = suffix();
  const schema = `fs_burst_${s}`;
  const productId = `fsburst${s}`;
  const a = client();
  const buyers = [];

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });

    for (let index = 0; index < 5; index += 1) {
      const connection = client();
      await connection.unsafe(`set search_path to "${schema}"`);
      buyers.push(connection);
    }

    const results = await Promise.allSettled(
      buyers.map((connection, index) =>
        createOrderUsing(
          connection,
          orderParams({ productId, txnid: `FSBURST${s}${index}`, reservationSeconds: 120 }),
        ),
      ),
    );
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one buyer wins the last unit');
    assert.equal(rejected.length, 4);
    for (const failure of rejected) {
      assert.ok(
        failure.reason?.code === 'insufficient_stock',
        'losers get the existing 409 stock path',
      );
    }
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    const count = await a`select count(*)::int as count from orders`;
    assert.equal(Number(count[0].count), 1);
  } finally {
    for (const connection of buyers) await connection.end();
    await closeSchema(a, schema);
  }
});

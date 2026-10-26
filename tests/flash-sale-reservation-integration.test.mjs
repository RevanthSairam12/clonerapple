/**
 * Live flash-sale reservation and reconciliation proof.
 *
 * Every test opens a throwaway schema cloned from the public tables and
 * exercises the real SQL. See tests/helpers/flash-sale-schema.mjs for the
 * fixtures and the skip conditions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY,
  addProduct,
  addUser,
  client,
  closeSchema,
  loadModule,
  movementCount,
  openSchema,
  orderParams,
  orderRow,
  skip,
  stockState,
  suffix,
} from './helpers/flash-sale-schema.mjs';

const {
  claimDueOrders,
  createOrderUsing,
  findActiveReservationForUser,
  releaseOrderReservation,
  transitionOrderStatusUsing,
} = await loadModule('src/lib/payu/orders.ts');
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

test('removed waiting list: held units are returned once and the release is idempotent', { skip }, async () => {
  const s = suffix();
  const schema = `fs_wlclean_${s}`;
  const productId = `fswlc${s}`;
  const user = `fswlcu${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);

    // A leftover invitation from the removed feature: one unit held and one
    // entry still INVITED. Nothing in the app expires or allocates it any more.
    const entryId = `wl_${s}`;
    await a`
      insert into waiting_list_entries (id, product_id, user_id, status, invited_at)
      values (${entryId}, ${productId}, ${user}, 'INVITED', now())
    `;
    await a`update stock set reserved = reserved + 1 where product_id = ${productId}`;
    await a`
      insert into stock_reservations (
        id, product_id, user_id, waiting_list_entry_id, quantity, status, token_hash, expires_at
      ) values (
        ${`srv_${s}`}, ${productId}, ${user}, ${entryId}, 1, 'HELD',
        ${'a'.repeat(64)}, now() + interval '15 minutes'
      )
    `;
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 1 });

    const { releaseWaitingListHoldsUsing } = await loadModule('src/lib/payu/waitlist-cleanup.ts');
    const first = await releaseWaitingListHoldsUsing(a);
    assert.deepEqual(first, { holdsReleased: 1, unitsReleased: 1, products: [productId] });
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });
    const hold = await a`select status from stock_reservations where id = ${`srv_${s}`}`;
    assert.equal(String(hold[0].status), 'CANCELLED');
    const entry = await a`select status from waiting_list_entries where id = ${entryId}`;
    assert.equal(String(entry[0].status), 'CANCELLED');

    const second = await releaseWaitingListHoldsUsing(a);
    assert.deepEqual(second, { holdsReleased: 0, unitsReleased: 0, products: [] });
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 }, 'never released twice');

    // The freed unit is buyable again through the normal checkout.
    const created = await createOrderUsing(a, orderParams({ productId, txnid: `FSWLC${s}`, userId: user }));
    assert.equal(created.stockClaimed, true);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
  } finally {
    await closeSchema(a, schema);
  }
});

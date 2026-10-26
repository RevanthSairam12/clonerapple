/**
 * Live proof of the two paths that keep a flash sale correct without the cron:
 * the checkout's lazy expiry and the reconciler's decision tree.
 *
 * Each test opens a throwaway schema cloned from the public tables (see
 * tests/helpers/flash-sale-schema.mjs) and drives the real SQL. The verifier is
 * injected, so no network call is made; notifications, audit rows and cache
 * invalidation are switched off because they address the application pool, not
 * the schema under test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY,
  VERIFY,
  addProduct,
  addUser,
  client,
  closeSchema,
  loadModule,
  movementCount,
  openSchema,
  orderParams,
  orderRow,
  reconcileContext,
  reconcileSummary,
  skip,
  stockState,
  suffix,
} from './helpers/flash-sale-schema.mjs';

const {
  claimDueOrders,
  createOrderUsing,
  transitionOrderStatusUsing,
} = await loadModule('src/lib/payu/orders.ts');
const { reconcileOrderUsing } = await loadModule('src/lib/payu/reconcile.ts');

async function claimOne(a, txnid) {
  await a`update orders set next_reconcile_at = now() - interval '1 second' where txnid = ${txnid}`;
  const claimed = await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a);
  const order = claimed.find((row) => row.txnid === txnid);
  assert.ok(order, `the worker claims ${txnid}`);
  return order;
}

/* ------------------------------------------------ lazy expiry at checkout */

test('lazy expiry: a checkout frees a sold-out unit when the cron is down', { skip }, async () => {
  const s = suffix();
  const schema = `fs_lazy_${s}`;
  const productId = `fslazy${s}`;
  const user1 = `fslazy1${s}`;
  const user2 = `fslazy2${s}`;
  const staleTxn = `FSLAZYOLD${s}`;
  const freshTxn = `FSLAZYNEW${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user1);
    await addUser(a, user2);

    const stale = await createOrderUsing(a, orderParams({ productId, txnid: staleTxn, userId: user1 }));
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    // The worker never ran; only the deadline passed, on the database clock.
    await a`
      update orders
      set reservation_expires_at = now() - interval '1 second',
          next_reconcile_at = now() - interval '1 second'
      where txnid = ${staleTxn}
    `;

    // The product is sold out, so the claim is re-planned only after the
    // checkout itself returns the expired hold. The cron is not involved.
    const fresh = await createOrderUsing(a, orderParams({ productId, txnid: freshTxn, userId: user2 }));
    assert.equal(fresh.stockClaimed, true);
    assert.equal(fresh.expiredReservations.length, 1);
    assert.deepEqual(
      {
        txnid: fresh.expiredReservations[0].txnid,
        state: fresh.expiredReservations[0].state,
        status: fresh.expiredReservations[0].status,
        stockReleased: fresh.expiredReservations[0].stockReleased,
      },
      { txnid: staleTxn, state: 'EXPIRED', status: 'CANCELLED', stockReleased: true },
    );

    const staleRow = await orderRow(a, staleTxn);
    assert.equal(String(staleRow.status), 'CANCELLED', 'an unpaid checkout is cancelled, as the worker would');
    assert.equal(String(staleRow.reservation_state), 'EXPIRED');
    assert.ok(staleRow.cancelled_at);
    assert.equal(await movementCount(a, stale.order.id), 2, 'sale + release, never released twice');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(await movementCount(a, fresh.order.id), 1);
  } finally {
    await closeSchema(a, schema);
  }
});

test('lazy expiry: a hold that has not expired is never taken by another checkout', { skip }, async () => {
  const s = suffix();
  const schema = `fs_lazy_live_${s}`;
  const productId = `fslazylive${s}`;
  const user1 = `fslazylive1${s}`;
  const user2 = `fslazylive2${s}`;
  const txnid = `FSLAZYLIVE${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user1);
    await addUser(a, user2);
    await createOrderUsing(a, orderParams({ productId, txnid, userId: user1 }));

    await assert.rejects(
      () => createOrderUsing(a, orderParams({ productId, txnid: `FSLAZYBLOCK${s}`, userId: user2 })),
      (error) => error?.code === 'insufficient_stock',
    );

    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'CREATED', 'a live hold is untouched');
    assert.equal(String(row.reservation_state), 'ACTIVE');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(Number((await a`select count(*)::int as count from orders`)[0].count), 1);
  } finally {
    await closeSchema(a, schema);
  }
});

test('lazy expiry: the failure grace is released but the order stays FAILED', { skip }, async () => {
  const s = suffix();
  const schema = `fs_lazy_grace_${s}`;
  const productId = `fslazygrace${s}`;
  const user1 = `fslazygrace1${s}`;
  const user2 = `fslazygrace2${s}`;
  const txnid = `FSLAZYGRACE${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user1);
    await addUser(a, user2);
    await createOrderUsing(a, orderParams({ productId, txnid, userId: user1 }));

    const failed = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'FAILED',
      policy: { ...POLICY, failureGraceSeconds: 120 },
    });
    assert.equal(failed.transitioned, true);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    await a`
      update orders
      set reservation_expires_at = now() - interval '1 second',
          next_reconcile_at = now() - interval '1 second'
      where txnid = ${txnid}
    `;

    const fresh = await createOrderUsing(a, orderParams({ productId, txnid: `FSLAZYGRACENEW${s}`, userId: user2 }));
    assert.equal(fresh.expiredReservations.length, 1);
    assert.equal(fresh.expiredReservations[0].state, 'RELEASED');
    assert.equal(fresh.expiredReservations[0].status, 'FAILED', 'the definitive failure is kept');

    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'FAILED');
    assert.equal(String(row.reservation_state), 'RELEASED');
    assert.equal(row.processing_deadline, null);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
  } finally {
    await closeSchema(a, schema);
  }
});

test('lazy expiry: an unresolved payment keeps PROCESSING and is queued for the worker', { skip }, async () => {
  const s = suffix();
  const schema = `fs_lazy_proc_${s}`;
  const productId = `fslazyproc${s}`;
  const user1 = `fslazyproc1${s}`;
  const user2 = `fslazyproc2${s}`;
  const txnid = `FSLAZYPROC${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user1);
    await addUser(a, user2);
    await createOrderUsing(a, orderParams({ productId, txnid, userId: user1 }));

    const processing = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PROCESSING',
      policy: { ...POLICY, unresolvedMinutes: 60 },
    });
    assert.equal(processing.transitioned, true);

    await a`
      update orders
      set reservation_expires_at = now() - interval '1 second',
          processing_deadline = now() - interval '1 second'
      where txnid = ${txnid}
    `;

    const fresh = await createOrderUsing(a, orderParams({ productId, txnid: `FSLAZYPROCNEW${s}`, userId: user2 }));
    assert.equal(fresh.expiredReservations.length, 1);
    assert.equal(fresh.expiredReservations[0].state, 'EXPIRED');
    assert.equal(fresh.expiredReservations[0].status, 'PROCESSING');

    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PROCESSING', 'never failed by a checkout');
    assert.equal(String(row.reservation_state), 'EXPIRED');
    assert.ok(row.processing_deadline, 'the closed window is kept so the worker can flag it');
    assert.ok(row.next_reconcile_at, 'the worker is asked to check it immediately');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
  } finally {
    await closeSchema(a, schema);
  }
});

test('lazy expiry: two buyers racing a stale hold produce exactly one order', { skip }, async () => {
  const s = suffix();
  const schema = `fs_lazy_race_${s}`;
  const productId = `fslazyrace${s}`;
  const staleUser = `fslazyrace0${s}`;
  const user2 = `fslazyrace1${s}`;
  const user3 = `fslazyrace2${s}`;
  const staleTxn = `FSLAZYRACEOLD${s}`;
  const a = client();
  const b = client();

  try {
    await openSchema(a, schema);
    await b.unsafe(`set search_path to "${schema}"`);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, staleUser);
    await addUser(a, user2);
    await addUser(a, user3);
    const stale = await createOrderUsing(a, orderParams({ productId, txnid: staleTxn, userId: staleUser }));
    await a`
      update orders
      set reservation_expires_at = now() - interval '1 second',
          next_reconcile_at = now() - interval '1 second'
      where txnid = ${staleTxn}
    `;

    const results = await Promise.allSettled([
      createOrderUsing(a, orderParams({ productId, txnid: `FSLAZYRACENEWA${s}`, userId: user2 })),
      createOrderUsing(b, orderParams({ productId, txnid: `FSLAZYRACENEWB${s}`, userId: user3 })),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'one unit, one buyer');
    const rejection = results.find((result) => result.status === 'rejected');
    assert.equal(rejection.reason?.code, 'insufficient_stock');

    const row = await orderRow(a, staleTxn);
    assert.equal(String(row.status), 'CANCELLED');
    assert.equal(String(row.reservation_state), 'EXPIRED');
    assert.equal(await movementCount(a, stale.order.id), 2, 'the stale claim is released once');
    assert.equal(Number((await a`select count(*)::int as count from orders`)[0].count), 2);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
  } finally {
    await b.end();
    await closeSchema(a, schema);
  }
});

/* -------------------------------------------------- reconcile decision tree */

test('reconcile: a verified capture becomes PAID and consumes the claim', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_paid_${s}`;
  const productId = `fsrecpaid${s}`;
  const user = `fsrecpaiduser${s}`;
  const txnid = `FSRECPAID${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const created = await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));

    const order = await claimOne(a, txnid);
    const summary = reconcileSummary();
    await reconcileOrderUsing(a, order, reconcileContext(VERIFY.paid, summary));

    assert.equal(summary.markedPaid, 1);
    assert.equal(summary.unchanged, 0);
    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PAID');
    assert.equal(String(row.reservation_state), 'CONSUMED');
    assert.equal(row.next_reconcile_at, null);
    assert.equal(Number(row.consecutive_reconcile_failures), 0);
    assert.equal(row.payment_review_required, false);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(await movementCount(a, created.order.id), 1);
    const obligations = await a`select count(*)::int as count from refund_obligations`;
    assert.equal(Number(obligations[0].count), 0);
  } finally {
    await closeSchema(a, schema);
  }
});

test('reconcile: a verified failure waits out the grace window, then releases once', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_failed_${s}`;
  const productId = `fsrecfailed${s}`;
  const user = `fsrecfaileduser${s}`;
  const txnid = `FSRECFAILED${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const created = await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));

    const order = await claimOne(a, txnid);
    const failedSummary = reconcileSummary();
    await reconcileOrderUsing(a, order, reconcileContext(VERIFY.failed, failedSummary));

    assert.equal(failedSummary.markedFailed, 1);
    const afterFailure = await orderRow(a, txnid);
    assert.equal(String(afterFailure.status), 'FAILED');
    assert.equal(String(afterFailure.reservation_state), 'ACTIVE', 'the grace hold is kept');
    assert.ok(
      new Date(afterFailure.reservation_expires_at).getTime() > Date.now() + 60_000,
      'the hold runs to the end of the grace window',
    );
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    // The grace window ends; the next claimed run releases the claim exactly
    // once and leaves the order FAILED.
    await a`
      update orders
      set reservation_expires_at = now() - interval '1 second',
          next_reconcile_at = now() - interval '1 second'
      where txnid = ${txnid}
    `;
    const due = await claimOne(a, txnid);
    const releaseSummary = reconcileSummary();
    await reconcileOrderUsing(a, due, reconcileContext(VERIFY.failed, releaseSummary));
    assert.equal(releaseSummary.released, 1);

    const afterGrace = await orderRow(a, txnid);
    assert.equal(String(afterGrace.status), 'FAILED');
    assert.equal(String(afterGrace.reservation_state), 'RELEASED');
    assert.equal(afterGrace.processing_deadline, null);
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });
    assert.equal(await movementCount(a, created.order.id), 2, 'sale + release');

    // Nothing is left in the queue.
    const stillDue = await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a);
    assert.deepEqual(stillDue, []);
  } finally {
    await closeSchema(a, schema);
  }
});

async function expireUnresolvedOnWorker(a, { productId, txnid, userId }) {
  await createOrderUsing(a, orderParams({ productId, txnid, userId }));

  const first = await claimOne(a, txnid);
  const processingSummary = reconcileSummary();
  await reconcileOrderUsing(a, first, reconcileContext(VERIFY.unavailable, processingSummary));
  assert.equal(processingSummary.markedProcessing, 1);

  await a`
    update orders
    set processing_deadline = now() - interval '1 second',
        reservation_expires_at = now() - interval '1 second',
        next_reconcile_at = now() - interval '1 second'
    where txnid = ${txnid}
  `;
  const due = await claimOne(a, txnid);
  const releaseSummary = reconcileSummary();
  await reconcileOrderUsing(a, due, reconcileContext(VERIFY.unavailable, releaseSummary));
  assert.equal(releaseSummary.released, 1);
  assert.equal(releaseSummary.flagged, 1);

  return { order: due, releaseSummary };
}

test('reconcile: an unresolved payment becomes PROCESSING, then releases and is flagged', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_proc_${s}`;
  const productId = `fsrecproc${s}`;
  const user = `fsrecprocuser${s}`;
  const txnid = `FSRECPROC${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);

    await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));
    const first = await claimOne(a, txnid);
    const processingSummary = reconcileSummary();
    await reconcileOrderUsing(a, first, reconcileContext(VERIFY.unavailable, processingSummary));

    assert.equal(processingSummary.markedProcessing, 1);
    const processing = await orderRow(a, txnid);
    assert.equal(String(processing.status), 'PROCESSING');
    assert.equal(String(processing.reservation_state), 'ACTIVE', 'an unverified payment keeps its claim');
    assert.ok(processing.processing_deadline);
    assert.ok(processing.next_reconcile_at, 'the retry is scheduled with backoff');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    // The safe window closes with the answer still unknown.
    await a`
      update orders
      set processing_deadline = now() - interval '1 second',
          reservation_expires_at = now() - interval '1 second',
          next_reconcile_at = now() - interval '1 second'
      where txnid = ${txnid}
    `;
    const due = await claimOne(a, txnid);
    const summary = reconcileSummary();
    await reconcileOrderUsing(a, due, reconcileContext(VERIFY.unavailable, summary));

    assert.equal(summary.released, 1);
    assert.equal(summary.flagged, 1);
    const flagged = await orderRow(a, txnid);
    assert.equal(String(flagged.status), 'PROCESSING', 'never failed while a human must check it');
    assert.equal(String(flagged.reservation_state), 'EXPIRED');
    assert.equal(flagged.payment_review_required, true);
    assert.ok(flagged.payment_review_reason);
    assert.ok(flagged.reconciliation_flagged_at);
    assert.ok(
      new Date(flagged.next_reconcile_at).getTime() > Date.now(),
      'a late capture is still checked for',
    );
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });
  } finally {
    await closeSchema(a, schema);
  }
});

test('reconcile: a late capture re-claims released stock', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_late_${s}`;
  const productId = `fsreclate${s}`;
  const user = `fsreclateuser${s}`;
  const txnid = `FSRECLATE${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const { order } = await expireUnresolvedOnWorker(a, { productId, txnid, userId: user });
    assert.deepEqual(await stockState(a, productId), { onHand: 1, reserved: 0 });

    const paidOrder = await claimOne(a, txnid);
    const summary = reconcileSummary();
    await reconcileOrderUsing(a, paidOrder, reconcileContext(VERIFY.paid, summary));

    assert.equal(summary.markedPaid, 1);
    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PAID');
    assert.equal(String(row.reservation_state), 'CONSUMED', 'the released unit is taken back');
    // Closing the safe window flagged the order for a human. A later automatic
    // recovery never clears that flag: Payments keeps it until staff
    // acknowledge it, so the audit trail of the interrupted payment survives.
    assert.equal(row.payment_review_required, true);
    assert.match(String(row.payment_review_reason), /could not be verified/i);
    assert.equal(row.next_reconcile_at, null);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 }, 'never oversold');
    assert.equal(
      Number((await a`select count(*)::int as count from refund_obligations`)[0].count),
      0,
      'no refund is owed when the unit came back',
    );
    assert.ok(await movementCount(a, order.id) >= 3, 'sale, release, reclaim');
  } finally {
    await closeSchema(a, schema);
  }
});

test('reconcile: a late capture without stock creates a refund obligation', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_nostock_${s}`;
  const productId = `fsrecnostock${s}`;
  const user = `fsrecnostock1${s}`;
  const other = `fsrecnostock2${s}`;
  const txnid = `FSRECNOSTOCK${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    await addUser(a, other);
    const { order } = await expireUnresolvedOnWorker(a, { productId, txnid, userId: user });

    // The released unit is bought by someone else before the capture arrives.
    const competitor = await createOrderUsing(a, orderParams({ productId, txnid: `FSRECOTHER${s}`, userId: other }));
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });

    const paidOrder = await claimOne(a, txnid);
    const summary = reconcileSummary();
    await reconcileOrderUsing(a, paidOrder, reconcileContext(VERIFY.paid, summary));

    assert.equal(summary.markedPaid, 1);
    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PAID', 'the money was taken, record it');
    assert.notEqual(String(row.reservation_state), 'CONSUMED', 'nothing was re-claimed');
    assert.equal(row.payment_review_required, true);
    assert.ok(String(row.payment_review_reason).length > 0);

    const obligations = await a`
      select order_id, amount_paise, status from refund_obligations
    `;
    assert.equal(obligations.length, 1);
    assert.equal(String(obligations[0].order_id), String(order.id));
    assert.equal(Number(obligations[0].amount_paise), 50000);
    assert.equal(String(obligations[0].status), 'PENDING');
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 }, 'never oversold');
    assert.equal(await movementCount(a, competitor.order.id), 1);
  } finally {
    await closeSchema(a, schema);
  }
});

test('reconcile: duplicate runs change nothing', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_dup_${s}`;
  const productId = `fsrecdup${s}`;
  const user = `fsrecdupuser${s}`;
  const txnid = `FSRECDUP${s}`;
  const a = client();

  try {
    await openSchema(a, schema);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const created = await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));

    const order = await claimOne(a, txnid);
    const first = reconcileSummary();
    await reconcileOrderUsing(a, order, reconcileContext(VERIFY.paid, first));
    assert.equal(first.markedPaid, 1);

    // The same claimed snapshot is processed again (a retried tick).
    const second = reconcileSummary();
    await reconcileOrderUsing(a, order, reconcileContext(VERIFY.paid, second));
    assert.equal(second.markedPaid, 0);
    assert.equal(second.unchanged, 1);
    assert.equal(await movementCount(a, created.order.id), 1, 'no second ledger row');

    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PAID');
    assert.equal(String(row.reservation_state), 'CONSUMED');
    assert.equal(row.next_reconcile_at, null);
    assert.equal(Number((await a`select count(*)::int as count from refund_obligations`)[0].count), 0);
    assert.deepEqual(await claimDueOrders({ limit: 10, leaseSeconds: 180 }, a), [], 'the queue is empty');
  } finally {
    await closeSchema(a, schema);
  }
});

test('reconcile: two workers at once process the order exactly once', { skip }, async () => {
  const s = suffix();
  const schema = `fs_rec_workers_${s}`;
  const productId = `fsrecworkers${s}`;
  const user = `fsrecworkersuser${s}`;
  const txnid = `FSRECWORKERS${s}`;
  const a = client();
  const b = client();

  try {
    await openSchema(a, schema);
    await b.unsafe(`set search_path to "${schema}"`);
    await addProduct(a, { categoryId: `fscat${s}`, productId, stockId: `fsstk${s}`, quantity: 1 });
    await addUser(a, user);
    const created = await createOrderUsing(a, orderParams({ productId, txnid, userId: user }));
    await a`update orders set next_reconcile_at = now() - interval '1 second' where txnid = ${txnid}`;

    // Two workers poll the durable queue at the same moment.
    const [claimedByA, claimedByB] = await Promise.all([
      claimDueOrders({ limit: 10, leaseSeconds: 180 }, a),
      claimDueOrders({ limit: 10, leaseSeconds: 180 }, b),
    ]);
    const claimed = [...claimedByA, ...claimedByB];
    assert.equal(claimed.length, 1, 'SKIP LOCKED hands the row to one worker');
    const order = claimed[0];

    const summaryA = reconcileSummary();
    const summaryB = reconcileSummary();
    await Promise.all([
      reconcileOrderUsing(a, order, reconcileContext(VERIFY.paid, summaryA)),
      reconcileOrderUsing(b, order, reconcileContext(VERIFY.paid, summaryB)),
    ]);

    assert.equal(summaryA.markedPaid + summaryB.markedPaid, 1, 'the capture is recorded once');
    assert.equal(summaryA.unchanged + summaryB.unchanged, 1);
    const row = await orderRow(a, txnid);
    assert.equal(String(row.status), 'PAID');
    assert.equal(String(row.reservation_state), 'CONSUMED');
    assert.equal(await movementCount(a, created.order.id), 1);
    assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    assert.equal(Number((await a`select count(*)::int as count from refund_obligations`)[0].count), 0);
  } finally {
    await b.end();
    await closeSchema(a, schema);
  }
});

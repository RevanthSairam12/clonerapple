import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NextRequest } from 'next/server.js';

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

const root = process.cwd();
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  derivePaymentAndOrderStatus,
  deriveDocumentState,
} = await jiti.import(path.join(root, 'src/lib/orders/document-policy.ts'));

const {
  isReconcileHeartbeatStale,
  recordReconcileHeartbeat,
  readReconcileHeartbeat,
} = await jiti.import(path.join(root, 'src/lib/payu/reconcile-heartbeat.ts'));

const {
  buildNeedsAttentionItems,
  getNeedsAttentionSummary,
} = await jiti.import(path.join(root, 'src/lib/store-admin/needs-attention.ts'));

const {
  createOrderUsing,
  isIdenticalCheckoutAttempt,
  transitionOrderStatusUsing,
} = await loadModule('src/lib/payu/orders.ts');

const { readAvailabilityUsing } = await loadModule('src/lib/storefront/availability-server.ts');

test('isIdenticalCheckoutAttempt compares canonical items, coupon, contact and shipping address', () => {
  const base = {
    items: [{ productId: 'case-1', variantId: 'v-red', quantity: 2 }],
    couponCode: 'save10',
    customerEmail: 'Asha@Example.com',
    customerPhone: '9876543210',
    shippingAddress: {
      name: 'Asha Rao',
      phone: '9876543210',
      line1: '12 MG Road',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
  };

  assert.equal(
    isIdenticalCheckoutAttempt(base, {
      ...base,
      couponCode: ' SAVE10 ',
      customerEmail: 'asha@example.com',
      shippingAddress: { ...base.shippingAddress, city: 'bengaluru' },
    }),
    true,
  );

  // Changed quantity, variant, coupon, or pincode is not identical.
  assert.equal(
    isIdenticalCheckoutAttempt(base, {
      ...base,
      items: [{ productId: 'case-1', variantId: 'v-red', quantity: 1 }],
    }),
    false,
  );
  assert.equal(
    isIdenticalCheckoutAttempt(base, {
      ...base,
      items: [{ productId: 'case-1', variantId: 'v-black', quantity: 2 }],
    }),
    false,
  );
  assert.equal(isIdenticalCheckoutAttempt(base, { ...base, couponCode: 'OTHER' }), false);
  assert.equal(
    isIdenticalCheckoutAttempt(base, {
      ...base,
      shippingAddress: { ...base.shippingAddress, pincode: '411001' },
    }),
    false,
  );
});

test('shared status glossary derives separate Payment status and Order status across all combinations', () => {
  // Pending / Created unpaid orders
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'CREATED', fulfilmentStatus: 'PENDING' }),
    {
      paymentStatusKey: 'PENDING',
      paymentStatusLabel: 'Pending',
      orderStatusKey: 'AWAITING_PAYMENT',
      orderStatusLabel: 'Awaiting payment',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'PENDING', fulfilmentStatus: 'PENDING' }),
    {
      paymentStatusKey: 'PENDING',
      paymentStatusLabel: 'Pending',
      orderStatusKey: 'AWAITING_PAYMENT',
      orderStatusLabel: 'Awaiting payment',
    },
  );

  // PROCESSING payment is Verifying and Awaiting payment, never Paid or Confirmed
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'PROCESSING', fulfilmentStatus: 'PENDING' }),
    {
      paymentStatusKey: 'VERIFYING',
      paymentStatusLabel: 'Verifying',
      orderStatusKey: 'AWAITING_PAYMENT',
      orderStatusLabel: 'Awaiting payment',
    },
  );

  // FAILED payment stays Failed and Awaiting payment, never Confirmed
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'FAILED', fulfilmentStatus: 'PENDING' }),
    {
      paymentStatusKey: 'FAILED',
      paymentStatusLabel: 'Failed',
      orderStatusKey: 'AWAITING_PAYMENT',
      orderStatusLabel: 'Awaiting payment',
    },
  );

  // CANCELLED payment is Cancelled for both
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'CANCELLED', fulfilmentStatus: 'CANCELED' }),
    {
      paymentStatusKey: 'CANCELLED',
      paymentStatusLabel: 'Cancelled',
      orderStatusKey: 'CANCELLED',
      orderStatusLabel: 'Cancelled',
    },
  );

  // Verified PAID progresses through Confirmed -> Packed -> Shipped -> Delivered -> Returned
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'PAID', fulfilmentStatus: 'ACCEPTED' }),
    {
      paymentStatusKey: 'PAID',
      paymentStatusLabel: 'Paid',
      orderStatusKey: 'CONFIRMED',
      orderStatusLabel: 'Confirmed',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'PAID', fulfilmentStatus: 'PROCESSING' }),
    {
      paymentStatusKey: 'PAID',
      paymentStatusLabel: 'Paid',
      orderStatusKey: 'PACKED',
      orderStatusLabel: 'Packed',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'PAID', fulfilmentStatus: 'ON_THE_WAY' }),
    {
      paymentStatusKey: 'PAID',
      paymentStatusLabel: 'Paid',
      orderStatusKey: 'SHIPPED',
      orderStatusLabel: 'Shipped',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({ paymentStatus: 'PAID', fulfilmentStatus: 'DELIVERED' }),
    {
      paymentStatusKey: 'PAID',
      paymentStatusLabel: 'Paid',
      orderStatusKey: 'DELIVERED',
      orderStatusLabel: 'Delivered',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      returnStatus: 'RECEIVED',
      capturedPaise: 50000,
      refundedPaise: 50000,
    }),
    {
      paymentStatusKey: 'REFUNDED',
      paymentStatusLabel: 'Refunded',
      orderStatusKey: 'RETURNED',
      orderStatusLabel: 'Returned',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      capturedPaise: 50000,
      pendingRefundPaise: 20000,
    }),
    {
      paymentStatusKey: 'REFUND_INITIATED',
      paymentStatusLabel: 'Refund initiated',
      orderStatusKey: 'DELIVERED',
      orderStatusLabel: 'Delivered',
    },
  );
  assert.deepEqual(
    derivePaymentAndOrderStatus({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      capturedPaise: 50000,
      refundedPaise: 20000,
    }),
    {
      paymentStatusKey: 'PARTIALLY_REFUNDED',
      paymentStatusLabel: 'Partially refunded',
      orderStatusKey: 'DELIVERED',
      orderStatusLabel: 'Delivered',
    },
  );

  // deriveDocumentState exposes the exact same labels for admin, customer and result surfaces
  const docState = deriveDocumentState({
    paymentStatus: 'PAID',
    fulfilmentStatus: 'ON_THE_WAY',
    totalPaise: 50000,
    capturedPaise: 50000,
  });
  assert.equal(docState.paymentStatusLabel, 'Paid');
  assert.equal(docState.orderStatusLabel, 'Shipped');
});

test('reconcile heartbeat staleness turns true after 5 minutes or when never run', () => {
  const now = new Date('2026-11-08T12:10:00Z');
  assert.equal(isReconcileHeartbeatStale(null, now), true);
  assert.equal(isReconcileHeartbeatStale('invalid', now), true);
  assert.equal(isReconcileHeartbeatStale('2026-11-08T12:06:00Z', now), false, '4 minutes ago is healthy');
  assert.equal(isReconcileHeartbeatStale('2026-11-08T12:05:00Z', now), false, 'exact 5-minute boundary is healthy');
  assert.equal(isReconcileHeartbeatStale('2026-11-08T12:04:59Z', now), true, 'over 5 minutes is stale (red)');
});

test('Needs-attention items link to their operational screens and flag urgency', () => {
  const items = buildNeedsAttentionItems({
    flaggedPaymentsCount: 2,
    refundsOwedCount: 1,
    refundsOwedPaise: 49900,
    stuckVerifyingCount: 3,
    failedNotificationsCount: 4,
    reconcile: {
      jobName: 'payu_reconcile',
      lastRunAt: '2026-11-08T12:00:00Z',
      lastSuccessAt: '2026-11-08T12:00:00Z',
      lastProcessedCount: 7,
      lastError: '',
      stale: true,
      databaseNow: '2026-11-08T12:10:00Z',
    },
  });
  assert.equal(items.length, 5);
  assert.deepEqual(
    items.map((item) => [item.key, item.count, item.urgent, item.href]),
    [
      ['flagged_payments', 2, true, '/store-admin/payments'],
      ['refunds_owed', 1, true, '/store-admin/payments'],
      ['stuck_verifying', 3, true, '/store-admin/orders?state=PROCESSING'],
      ['failed_notifications', 4, true, '/store-admin/settings/notifications'],
      ['reconcile_heartbeat', 7, true, '/store-admin/payments'],
    ],
  );
});

test('GET /api/payu/reconcile requires CRON_SECRET in constant time and has zero side effects without it', async () => {
  let reconcileCalls = 0;
  let outboxCalls = 0;
  let pruneCalls = 0;

  const routeJiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/payu/reconcile': {
        reconcilePendingOrders: async () => {
          reconcileCalls += 1;
          return { processed: 3, errors: [] };
        },
      },
      '@/lib/payu/reconcile-heartbeat': {
        recordReconcileHeartbeat: async () => {},
      },
      '@/lib/notifications/outbox': {
        processNotificationOutbox: async () => {
          outboxCalls += 1;
          return { processed: 0 };
        },
        scrubOldNotifications: async () => ({ scrubbed: 0 }),
      },
      '@/lib/account/browsing-history': {
        pruneOldBrowsingHistory: async () => {
          pruneCalls += 1;
          return 0;
        },
      },
    },
  });

  const { GET, POST } = await routeJiti.import(path.join(root, 'src/app/api/payu/reconcile/route.ts'));
  const prevSecret = process.env.CRON_SECRET;

  try {
    // 1. Missing CRON_SECRET on GET fails closed (503) even in development
    delete process.env.CRON_SECRET;
    const noSecretRes = await GET(new NextRequest('http://localhost/api/payu/reconcile'));
    assert.equal(noSecretRes.status, 503);
    assert.equal(reconcileCalls, 0);
    assert.equal(outboxCalls, 0);
    assert.equal(pruneCalls, 0);

    // 2. Wrong Bearer token on GET returns 401 with zero side effects
    process.env.CRON_SECRET = 'test-cron-secret-value-12345';
    const wrongRes = await GET(
      new NextRequest('http://localhost/api/payu/reconcile', {
        headers: { authorization: 'Bearer wrong-secret' },
      }),
    );
    assert.equal(wrongRes.status, 401);
    assert.equal(reconcileCalls, 0);

    // 3. Valid Bearer token on GET runs the job (Vercel Cron contract)
    const okGet = await GET(
      new NextRequest('http://localhost/api/payu/reconcile', {
        headers: { authorization: 'Bearer test-cron-secret-value-12345' },
      }),
    );
    assert.equal(okGet.status, 200);
    const bodyGet = await okGet.json();
    assert.equal(bodyGet.success, true);
    assert.equal(reconcileCalls, 1);
    assert.equal(outboxCalls, 1);
    assert.equal(pruneCalls, 1);

    // 4. Valid Bearer token on POST also runs the job
    const okPost = await POST(
      new NextRequest('http://localhost/api/payu/reconcile', {
        method: 'POST',
        headers: { authorization: 'Bearer test-cron-secret-value-12345' },
      }),
    );
    assert.equal(okPost.status, 200);
    assert.equal(reconcileCalls, 2);
  } finally {
    if (prevSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevSecret;
  }
});

test('docs/reconcile-scheduling.md compares Vercel Cron, Supabase pg_cron + pg_net, and external schedulers', () => {
  const doc = readFileSync(path.join(root, 'docs/reconcile-scheduling.md'), 'utf8');
  assert.match(doc, /\* \* \* \* \*/);
  assert.match(doc, /Vercel Cron/);
  assert.match(doc, /Hobby/);
  assert.match(doc, /pg_cron/);
  assert.match(doc, /pg_net/);
  assert.match(doc, /CRON_SECRET/);
});

test(
  'DB integration: identical checkout resumes atomically, changed checkout supersedes, own hold never looks sold out, and late capture on superseded order is handled',
  { skip },
  async () => {
    const s = suffix();
    const schema = `fs_active_chk_${s}`;
    const productA = `fsacta${s}`;
    const productB = `fsactb${s}`;
    const user1 = `fsactu1${s}`;
    const user2 = `fsactu2${s}`;
    const a = client();
    let b;

    try {
      await openSchema(a, schema);
      b = client(schema);
      // Only 1 unit of productA exists!
      await addProduct(a, { categoryId: `fscat${s}`, productId: productA, stockId: `fsstkA${s}`, quantity: 1 });
      await addProduct(a, { categoryId: `fscat${s}`, productId: productB, stockId: `fsstkB${s}`, quantity: 2 });
      await addUser(a, user1);
      await addUser(a, user2);

      // 1. Two concurrent tabs for user1 with the IDENTICAL cart, address and coupon produce ONE order!
      const [tab1, tab2] = await Promise.all([
        createOrderUsing(a, orderParams({ productId: productA, txnid: `FSACT1A${s}`, userId: user1 })),
        createOrderUsing(b, orderParams({ productId: productA, txnid: `FSACT1B${s}`, userId: user1 })),
      ]);
      assert.equal(tab1.order.id, tab2.order.id, 'both tabs receive the exact same order');
      assert.equal(tab1.order.txnid, tab2.order.txnid);
      assert.equal(
        [tab1.resumed, tab2.resumed].filter(Boolean).length,
        1,
        'one created the order, the other resumed it',
      );
      const countAfterResume = await a`select count(*)::int as c from orders where user_id = ${user1}`;
      assert.equal(Number(countAfterResume[0].c), 1, 'no second order row created');
      assert.deepEqual(await stockState(a, productA), { onHand: 0, reserved: 0 });

      // 2. Customer's own held unit NEVER makes the 1-unit item look sold out to user1,
      //    while user2 sees it as out of stock!
      const availForUser1 = await readAvailabilityUsing(
        a,
        [productA],
        [{ productId: productA, quantity: 1 }],
        { userId: user1 },
      );
      assert.equal(availForUser1.products[0].inStock, true, 'user1 sees their own held unit as available');
      assert.equal(availForUser1.products[0].quantityAvailable, true);

      const availForUser2 = await readAvailabilityUsing(
        a,
        [productA],
        [{ productId: productA, quantity: 1 }],
        { userId: user2 },
      );
      assert.equal(availForUser2.products[0].inStock, false, 'user2 sees the held unit as unavailable');
      assert.equal(availForUser2.products[0].quantityAvailable, false);

      // 3. user1 changes their checkout (adds productB alongside productA, or changes address):
      //    the old attempt is superseded atomically in the same transaction, releasing the 1 unit
      //    of productA and re-claiming it for the new order without ever failing as out of stock!
      const firstTxnid = tab1.order.txnid;
      const firstOrderId = tab1.order.id;
      const changedParams = orderParams({ productId: productA, txnid: `FSACT2${s}`, userId: user1 });
      changedParams.shippingAddress = {
        ...changedParams.shippingAddress,
        line1: '99 New Street',
      };
      const supersededResult = await createOrderUsing(a, changedParams);
      assert.equal(supersededResult.resumed, false);
      assert.equal(supersededResult.order.txnid, `FSACT2${s}`);
      assert.equal(supersededResult.supersededOrders?.length, 1);
      assert.equal(supersededResult.supersededOrders?.[0].txnid, firstTxnid);

      const oldRow = await orderRow(a, firstTxnid);
      assert.equal(String(oldRow.status), 'CANCELLED');
      assert.equal(String(oldRow.reservation_state), 'RELEASED');
      assert.match(String(oldRow.reservation_released_reason), /SUPERSEDED/);
      assert.equal(await movementCount(a, firstOrderId), 2, 'sale + release on superseded order');
      assert.deepEqual(await stockState(a, productA), { onHand: 0, reserved: 0 }, 'claimed by the new order');

      // 4. A late capture arriving on the superseded order sees the unit is now held by the new
      //    order, so it records the payment, flags payment_review_required, and creates one refund obligation!
      const latePaid = await transitionOrderStatusUsing(a, {
        txnid: firstTxnid,
        targetStatus: 'PAID',
        mihpayid: `mih_late_${s}`,
        policy: POLICY,
      });
      assert.equal(latePaid.transitioned, true);
      assert.equal(latePaid.firstTimePaid, true);
      assert.equal(latePaid.stockReclaimed, false);
      assert.equal(latePaid.paymentReviewRequired, true);
      assert.equal(latePaid.refundObligationCreated, true);
    } finally {
      if (b) await b.end({ timeout: 5 });
      await closeSchema(a, schema);
    }
  },
);

test(
  'DB integration: reconcile heartbeat and needs-attention summary read and write on the test database',
  { skip },
  async () => {
    const a = client();
    try {
      await a`set search_path to public`;
      await recordReconcileHeartbeat(
        {
          processedCount: 4,
          lastError: '',
          succeeded: true,
        },
        a,
      );
      const hb = await readReconcileHeartbeat(a);
      assert.equal(hb.jobName, 'payu_reconcile');
      assert.equal(hb.lastProcessedCount, 4);
      assert.equal(hb.lastError, '');
      assert.equal(hb.stale, false, 'just-recorded heartbeat is healthy');

      const attention = await getNeedsAttentionSummary(a);
      assert.equal(attention.reconcile.stale, false);
      assert.equal(attention.items.length, 5);
    } finally {
      await a.end({ timeout: 5 });
    }
  },
);

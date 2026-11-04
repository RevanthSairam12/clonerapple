/**
 * The bridge from an order record to the template context.
 *
 * These values are the only order data a message can show, so the test pins
 * the money maths, both links and the fulfilment-to-topic mapping without a
 * database or a request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  fulfilmentNotificationEvent,
  orderNotificationContext,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'notifications', 'order-context.ts'),
);
const { stockNotificationEvent } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'notifications', 'stock-events.ts'),
);

function order(overrides = {}) {
  return {
    txnid: 'GDZ1001',
    orderNumber: 1001,
    items: [
      { id: 'p1', name: 'Phone', quantity: 2, unitPrice: 499.5, totalPrice: 999 },
    ],
    amount: 1099,
    shippingPaise: 10_000,
    status: 'PAID',
    customerName: 'Asha Rao',
    customerEmail: 'asha@example.test',
    customerPhone: '9876543210',
    ...overrides,
  };
}

test('an order context carries money, count and audience-specific links', () => {
  const context = orderNotificationContext(order(), { orderStatus: 'PAID' });

  assert.equal(context.txnid, 'GDZ1001');
  assert.equal(context.orderNumber, '1001');
  assert.equal(context.customerName, 'Asha Rao');
  assert.equal(context.customerEmail, 'asha@example.test');
  assert.equal(context.customerPhone, '9876543210');
  assert.equal(context.orderTotalPaise, 109_900);
  assert.equal(context.shippingPaise, 10_000, 'shipping is the stored snapshot');
  assert.equal(context.itemCount, 2);
  assert.equal(context.orderStatus, 'PAID');
  assert.equal(context.customerLink, '/order/status?txnid=GDZ1001');
  assert.equal(context.staffLink, '/store-admin/orders/GDZ1001');

  // None of the data a message must never contain is copied in.
  for (const forbidden of ['address', 'notes', 'payuRawResponse', 'cost', 'audit']) {
    assert.equal(forbidden in context, false, `${forbidden} cannot reach a template`);
  }
});

test('discounts never reduce the stored shipping in notifications', () => {
  const context = orderNotificationContext(order({
    amount: 949,
    discountPaise: 15_000,
    couponCode: 'SAVE150',
  }));
  assert.equal(context.orderTotalPaise, 94_900);
  assert.equal(context.shippingPaise, 10_000);
  assert.equal(context.discountPaise, 15_000);
});

test('free and legacy shipping never get inferred from a total remainder', async () => {
  const { templateValues } = await jiti.import('../src/lib/notifications/templates.ts');
  for (const shippingPaise of [0, undefined]) {
    const context = orderNotificationContext(order({ shippingPaise }));
    assert.equal(context.shippingPaise, 0);
    assert.equal(templateValues({ ...context, audience: 'customer' }).shipping_amount, 'Free');
  }
  const context = orderNotificationContext(order({ shippingPaise: 5_001 }));
  assert.equal(templateValues({ ...context, audience: 'customer' }).shipping_amount, '₹50.01');
});

test('the txnid stands in when an order has no display number', () => {
  const context = orderNotificationContext(order({ orderNumber: null }));
  assert.equal(context.orderNumber, 'GDZ1001');
});

test('a txnid with URL characters is encoded and never becomes a new parameter', () => {
  const context = orderNotificationContext(order({ txnid: 'A B&c=d' }));
  assert.equal(context.customerLink, '/order/status?txnid=A%20B%26c%3Dd');
  assert.equal(context.staffLink, '/store-admin/orders/A%20B%26c%3Dd');
});

test('a stock alert only fires on a crossing, never on every adjustment', () => {
  // Out of stock to available is a restock, even when the new count is low.
  assert.equal(
    stockNotificationEvent({ availableBefore: 0, availableAfter: 3, threshold: 5 }),
    'back_in_stock',
  );
  // Above the threshold to low is the alert.
  assert.equal(
    stockNotificationEvent({ availableBefore: 20, availableAfter: 4, threshold: 5 }),
    'low_stock',
  );
  // Already low stays silent.
  assert.equal(
    stockNotificationEvent({ availableBefore: 3, availableAfter: 2, threshold: 5 }),
    null,
  );
  // Crossing down to zero is out of stock, not the low-stock alert.
  assert.equal(
    stockNotificationEvent({ availableBefore: 8, availableAfter: 0, threshold: 5 }),
    null,
  );
  // Above the threshold either way is silent.
  assert.equal(
    stockNotificationEvent({ availableBefore: 12, availableAfter: 30, threshold: 5 }),
    null,
  );
  // A threshold of zero makes the low-stock alert impossible.
  assert.equal(
    stockNotificationEvent({ availableBefore: 4, availableAfter: 1, threshold: 0 }),
    null,
  );
});

test('fulfilment statuses map only to real matrix topics', () => {
  assert.equal(fulfilmentNotificationEvent('PROCESSING'), 'processing');
  assert.equal(fulfilmentNotificationEvent('ON_THE_WAY'), 'shipped');
  assert.equal(fulfilmentNotificationEvent('DELIVERED'), 'delivered');
  assert.equal(fulfilmentNotificationEvent('CANCELED'), 'cancelled');

  // No matrix topic exists for these, so they must not send misleading copy.
  assert.equal(fulfilmentNotificationEvent('PENDING'), null);
  assert.equal(fulfilmentNotificationEvent('ACCEPTED'), null);
});

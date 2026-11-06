import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { hasShipmentStarted, fulfilmentLabel, FULFILMENT_STEPS } = await jiti.import(path.join(root, 'src/lib/orders/fulfilment.ts'));
const { toDeliverySnapshot, liveSignature, accountOrderHistoryLabel } = await jiti.import(path.join(root, 'src/lib/account/order-live.ts'));

const prepared = {
  status: 'SCHEDULED',
  delivery_method: 'courier',
  courier_name: 'Example courier',
  tracking_number: 'AWB-123',
  tracking_url: 'https://tracking.example/parcel/AWB-123',
  scheduled_for: '2026-11-03T10:00:00Z',
  delivery_slot: '10:00-13:00',
  delivered_at: null,
  person_name: 'Private staff name',
  person_phone: 'Private staff phone',
};

for (const status of ['PENDING', 'ACCEPTED', 'PROCESSING', 'CANCELED']) {
  test(`${status} never reveals prepared shipment metadata without pickup evidence`, () => {
    assert.equal(hasShipmentStarted(status), false);
    assert.equal(toDeliverySnapshot(prepared, hasShipmentStarted(status)), null);
    assert.equal(toDeliverySnapshot(prepared), null, 'the projection fails closed by default');
  });
}

test('pickup is proved only by fulfilment current state or fulfilment history', () => {
  for (const status of ['ON_THE_WAY', 'DELIVERED']) {
    assert.equal(hasShipmentStarted(status), true);
    assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'fulfilment', toStatus: status }]), true);
    assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'fulfilment', to_status: status }]), true);
    assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'payment', toStatus: status }]), false);
    assert.equal(hasShipmentStarted('CANCELED', [{ toStatus: status }]), false);
  }
  const evidence = [{ domain: 'fulfilment', to_status: 'ON_THE_WAY' }];
  assert.equal(toDeliverySnapshot(prepared, hasShipmentStarted('CANCELED', evidence)).trackingNumber, 'AWB-123');
});

test('shipment snapshots whitelist fields and reject unsafe tracking links', () => {
  const delivery = toDeliverySnapshot(prepared, true);
  assert.deepEqual(Object.keys(delivery).sort(), [
    'status', 'method', 'carrier', 'trackingNumber', 'trackingUrl', 'scheduledFor', 'deliverySlot', 'deliveredAt',
  ].sort());
  assert.equal(delivery.carrier, 'Example courier');
  assert.equal(delivery.scheduledFor, '2026-11-03T10:00:00.000Z');
  assert.equal(delivery.deliverySlot, '10:00-13:00');
  for (const tracking_url of ['http://tracking.example/a', 'javascript:alert(1)', 'https://user:password@tracking.example/a']) {
    assert.equal(toDeliverySnapshot({ ...prepared, tracking_url }, true).trackingUrl, null);
  }
});

test('driver rows and JSON live rows produce identical snapshots and signatures', () => {
  const detail = toDeliverySnapshot({ ...prepared, scheduled_for: new Date(prepared.scheduled_for) }, true);
  const polled = toDeliverySnapshot(JSON.parse(JSON.stringify(prepared)), true);
  assert.deepEqual(detail, polled);
  assert.deepEqual(toDeliverySnapshot(detail, true), detail, 'camel-case snapshot parsing is stable too');
  const live = {
    txnid: 'customer-order', status: 'ON_THE_WAY', paymentStatus: 'PAID',
    fulfilmentStatus: 'ON_THE_WAY', updatedAt: '2026-11-03T11:00:00.000Z',
    delivery: detail, requests: [], refunds: [],
  };
  assert.equal(liveSignature(live), liveSignature({ ...live, delivery: polled }));
  for (const [field, value] of Object.entries({
    method: 'self', carrier: 'Changed carrier', trackingNumber: 'AWB-456',
    trackingUrl: 'https://tracking.example/changed', scheduledFor: '2026-11-04T10:00:00.000Z',
    deliverySlot: '13:00-17:00', deliveredAt: '2026-11-04T11:00:00.000Z',
  })) {
    assert.notEqual(liveSignature(live), liveSignature({ ...live, delivery: { ...detail, [field]: value } }), field);
  }
});

test('customer workflow and payment history use distinct vocabularies', () => {
  assert.deepEqual(FULFILMENT_STEPS.map((status) => fulfilmentLabel(status)), [
    'Pending', 'Accepted', 'Preparing', 'Pickup done / In transit', 'Delivered',
  ]);
  assert.match(fulfilmentLabel('ON_THE_WAY', 'self'), /Dispatched/);
  assert.equal(accountOrderHistoryLabel('payment', 'PROCESSING'), 'Payment processing');
  assert.equal(accountOrderHistoryLabel('fulfilment', 'PROCESSING'), 'Preparing');
  assert.equal(accountOrderHistoryLabel('internal', 'PROCESSING'), null);
});

test('owner-scoped account reads gate detail and live delivery through the same parser', () => {
  const source = read('src/lib/account/orders.ts');
  assert.match(source, /toDeliverySnapshot\(deliveryRows\[0\], shipmentStarted\)/);
  assert.match(source, /toDeliverySnapshot\(order\.delivery, hasShipmentStarted/);
  assert.match(source, /h\.domain = 'fulfilment'/);
  assert.match(source, /h\.to_status in \('ON_THE_WAY', 'DELIVERED'\)/);
  assert.match(source, /s\.user_id = \$\{userId\}/);
  assert.match(source, /where txnid = \$\{txnid\} and user_id = \$\{userId\}/);
  assert.match(source, /domain === 'fulfilment' && row\.to_status === 'DELIVERED'/);
  assert.doesNotMatch(source, /person_name|person_phone/);
});

test('status loader strips even the top-level schedule slot before pickup', () => {
  const source = read('src/lib/order-status.ts');
  assert.match(source, /hasShipmentStarted\(order\.fulfilment_status, history\)/);
  assert.match(source, /const deliveryRow = shipmentStarted \?/);
  assert.match(source, /deliverySlot: shipmentStarted \? nullableText\(order\.delivery_slot\) : null/);
  assert.doesNotMatch(source, /person_name|person_phone|personPhone|personName/);
});

test('customer pages preserve shipment/access boundaries while result status removes placeholders', () => {
  const detail = read('src/app/account/orders/[txnid]/page.tsx');
  const status = read('src/components/orders/OrderResultPage.tsx');
  for (const source of [detail, status]) {
    assert.match(source, /hasShipmentStarted\(/);
    assert.match(source, /validateHttpsTrackingUrl\(/);
    assert.match(source, /accountOrderHistoryLabel\(entry\.domain, entry\.toStatus/);
  }
  assert.match(detail, /\{shipmentStarted \? \(/);
  assert.match(detail, /Shipment details will appear after pickup/);
  assert.match(detail, /requireAccountPageSession/);
  assert.match(detail, /order\.address &&/);
  assert.match(detail, /order\.shippingPaise/);
  assert.match(status, /resolveReturnAccess\(/);
  // A shared return link (summary access) shows the outcome only: shipment,
  // items and the status timeline are owner-only (L-2).
  assert.match(status, /access === 'owner' && shipmentStarted \? order\.delivery : null/);
  assert.match(status, /\{delivery && <section/);
  assert.match(status, /\{access === 'owner' && order\.items\.length > 0 && <section/);
  assert.match(status, /\{access === 'owner' && <section className="mt-8" aria-labelledby="order-timeline-title">/);
  assert.match(status, /state\.canCheck \? access === 'owner' \? <CheckPaymentButton/);
  assert.doesNotMatch(status, /Shipment details will appear after pickup|FULFILMENT_STEPS|Order progress/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FULFILMENT_TRANSITIONS,
  canTransitionFulfilment,
  mapSaleState,
  validateTrackingUrl,
} from '../src/lib/store-admin/order-rules.ts';
import {
  maskCustomerEmail,
  maskCustomerPhone,
} from '../src/lib/store-admin/masking.ts';
import {
  DELIVERY_SLOTS,
  validateDeliveryInput,
  validateHttpsTrackingUrl,
} from '../src/lib/store-admin/delivery.ts';

test('fulfilment transition table allows the Phase 1 forward path', () => {
  assert.equal(canTransitionFulfilment('PENDING', 'ACCEPTED'), true);
  assert.equal(canTransitionFulfilment('ACCEPTED', 'PROCESSING'), true);
  assert.equal(canTransitionFulfilment('PROCESSING', 'ON_THE_WAY'), true);
  assert.equal(canTransitionFulfilment('ON_THE_WAY', 'DELIVERED'), true);
});

test('fulfilment transition table rejects backwards and terminal changes', () => {
  assert.equal(canTransitionFulfilment('PROCESSING', 'PENDING'), false);
  assert.equal(canTransitionFulfilment('DELIVERED', 'PROCESSING'), false);
  assert.equal(canTransitionFulfilment('CANCELED', 'DELIVERED'), false);
});

test('sale state mapping follows refund, payment, cancellation, and fulfilment precedence', () => {
  assert.equal(mapSaleState({ paymentStatus: 'PAID', fulfilmentStatus: 'PENDING', refundCount: 1 }), 'REFUNDED');
  assert.equal(mapSaleState({ paymentStatus: 'FAILED', fulfilmentStatus: 'DELIVERED' }), 'PAYMENT_FAILED');
  assert.equal(mapSaleState({ paymentStatus: 'CANCELLED', fulfilmentStatus: 'PROCESSING' }), 'CANCELED');
  assert.equal(mapSaleState({ paymentStatus: 'PAID', fulfilmentStatus: 'ON_THE_WAY' }), 'ON_THE_WAY');
  assert.equal(mapSaleState({ paymentStatus: 'PAID', fulfilmentStatus: 'PENDING', scheduledFor: '2026-10-21T10:00:00Z' }), 'SCHEDULED');
  assert.equal(mapSaleState({ paymentStatus: 'PAID', fulfilmentStatus: 'ACCEPTED' }), 'ACCEPTED');
});

test('customer masking helpers do not expose full contact values', () => {
  assert.equal(maskCustomerEmail('ravi.kumar@example.com'), 'r***@example.com');
  assert.equal(maskCustomerPhone('+91 98765 43210'), '91********10');
});

test('tracking URL validation allows HTTPS links without credentials', () => {
  assert.equal(validateTrackingUrl('https://courier.example/track/ABC123'), 'https://courier.example/track/ABC123');
  assert.equal(validateTrackingUrl('https://courier.example/track?q=ABC123'), 'https://courier.example/track?q=ABC123');
});

test('tracking URL validation rejects unsafe or local links', () => {
  assert.equal(validateTrackingUrl('javascript:alert(1)'), null);
  assert.equal(validateTrackingUrl('http://courier.example/track/ABC123'), null);
  assert.equal(validateTrackingUrl('https://user:pass@courier.example/track'), null);
  assert.equal(validateTrackingUrl(''), null);
});

test('delivery validation uses the three fixed slots and requires self-delivery contact', () => {
  assert.deepEqual([...DELIVERY_SLOTS], ['10:00-13:00', '13:00-17:00', '17:00-20:00']);
  assert.equal(validateDeliveryInput({
    method: 'self',
    date: '2099-01-01',
    slot: '10:00-13:00',
  }).ok, false);
  assert.equal(validateDeliveryInput({
    method: 'self',
    personName: 'Delivery Person',
    personPhone: '0000000000',
    date: '2099-01-01',
    slot: '10:00-13:00',
  }).ok, true);
  assert.equal(validateDeliveryInput({
    method: 'courier',
    courierName: 'Courier',
    date: '2099-01-01',
    slot: '13:00-17:00',
  }).ok, false);
});

test('canonical tracking URL validation is HTTPS-only', () => {
  assert.equal(validateHttpsTrackingUrl('https://courier.example/track/ABC123'), 'https://courier.example/track/ABC123');
  assert.equal(validateHttpsTrackingUrl('http://courier.example/track/ABC123'), null);
});

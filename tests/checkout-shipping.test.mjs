import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SHIPPING_POLICY, quoteShipping } from '../src/lib/checkout/shipping-rules.ts';

const policy = (overrides = {}) => ({
  enabled: true,
  chargePaise: 5000,
  freeShippingThresholdPaise: 100000,
  ...overrides,
});

test('disabled shipping always quotes zero', () => {
  assert.deepEqual(quoteShipping(50000, { ...EMPTY_SHIPPING_POLICY }), {
    shippingPaise: 0, methodId: null, methodName: null, reason: 'disabled',
  });
});

test('canonical rate applies below threshold and threshold is inclusive', () => {
  assert.equal(quoteShipping(49900, policy()).shippingPaise, 5000);
  assert.equal(quoteShipping(99900, policy()).shippingPaise, 5000);
  assert.equal(quoteShipping(100000, policy()).shippingPaise, 0);
});

test('null threshold never grants threshold free shipping, while zero qualifies nonempty carts', () => {
  assert.equal(quoteShipping(100000, policy({ freeShippingThresholdPaise: null })).shippingPaise, 5000);
  assert.equal(quoteShipping(0, policy({ freeShippingThresholdPaise: 0 })).shippingPaise, 5000);
  assert.equal(quoteShipping(1, policy({ freeShippingThresholdPaise: 0 })).shippingPaise, 0);
});

test('validated free-shipping coupon overrides rate and threshold', () => {
  const quote = quoteShipping(1, policy({ freeShippingThresholdPaise: null }), true);
  assert.equal(quote.shippingPaise, 0);
  assert.equal(quote.reason, 'free-coupon');
});

test('zero charge and invalid amounts cannot create a negative quote', () => {
  assert.equal(quoteShipping(-1, policy({ chargePaise: -1 })).shippingPaise, 0);
  assert.equal(quoteShipping(500, policy({ chargePaise: 0 })).reason, 'rate');
});

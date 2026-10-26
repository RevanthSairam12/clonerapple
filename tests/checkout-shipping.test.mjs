import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_SHIPPING_POLICY,
  normalizeSubtotalPaise,
  quoteShipping,
  selectShippingMethod,
} from '../src/lib/checkout/shipping-rules.ts';

function method(overrides = {}) {
  return {
    id: 'sm_1',
    name: 'Standard',
    ratePaise: 4900,
    freeOverPaise: 0,
    isActive: true,
    sortOrder: 1,
    ...overrides,
  };
}

function policy(overrides = {}) {
  return { enabled: true, freeShippingOverPaise: 0, methods: [method()], ...overrides };
}

test('shipping disabled or no active method never charges', () => {
  assert.deepEqual(quoteShipping(500000, { ...policy(), enabled: false }), {
    shippingPaise: 0,
    methodId: null,
    methodName: null,
    reason: 'disabled',
  });
  assert.equal(quoteShipping(500000, EMPTY_SHIPPING_POLICY).reason, 'disabled');
  assert.equal(quoteShipping(500000, policy({ methods: [] })).reason, 'no-method');
  assert.equal(
    quoteShipping(500000, policy({ methods: [method({ isActive: false })] })).reason,
    'no-method',
  );
  assert.equal(quoteShipping(500000, policy({ methods: [method({ isActive: false })] })).shippingPaise, 0);
});

test('a rate applies below the store-wide threshold', () => {
  const quote = quoteShipping(99900, policy({ freeShippingOverPaise: 100000 }));
  assert.equal(quote.shippingPaise, 4900);
  assert.equal(quote.reason, 'rate');
  assert.equal(quote.methodId, 'sm_1');
});

test('the store-wide free threshold applies at exactly the threshold', () => {
  assert.equal(quoteShipping(99999, policy({ freeShippingOverPaise: 100000 })).shippingPaise, 4900);
  const free = quoteShipping(100000, policy({ freeShippingOverPaise: 100000 }));
  assert.equal(free.shippingPaise, 0);
  assert.equal(free.reason, 'free-threshold');
  assert.equal(free.methodId, 'sm_1');
});

test("the method's own free-over threshold applies when the store threshold is off", () => {
  const quote = quoteShipping(250000, policy({ methods: [method({ freeOverPaise: 250000 })] }));
  assert.equal(quote.shippingPaise, 0);
  assert.equal(quote.reason, 'method-free');
});

test('the earliest active method is chosen deterministically', () => {
  const methods = [
    method({ id: 'sm_b', name: 'Express', ratePaise: 9900, sortOrder: 2 }),
    method({ id: 'sm_a', name: 'Standard', ratePaise: 4900, sortOrder: 1 }),
  ];
  assert.equal(selectShippingMethod(methods)?.id, 'sm_a');
  assert.equal(quoteShipping(1000, policy({ methods })).shippingPaise, 4900);
  assert.equal(
    selectShippingMethod([
      method({ id: 'sm_y', name: 'Zeta', sortOrder: 0 }),
      method({ id: 'sm_x', name: 'Alpha', sortOrder: 0 }),
    ])?.id,
    'sm_x',
  );
});

test('invalid inputs never produce a negative or fractional charge', () => {
  assert.equal(normalizeSubtotalPaise(-500), 0);
  assert.equal(normalizeSubtotalPaise('abc'), 0);
  assert.equal(quoteShipping(-1, policy()).shippingPaise, 4900);
  assert.equal(quoteShipping(1000, policy({ methods: [method({ ratePaise: -100 })] })).shippingPaise, 0);
  assert.equal(quoteShipping(1000, policy({ methods: [method({ ratePaise: 49.9 })] })).shippingPaise, 49);
  assert.equal(quoteShipping(1000, policy({ freeShippingOverPaise: -5000 })).shippingPaise, 4900);
});

test('a zero-rate method is still a rate rather than a free-threshold reason', () => {
  const quote = quoteShipping(1000, policy({ methods: [method({ ratePaise: 0 })] }));
  assert.equal(quote.shippingPaise, 0);
  assert.equal(quote.reason, 'rate');
});

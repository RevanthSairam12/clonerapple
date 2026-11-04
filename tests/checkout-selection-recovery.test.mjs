import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutFixture as fixture, policy, variant } from './helpers/checkout-component-fixture.mjs';

for (const scenario of [
  { url: '/order/status?txnid=GDZ1001', expiry: '2030-01-01T00:00:00.000Z', safe: true },
  { url: 'https://attacker.invalid/order/status?txnid=GDZ1001', expiry: 'not-a-date', safe: false },
  { url: '/order/status?txnid=GDZ1001&redirect=evil', expiry: null, safe: false },
]) test(`reservation response keeps bag and blocks repeat payment: ${scenario.safe ? 'safe status/expiry' : scenario.url}`, async () => {
  const f = fixture();
  f.respond(async () => ({ status: 409, ok: false, json: async () => ({ code: 'reservation_active', statusUrl: scenario.url, reservationExpiresAt: scenario.expiry }) }));
  await f.submit(f.render());
  const tree = f.render();
  assert.match(f.text(tree), /current bag is kept/);
  const pay = f.visit(tree, node => node.props?.id === 'checkout-pay-now-btn');
  assert.equal(pay.props.disabled, true);
  assert.equal(pay.props['aria-disabled'], true);
  const link = f.visit(tree, node => node.props?.href === (scenario.safe ? scenario.url : '/account/orders'));
  assert.ok(link);
  assert.equal(link.props.prefetch, false);
  const time = f.visit(tree, node => node.type === 'time');
  assert.equal(Boolean(time), scenario.safe);
  if (time) assert.equal(time.props.dateTime, scenario.expiry);
  assert.equal(Boolean(f.visit(tree, node => node.props?.href?.startsWith('https://attacker'))), false);
  await f.submit(tree);
  assert.deepEqual(f.counts(), { requests: 1, syncs: 0, removals: 0, submissions: 0 });
});

test('selection conflict identifies the exact option, preserves bag, stops payment and offers review/choose links', async () => {
  const f = fixture();
  await f.submit(f.render());
  const tree = f.render();
  assert.match(f.text(tree), /Case.*Original option.*no longer available/);
  assert.match(f.text(tree), /Your bag is unchanged/);
  assert.ok(f.visit(tree, node => node.props?.href === '/cart' && f.text(node) === 'Review bag'));
  assert.ok(f.visit(tree, node => node.props?.href === '/shop/product/case' && f.text(node) === 'Choose options'));
  assert.equal(f.visit(tree, node => node.props?.id === 'checkout-pay-now-btn').props.disabled, true);
  await f.submit(tree);
  assert.deepEqual(f.counts(), { requests: 1, syncs: 0, removals: 0, submissions: 0 });
});

test('existing price_changed quote recovery still updates exact prices, but later selection conflict invalidates it', async () => {
  const f = fixture();
  f.respond(async () => ({ status: 409, ok: false, json: async () => ({ code: 'price_changed', shippingPolicy: policy, items: [{ id: 'case', variantId: 'exact', name: 'Case', quantity: 1, unitPaise: 12000, totalPaise: 12000, regularPricePaise: null }], totals: { subtotalPaise: 12000, discountPaise: 0, shippingPaise: 0, totalPaise: 12000 } }) }));
  await f.submit(f.render());
  let tree = f.render();
  assert.match(f.text(tree), /Prices or shipping have changed/);
  assert.equal(f.visit(tree, node => node.props?.id === 'checkout-pay-now-btn').props.disabled, false);
  assert.equal(f.counts().syncs, 1);
  f.respond(async () => ({ status: 409, ok: false, json: async () => ({ code: 'selection_unavailable', selection: { id: 'case', variantId: 'exact' } }) }));
  await f.submit(tree);
  tree = f.render();
  assert.match(f.text(tree), /no longer available/);
  assert.doesNotMatch(f.text(tree), /Prices or shipping have changed/);
  assert.deepEqual(f.counts(), { requests: 2, syncs: 1, removals: 0, submissions: 0 });
  // A router/catalog refresh cannot resurrect the previous quote or unblock
  // payment while the customer has not reviewed the conflicted selection.
  f.replaceProducts([{ id: 'case', inventoryMode: 'variant', pricePaise: 10000, inStock: true, purchasableVariants: [variant] }]);
  tree = f.render();
  assert.equal(f.visit(tree, node => node.props?.id === 'checkout-pay-now-btn').props.disabled, true);
  await f.submit(tree);
  assert.deepEqual(f.counts(), { requests: 2, syncs: 1, removals: 0, submissions: 0 });
});

test('a stale quote after selection snapshot A to B to A cannot sync prices or submit payment', async () => {
  const f = fixture();
  let resolveResponse;
  f.respond(() => new Promise(resolve => { resolveResponse = resolve; }));
  const pending = f.submit(f.render());
  // Availability verification is asynchronous, then the initiate response waits.
  await new Promise(resolve => setImmediate(resolve));
  f.replaceProducts([]); f.render();
  f.replaceProducts([{ id: 'case', inventoryMode: 'variant', pricePaise: 10000, inStock: true, purchasableVariants: [variant] }]); f.render();
  resolveResponse({ status: 409, ok: false, json: async () => ({ code: 'price_changed' }) });
  await pending;
  assert.match(f.text(f.render()), /Your order changed/);
  assert.deepEqual(f.counts(), { requests: 1, syncs: 0, removals: 0, submissions: 0 });
});

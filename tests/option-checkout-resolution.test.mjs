import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentConnection as connection, resolveCartItemsFromDbUsing, evaluateCoupon, quoteShipping } from './helpers/payment-catalog-fixture.mjs';
const lines = [
  { id: 'case', variantId: 'inherited', quantity: 1, expectedUnitPaise: 8000 },
  { id: 'case', variantId: 'override', quantity: 2, expectedUnitPaise: 12000 },
];
test('payment reader resolves exact raw option sources and never opens application pool', async () => {
  const { sql, queries } = connection();
  const cart = await resolveCartItemsFromDbUsing(sql, lines);
  assert.equal(cart.totalPaise, 32000);
  assert.deepEqual(cart.items.map(item => [item.variantId, item.unitPaise, item.regularPricePaise]), [['inherited', 8000, 10000], ['override', 12000, 15000]]);
  assert.deepEqual(cart.priceChanges, []);
  assert.ok(queries.some(query => query.includes('clock_timestamp()')));
});
test('sale ending after display restores option regular prices and flags each exact line', async () => {
  const cart = await resolveCartItemsFromDbUsing(connection({ expired: true }).sql, lines);
  assert.equal(cart.totalPaise, 40000);
  assert.deepEqual(cart.priceChanges.map(change => [change.variantId, change.actualPaise]), [['inherited', 10000], ['override', 15000]]);
});
test('coupons scoped to a product and shipping threshold use resolved option line totals', async () => {
  const cart = await resolveCartItemsFromDbUsing(connection().sql, lines);
  const shipping = quoteShipping(cart.totalPaise, { enabled: true, chargePaise: 5000, freeShippingThresholdPaise: 35000 });
  assert.equal(shipping.shippingPaise, 5000);
  const couponLines = cart.items.map(item => ({ productId: item.id, categoryId: null, brandId: null, quantity: item.quantity, unitPaise: item.unitPaise, linePaise: item.unitPaise * item.quantity, onSale: item.onSale }));
  const base = { id: 'coupon', code: 'SAVE10', name: 'Discount', type: 'PERCENT', value: 10, scope: 'PRODUCTS', targets: [{ productId: 'case' }], status: 'active', startsAt: null, endsAt: null, totalRedemptionLimit: null, perCustomerLimit: null, minOrderPaise: 0, maxDiscountPaise: null, onlyNewCustomers: false, allowWithSalePrice: true, allowedCustomerGroups: null, restrictedToEmails: null };
  const context = { now: new Date('2026-11-03T11:59:00Z'), subtotalPaise: cart.totalPaise, shippingPaise: shipping.shippingPaise, customer: { userId: null, email: 'buyer@example.test', group: null }, customerPaidOrderExists: false, customerRedemptions: 0, totalRedemptions: 0 };
  for (const [coupon, expected] of [[base, 3200], [{ ...base, type: 'FIXED', value: 5000 }, 5000]]) {
    const result = evaluateCoupon({ coupon, lines: couponLines, context });
    assert.equal(result.ok, true);
    assert.equal(result.discountPaise, expected);
  }
});

test('payment retains inactive reference mappings with storefront category, nonretired identity and exact-stock eligibility', async () => {
  const { sql, queries } = connection();
  await resolveCartItemsFromDbUsing(sql, lines);
  const query = queries.find(query => query.includes('from products p')).replace(/\s+/g, ' ');
  // SQL contracts, not a simulated execution of PostgreSQL predicates: only
  // reference active status is relaxed for an existing eligible option.
  for (const predicate of ['join categories c on c.id = p.category_id and c.is_active and c.deleted_at is null',
    'p.deleted_at is null', 'and p.is_active', "v.product_id=p.id and p.inventory_mode='variant'", 'v.is_active and v.is_purchasable and v.retired_at is null',
    "nullif(trim(v.sku), '') is not null", "nullif(trim(v.combination_key), '') is not null", 's.id is not null',
    's.product_id=p.id and s.variant_id is not distinct from v.id',
    'not coalesce(pt.requires_compatibility,false) or v.device_model_id is not null',
    'v.device_model_id is null or (dm.id is not null and db.id is not null and exists(',
    'pdm.product_id=p.id and pdm.device_model_id=v.device_model_id and pdm.archived_at is null',
    'lower(p.id) = any(?::text[])']) {
    assert.ok(query.includes(predicate), predicate);
  }
  assert.doesNotMatch(query, /\b(?:dm|db)\.is_active/, 'deactivation alone must not remove retained mapped commerce');
  assert.doesNotMatch(query, /option_identity/, 'legacy saved commerce does not require backfilled option semantics to purchase');
});

test('missing eligible exact variant never falls back to an eligible sibling or parent', async () => {
  const { sql } = connection();
  await assert.rejects(resolveCartItemsFromDbUsing(sql, [{ id: 'case', variantId: 'missing', quantity: 1 }]), error =>
    error.name === 'SelectionUnavailableError' && error.selection.id === 'case' && error.selection.variantId === 'missing');
  await assert.rejects(resolveCartItemsFromDbUsing(connection({ rows: [] }).sql, lines), error => error.name === 'SelectionUnavailableError');
});

test('untyped shared and model-specific product selections price the parent only', async () => {
  // SQL predicate assertions above cover absence of a type / optional model branch.
  // These rows model the eligible result, not PostgreSQL predicate execution.
  for (const type of [null, 'shared', 'model-specific']) {
    const row = { id: 'cable', name: 'Cable', inventory_mode: 'product', price_paise: 10000, in_stock: true, track_inventory: false, product_type_id: type };
    const cart = await resolveCartItemsFromDbUsing(connection({ rows: [row] }).sql, [{ id: 'cable', quantity: 2 }]);
    assert.equal(cart.totalPaise, 20000);
    assert.equal(cart.items[0].variantId, undefined);
    await assert.rejects(resolveCartItemsFromDbUsing(connection({ rows: [row] }).sql, [{ id: 'cable', variantId: 'invented-device', quantity: 1 }]), error => error.name === 'SelectionUnavailableError');
  }
});

test('normal-mode in_stock=false blocks absent and explicitly untracked parents only', async () => {
  const parent = { id: 'cable', name: 'Cable', inventory_mode: 'product', price_paise: 10000, in_stock: false };
  for (const track_inventory of [null, undefined, false]) {
    await assert.rejects(resolveCartItemsFromDbUsing(connection({ expired: true, rows: [{ ...parent, track_inventory }] }).sql, [{ id: 'cable', quantity: 1 }]), error => error.name === 'InsufficientStockError');
    assert.equal((await resolveCartItemsFromDbUsing(connection({ rows: [{ ...parent, track_inventory }] }).sql, [{ id: 'cable', quantity: 1 }])).totalPaise, 10000);
  }
  assert.equal((await resolveCartItemsFromDbUsing(connection({ expired: true, rows: [{ ...parent, track_inventory: true }] }).sql, [{ id: 'cable', quantity: 1 }])).totalPaise, 10000);
  const variant = { ...parent, inventory_mode: 'variant', variant_id: 'exact', track_inventory: false };
  assert.equal((await resolveCartItemsFromDbUsing(connection({ expired: true, rows: [variant] }).sql, [{ id: 'cable', variantId: 'exact', quantity: 1 }])).items[0].variantId, 'exact');
});

test('SQL infrastructure failure remains the original failure, never an unavailable selection', async () => {
  const failure = new Error('synthetic database outage');
  await assert.rejects(resolveCartItemsFromDbUsing(connection({ failure }).sql, lines), error => error === failure);
});

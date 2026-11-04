import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NextRequest } from 'next/server.js';

// Invoke the real route; no module can obtain a real database or gateway client.
let saved = null;
let session = { userId: 'owner' };
let creates = 0;
let addressReads = [];
let creationError = null;
let paymentConfigured = false;
let capturedCart;
const pricing = await createJiti(import.meta.url, { alias: { '@': path.resolve('src') } }).import(path.resolve('src/lib/payu/db-pricing.ts'));
const jiti = createJiti(import.meta.url, {
  moduleCache: false, alias: { '@': path.resolve('src') }, virtualModules: {
    '@/lib/payu/db-pricing': pricing,
    '@/lib/platform/db': { getSql: () => { throw new Error('Application DB forbidden in offline tests'); } },
    '@/lib/payu/orders': {
      findActiveReservationForUser: async () => null,
      getOrderByTxnid: async () => { throw new Error('Unexpected order read'); },
      createOrder: async (params) => { creates++; capturedCart = params.cartItems; throw creationError || new Error('Unexpected order creation'); },
    },
    '@/lib/user-auth': { getUserSession: async () => session },
    '@/lib/account/addresses': { getCustomerAddress: async (...args) => { addressReads.push(args); return saved; } },
    '@/lib/platform/api-guard': { assertSameOrigin: () => null },
    '@/lib/storefront/maintenance-guard': { requireStorefrontOpen: async () => null },
    '@/lib/payu/rate-limit': { checkRateLimit: () => ({ allowed: true }) },
    '@/lib/store-admin/customer-settings': { readCustomerSettings: async () => ({ guest_checkout: 'on' }) },
    '@/lib/checkout/settings': { readCheckoutConfiguration: async () => ({ ok: true, settings: { payu_enabled: 'on' } }) },
    '@/lib/payu/config': {
      checkPayUConfiguration: () => paymentConfigured ? { ok: true, appBaseUrl: 'https://fixture.invalid' } : ({ ok: false, problem: { code: 'missing', message: 'Not configured', adminAction: 'Configure' } }),
      getPayUConfig: () => { if (!paymentConfigured) throw new Error('Unexpected gateway config'); return {}; },
      getPayUCallbackUrls: () => { if (!paymentConfigured) throw new Error('Unexpected callback config'); return {}; },
    },
    '@/lib/payu/hash': { generateRequestHash: () => { throw new Error('Unexpected hash'); } },
    '@/lib/notifications/order-context': { queueOrderEvent: () => { throw new Error('Unexpected notification'); } },
    '@/lib/store-admin/subscribers': { subscribeToNewsletter: () => { throw new Error('Unexpected subscription'); } },
    '@/lib/storefront/revalidate': { revalidateCatalog: () => { throw new Error('Unexpected cache mutation'); } },
  },
});
const { POST } = await jiti.import(path.resolve('src/app/api/payu/initiate/route.ts'));
const contact = { firstname: 'Asha', email: 'asha@example.test', phone: '+91 98765-43210' };
const address = { name: 'Asha Rao', phone: '9876543210', line1: '1 Main Road', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
async function invoke(overrides) {
  creates = 0; addressReads = []; saved = null; session = { userId: 'owner' };
  const body = { items: [{ id: 'charger', quantity: 1 }], customer: contact, shippingAddress: address, ...overrides };
  const response = await POST(new NextRequest('http://localhost/api/payu/initiate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal(creates, paymentConfigured ? 1 : 0);
  return { response, body: await response.json() };
}
for (const [field, value] of [['firstname', {}], ['email', null], ['phone', '123']]) {
  test(`real initiate rejects invalid contact ${field} before order creation`, async () => {
    const result = await invoke({ customer: { ...contact, [field]: value } });
    assert.equal(result.response.status, 400); assert.ok(result.body.fieldErrors[field]);
    assert.deepEqual(addressReads, []);
  });
}
for (const [field, value] of [['line1', ''], ['city', []], ['state', 'Unknown'], ['pincode', '012345'], ['pincode', '4110019']]) {
  test(`real initiate rejects invalid shipping ${field}=${JSON.stringify(value)} before creation`, async () => {
    const result = await invoke({ shippingAddress: { ...address, [field]: value } });
    assert.equal(result.response.status, 400); assert.ok(result.body.fieldErrors[field]);
  });
}
test('real initiate rejects an unavailable/foreign saved address using session ownership', async () => {
  const result = await invoke({ shippingAddressId: 'foreign-address' });
  assert.equal(result.response.status, 400);
  assert.deepEqual(addressReads, [['owner', 'foreign-address']]);
});
test('real initiate revalidates historical saved address rather than trusting its ID', async () => {
  creates = 0; addressReads = []; saved = { ...address, pincode: '012345' };
  const response = await POST(new NextRequest('http://localhost/api/payu/initiate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'charger', quantity: 1 }], customer: contact, shippingAddressId: 'legacy' }) }));
  const body = await response.json();
  assert.equal(response.status, 400); assert.equal(body.code, 'address_needs_correction');
  assert.ok(body.fieldErrors.pincode); assert.equal(creates, 0);
  assert.deepEqual(addressReads, [['owner', 'legacy']]);
});

for (const variantId of [false, 0, 12, {}, [], '', '   ', 'v'.repeat(257)]) {
  test(`real initiate rejects malformed variant ${JSON.stringify(variantId)} without order creation`, async () => {
    const result = await invoke({ items: [{ id: 'charger', variantId, quantity: 1 }] });
    assert.equal(result.response.status, 400);
    assert.deepEqual(addressReads, []);
  });
}
for (const variantId of [null, undefined, 'var_123abc', 'legacy-product-c-0-natural-titanium'.repeat(3)]) {
  test(`real initiate accepts absent/null or legacy text variant ${variantId}`, async () => {
    const result = await invoke({ items: [{ id: 'charger', variantId, quantity: 1 }] });
    // Passed validation, stopped at the injected unconfigured payment boundary.
    assert.equal(result.response.status, 503);
    assert.equal(result.body.code, 'payment_not_configured');
  });
}
test('real initiate bounds carts at 50 lines before order creation', async () => {
  const line = { id: 'charger', quantity: 1 };
  assert.equal((await invoke({ items: Array.from({ length: 51 }, () => line) })).response.status, 400);
  assert.equal((await invoke({ items: Array.from({ length: 50 }, () => line) })).response.status, 503);
});
for (const couponCode of [undefined, 'SAVE10']) {
  test(`selection lookup conflict precedes coupon fallback (${couponCode ?? 'no coupon'})`, async () => {
    paymentConfigured = true;
    creationError = new pricing.SelectionUnavailableError('charger', 'legacy-exact');
    try {
      const result = await invoke({ items: [{ id: 'charger', variantId: 'legacy-exact', quantity: 1 }], couponCode });
      assert.equal(result.response.status, 409);
      assert.equal(result.body.code, 'selection_unavailable');
      assert.deepEqual(result.body.selection, { id: 'charger', variantId: 'legacy-exact' });
      assert.equal(capturedCart[0].variantId, 'legacy-exact');
      assert.ok(JSON.stringify(result.body).length < 512);
    } finally { paymentConfigured = false; creationError = null; }
  });
  test(`infrastructure error never masquerades as selection conflict (${couponCode ?? 'no coupon'})`, async () => {
    paymentConfigured = true;
    creationError = new Error('synthetic infrastructure failure');
    try {
      const result = await invoke({ couponCode });
      assert.equal(result.response.status, couponCode ? 409 : 500);
      assert.equal(result.body.code, couponCode ? 'coupon_unavailable' : undefined);
      assert.equal(result.body.selection, undefined);
      assert.doesNotMatch(JSON.stringify(result.body), /synthetic infrastructure failure/);
    } finally { paymentConfigured = false; creationError = null; }
  });
}

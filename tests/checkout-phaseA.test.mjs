import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = path.resolve('.');
const src = file => readFile(path.join(root, 'src', file), 'utf8');
const jiti = createJiti(import.meta.url, { moduleCache: false, jsx: { runtime: 'automatic' }, alias: { '@': path.join(root, 'src') }, virtualModules: {
  '@/lib/cart/CartContext': { useCart: () => ({ items: [], removeItem() {}, syncPrices() {}, isHydrated: true }) },
  '@/lib/checkout/useCheckoutRefresh': { useCheckoutRefresh() {} },
  '@/lib/storefront/use-availability': { verifyAvailabilityLines: async () => true },
  '@/lib/cart/useCoupon': { useCoupon: () => ({ totals: { subtotalPaise: 129900, discountPaise: 0, shippingPaise: 0, totalPaise: 129900 }, input: '', applied: null, busy: false }) },
  '@/components/cart/CouponBox': { CouponBox: () => createElement('div', null, 'Coupon box') },
} });
const { CheckoutForm } = await jiti.import(path.join(root, 'src/components/checkout/CheckoutForm.tsx'));
function render() { return renderToStaticMarkup(createElement(CheckoutForm, {
  initialItems: [{ id: 'charger', productId: 'charger', name: 'Charger', variantId: 'usb', variantLabel: 'USB-C 30W', image: '/sample.png', price: 1299, quantity: 1 }],
  productIdFromQuery: 'charger', initialProducts: [{ id: 'charger', name: 'Charger', inventoryMode: 'variant', pricePaise: 129900, inStock: true, purchasableVariants: [{ id: 'usb', label: 'USB-C 30W', pricePaise: 129900, inStock: true }] }],
  shippingPolicy: { enabled: true, chargePaise: 0, freeShippingThresholdPaise: null }, couponsEnabled: true,
})); }
test('checkout markup has left summary/right form grid and mobile accessible disclosure', () => {
  const html = render();
  assert.match(html, /lg:grid-cols-2/);
  assert.ok(html.indexOf('aria-label="Order summary"') < html.indexOf('<form'));
  assert.match(html, /aria-expanded="false" aria-controls="checkout-summary-details"/);
  assert.match(html, /id="checkout-summary-details" class="hidden pt-4 lg:block/);
  assert.match(html, /USB-C 30W/);
  assert.match(html, /width="48" height="48"/);
  assert.match(html, /Pay Rs 1,299/);
  assert.ok(!/PayU/i.test(html));
});
test('every checkout field has an associated label and state dropdown has all Indian regions', () => {
  const html = render();
  for (const field of ['firstname', 'email', 'phone', 'line1', 'line2', 'city', 'state', 'pincode']) {
    assert.ok(html.includes(`for="checkout-${field}"`), field);
    assert.ok(html.includes(`id="checkout-${field}"`), field);
  }
  assert.match(html, /<select[^>]+id="checkout-state"/);
  assert.match(html, /Lakshadweep/); assert.match(html, /Ladakh/);
  assert.ok(!html.includes('Full name'));
  assert.ok(!html.includes('maxLength="10"'));
});
test('cart aliases and shared footer have neutral checkout branding', async () => {
  const cart = await src('components/cart/CartPageView.tsx');
  assert.ok(!/PayU/i.test(cart));
  assert.match(cart, /<span>Checkout<\/span>/);
  assert.match(cart, /href="\/checkout"/);
  assert.ok(!/['"]PayU['"]/.test(await src('components/footer/GadzioFooter.tsx')));
  for (const route of ['cart', 'bag']) assert.match(await src(`app/${route}/page.tsx`), /guestCheckoutEnabled=\{customerSettings.guest_checkout === 'on'\}/);
});
test('checkout shell and direct buy preserve shared navigation, footer and image', async () => {
  const page = await src('app/checkout/page.tsx');
  assert.match(page, /<GlobalNav bannerVisible=\{false\}/); assert.match(page, /<GlobalFooter/);
  // Buy Now shows the chosen colour's photo when it has one, else the product's.
  assert.match(page, /image: photos\[0\]\?\.url \?\? requestedProduct\.image/);
});
test('initiation shares browser validators and revalidates owned saved addresses before creation', async () => {
  const route = await src('app/api/payu/initiate/route.ts');
  assert.match(route, /validateCheckoutContact\(body.customer\)/);
  assert.match(route, /validateIndianAddress\(savedAddress\)/);
  assert.match(route, /validateIndianAddress\(body.shippingAddress\)/);
  assert.ok(route.indexOf('validateCheckoutContact(body.customer)') < route.indexOf('await createOrder('));
  assert.ok(!route.includes('sanitizeName'));
  assert.match(route, /fieldErrors: contact.errors/);
});
test('address saving retains successful IDs and checks ambiguous saves before inserting again', async () => {
  const form = await src('components/checkout/CheckoutForm.tsx');
  assert.match(form, /setSelectedAddressId\(shippingAddressId\)/);
  assert.match(form, /uncertainAddressSave.current/);
  assert.ok(form.indexOf('uncertainAddressSave.current)') < form.indexOf('method: \'POST\''));
  assert.match(form, /shippingAddress: shippingAddressId \? undefined : normalizedAddress/);
});

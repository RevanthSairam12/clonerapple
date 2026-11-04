// Real commerce client components, synthetic props/fetch/auth only. Never import from src.
import React, { useEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { CartProvider, useCart, type CartItemInput } from '@/lib/cart/CartContext';
import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { AccessoryDetailPage } from '@/components/sites/accessories/AccessoryDetailPage';
import { CartPageView } from '@/components/cart/CartPageView';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { BuyAgainRow } from '@/components/account/BuyAgainRow';
import { user, address } from './commerce-browser-fixture-mocks';

const photo = '/fixture-photo.svg';
const variants = ['Phone A / Blue', 'Phone B / Black'].map((label, index) => ({ id: `fixture-variant-${index}`, sku: `FIXTURE-${index}`, label,
  deviceModelId: `fixture-phone-${index}`, deviceModelName: index ? 'Phone B' : 'Phone A', optionName: 'Colour', optionValue: index ? 'Black' : 'Blue',
  combinationKey: `fixture-combination-${index}`, pricePaise: index ? 149900 : 129900, regularPricePaise: index ? 149900 : 129900, salePricePaise: null, onSale: false, inStock: true }));
export const products = ['case', 'accessory', 'shared'].map(kind => ({
  id: `fixture-${kind}`, slug: `fixture-${kind}`, name: `Fixture ${kind}`, subtitle: 'Synthetic product, never sold', price: 1299, pricePaise: 129900,
  priceDisplay: '₹1,299', regularPricePaise: 129900, regularPrice: undefined, salePricePaise: null, wasPriceDisplay: undefined, onSale: false,
  inventoryMode: kind === 'shared' ? 'product' : 'variant', purchasableVariants: kind === 'shared' ? [] : variants,
  inStock: true, image: photo, images: [photo], gallery: [photo], colors: [{ name: 'Blue', hex: '#0055cc' }, { name: 'Black', hex: '#111111' }],
  brand: 'Fixture', category: 'Synthetic accessories', categorySlug: 'fixture', categoryName: 'Synthetic accessories', keywords: [],
  material: 'Synthetic', compatibility: ['Phone A', 'Phone B'], inTheBox: ['Synthetic case'], specs: {}, description: 'Synthetic component fixture.',
  descriptionSections: [], highlights: [], features: [], href: `/shop/product/fixture-${kind}`,
}));
export const shippingPolicy = { enabled: false, chargePaise: 0, freeShippingThresholdPaise: null };
const reorderItems = products.slice(0, 1).map(product => ({ ...product, lastOrderedAt: new Date('2026-10-01T00:00:00.000Z') }));
export function cartInput(index = 0, variant = true): CartItemInput {
  const product = products[index];
  return { productId: product.id, name: product.name, image: photo, price: 1299, priceDisplay: '₹1,299', quantity: 1,
    ...(variant ? { variantId: variants[0].id, variantSku: variants[0].sku, variantLabel: variants[0].label, subtitle: variants[0].label } : {}), href: product.href };
}
function Probe() {
  const cart = useCart();
  const [result, setResult] = useState<unknown>(null);
  useEffect(() => {
    window.__commerceFixture.cart = { items: cart.items, totalCount: cart.totalCount, stockNotice: cart.stockNotice, isBagOpen: cart.isBagOpen };
    window.__commerceFixture.add = async (input: CartItemInput) => { const value = await cart.addItem(input); setResult(value); return value; };
    window.__commerceFixture.clear = cart.clearCart;
    if (cart.isHydrated) document.documentElement.dataset.hydrated = 'true';
  }, [cart]);
  return <aside className="fixture-probe" aria-label="Synthetic cart observer"><p>Bag units: <output data-testid="bag-count">{cart.totalCount}</output></p>
    <pre data-testid="bag-items">{JSON.stringify(cart.items)}</pre><pre data-testid="add-result">{JSON.stringify(result)}</pre>
    {cart.stockNotice && <p role="status">{cart.stockNotice}</p>}</aside>;
}
function Fixture({ mode }: { mode: string }) {
  const product = products[mode === 'accessory' ? 1 : mode === 'shared' ? 2 : 0];
  return <CartProvider><header className="fixture-banner">TEST ONLY · real commerce components · synthetic data/auth/fetch · no backend or payment</header><Probe />
    <div data-testid="surface">{mode === 'checkout' ? <CheckoutForm userSession={user} shippingPolicy={shippingPolicy} initialProducts={products as any} saleLive={false} couponsEnabled={false} />
      : mode === 'cart' ? <CartPageView initialProducts={products as any} shippingPolicy={shippingPolicy} saleLive={false} customerEmail={user.email} couponsEnabled={false} />
      : mode === 'buy-again' ? <BuyAgainRow items={reorderItems as any} saleLive={false} />
      : mode === 'accessory' ? <AccessoryDetailPage product={product as any} /> : <ProductDetailPage product={product as any} />}</div>
  </CartProvider>;
}
export function createFixture(search: string) { return <Fixture mode={new URLSearchParams(search).get('mode') || 'case'} />; }

function installSyntheticFetch() {
  const fixture = window.__commerceFixture;
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    fixture.requests.push({ url: url.pathname + url.search, method, body });
    if (url.origin !== window.location.origin) { fixture.unexpectedFetch.push(raw); throw new Error('Fixture blocked external fetch'); }
    const held = fixture.holdPath && url.pathname === fixture.holdPath;
    if (held) {
      fixture.pending++;
      await new Promise<void>(resolve => fixture.releases.push(resolve));
      fixture.pending--;
    }
    if (fixture.failurePath && url.pathname === fixture.failurePath) throw new TypeError('Synthetic network failure');
    if (url.pathname === '/api/catalog/summary' && method === 'GET') {
      const refs = JSON.parse(JSON.stringify(products));
      if (fixture.salePrice) for (const product of refs) {
        product.pricePaise = fixture.salePrice; product.regularPricePaise = 129900;
        for (const variant of product.purchasableVariants) { variant.pricePaise = fixture.salePrice; variant.regularPricePaise = 129900; variant.onSale = true; }
      }
      return respond({ source: 'db', saleLive: Boolean(fixture.salePrice), products: refs });
    }
    if (url.pathname === '/api/catalog/availability' && method === 'GET') {
      const lines = JSON.parse(url.searchParams.get('lines') || '[]');
      const demand = new Map<string, number>();
      for (const line of lines) { const key = JSON.stringify([line.productId, line.variantId || null]); demand.set(key, (demand.get(key) || 0) + line.quantity); }
      const rows = lines.map((line: any) => ({ id: line.productId, ...(line.variantId ? { variantId: line.variantId } : {}), inStock: true, low: false,
        quantityAvailable: Number.isSafeInteger(line.quantity) && line.quantity > 0 && (demand.get(JSON.stringify([line.productId, line.variantId || null])) || 0) <= fixture.capacity }));
      return respond({ saleLive: Boolean(fixture.salePrice), products: rows.filter((row: any) => !row.variantId), variants: rows.filter((row: any) => row.variantId) });
    }
    if (url.pathname === '/api/auth/me' && method === 'GET') return respond({ authenticated: true, user });
    if (url.pathname === '/api/account/addresses' && method === 'GET') return respond({ addresses: [address] });
    if (url.pathname === '/api/account/buy-again/fixture-case' && method === 'GET') return respond({ product: reorderItems[0] });
    // This endpoint is ONLY an in-memory conflict response, never a payment initiation.
    if (url.pathname === '/api/payu/initiate' && method === 'POST') {
      fixture.initiates.push(body);
      return respond({ success: false, code: 'selection_unavailable', selection: { id: body.items[0].id, variantId: body.items[0].variantId }, error: 'Synthetic selection unavailable.' }, 409);
    }
    fixture.unexpectedFetch.push(url.pathname + url.search);
    throw new Error(`Fixture blocked unexpected fetch: ${url.pathname}`);
  };
}
if (typeof window !== 'undefined') {
  window.__commerceFixture = { fixtureOnly: true, requests: [], unexpectedFetch: [], navigation: [], refreshes: 0, capacity: 1,
    failurePath: '', holdPath: '', pending: 0, releases: [], salePrice: 0, initiates: [], formSubmits: [], cart: null,
    release() { const pending = this.releases.splice(0); this.holdPath = ''; pending.forEach((resolve: () => void) => resolve()); } };
  // Defence in depth: even a production regression must never submit a gateway form.
  HTMLFormElement.prototype.submit = function () { window.__commerceFixture.formSubmits.push(this.action); throw new Error('Fixture blocked native payment form submit'); };
  document.addEventListener('submit', event => { const form = event.target as HTMLFormElement; if (form.action && new URL(form.action).origin !== location.origin) { event.preventDefault(); window.__commerceFixture.formSubmits.push(form.action); } }, true);
  installSyntheticFetch();
  hydrateRoot(document.getElementById('root')!, createFixture(window.location.search));
}
declare global { interface Window { __commerceFixture: any } }

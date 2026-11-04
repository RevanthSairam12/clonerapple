import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
function load(relative, mocks = {}, globals = {}) {
  const file = path.resolve(root, relative), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, console, URL, setTimeout() {}, ...globals, require(name) {
    if (name in mocks) return mocks[name];
    if (name === '@/lib/platform/db' || name === 'postgres') throw new Error('Offline boundary: database import');
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
      const resolved = ['.ts', '.tsx', ''].map(ext => base + ext).find(existsSync);
      return load(resolved, mocks, globals);
    }
    return require(name);
  } });
  return module.exports;
}
const line = { productId: 'p', quantity: 1 };
const product = { id: 'p', inventoryMode: 'product', pricePaise: 1000, inStock: true };
function fetchFixture({ products = [product], saleLive = false, available = true, source = 'db' } = {}) {
  const calls = [];
  return { calls, fetch: async url => {
    calls.push(url);
    if (url === '/api/catalog/summary?fresh=1') return { ok: true, json: async () => ({ products, saleLive, source }) };
    const lines = JSON.parse(new URL(url, 'https://offline.test').searchParams.get('lines'));
    return { ok: true, json: async () => ({ saleLive, products: lines.filter(l => !l.variantId).map(l => ({ id: l.productId, quantityAvailable: available })),
      variants: lines.filter(l => l.variantId).map(l => ({ id: l.productId, variantId: l.variantId, quantityAvailable: available })) }) };
  } };
}
function selection(fixture) { return load('src/lib/storefront/selection.ts', { react: {} }, { fetch: fixture.fetch }); }

test('fresh exact selection rejects foreign/missing variants without parent or sibling substitution', async () => {
  const f = fetchFixture({ products: [{ ...product, inventoryMode: 'variant', purchasableVariants: [{ id: 'v', pricePaise: 1200, inStock: true }] }] });
  const helper = selection(f);
  assert.equal((await helper.verifySelections([line])).status, 'unavailable');
  assert.equal((await helper.verifySelections([{ ...line, variantId: 'foreign' }])).status, 'unavailable');
  const result = await helper.verifySelections([{ ...line, variantId: 'v' }]);
  assert.equal(result.status, 'ready');
  assert.equal(result.prices[0].price, 12);
});
test('sale presentation never bypasses quantity validation and fallback never authorizes managed selection', async () => {
  const f = fetchFixture({ saleLive: true, available: false, products: [{ ...product, inStock: false }] });
  assert.equal((await selection(f).verifySelections([line])).status, 'unavailable');
  assert.equal(f.calls.length, 2);
  assert.equal((await selection(fetchFixture({ source: 'static' })).verifySelections([line])).status, 'verification_failed');
});
test('invalid prices, failed network, malformed envelopes and cancellation fail closed', async () => {
  assert.equal((await selection(fetchFixture({ products: [{ ...product, pricePaise: 10.1 }] })).verifySelections([line])).status, 'unavailable');
  assert.equal((await selection({ fetch: async () => { throw Error('offline'); } }).verifySelections([line])).status, 'verification_failed');
  assert.equal((await selection({ fetch: async () => ({ ok: true, json: async () => ({ products: null }) }) }).verifySelections([line])).status, 'verification_failed');
  const controller = new AbortController(); controller.abort();
  assert.equal((await selection(fetchFixture()).verifySelections([line], controller.signal)).status, 'stale');
});
test('fresh price review removes expired sale strike-throughs', async () => {
  const helper = selection(fetchFixture());
  const price = (await helper.verifySelections([line])).prices[0];
  assert.equal(helper.priceNeedsReview({ price: 8, regularPrice: 10 }, price), true);
  assert.equal(price.regularPrice, undefined);
  assert.equal(price.wasPriceDisplay, undefined);
  assert.equal(helper.priceNeedsReview(price, price), false);
});

function cartHarness(verify) {
  const slots = []; let cursor = 0;
  const react = { createContext: () => ({ Provider: 'provider' }), useContext() {}, useEffect() {},
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo: fn => fn(), useCallback: fn => fn,
  };
  const helper = selection(fetchFixture());
  const { CartProvider } = load('src/lib/cart/CartContext.tsx', { react,
    '@/lib/storefront/selection': { ...helper, verifySelections: verify },
    '@/lib/storefront/use-availability': { verifyAvailabilityLines: async () => true },
  });
  return () => { cursor = 0; return CartProvider({ children: null }).props.value; };
}
const input = { productId: 'p', name: 'P', price: 10, image: '', quantity: 1 };
const ready = lines => ({ status: 'ready', prices: lines.map(() => ({ price: 10, priceDisplay: '₹10' })) });

test('repeated additions validate prospective cumulative demand and reject without opening or changing bag', async () => {
  const requests = [];
  const render = cartHarness(async lines => { requests.push(lines); return lines.reduce((sum, l) => sum + l.quantity, 0) <= 2 ? ready(lines) : { status: 'unavailable', message: 'Not enough stock' }; });
  assert.equal((await render().addItem({ ...input, color: 'Blue' })).status, 'added');
  assert.equal((await render().addItem({ ...input, color: 'Red' })).status, 'added');
  render().setIsBagOpen(false);
  assert.equal((await render().addItem({ ...input, color: 'Blue' })).status, 'unavailable');
  assert.equal(requests[2].length, 2);
  assert.equal(requests[2].find(l => l.quantity === 2).productId, 'p');
  assert.equal(render().totalCount, 2);
  assert.equal(render().isBagOpen, false);
});
test('invalid and overflowing additions never reach verification', async () => {
  let calls = 0; const render = cartHarness(async lines => { calls++; return ready(lines); });
  for (const quantity of [0, -1, 1.5, 51, NaN]) assert.equal((await render().addItem({ ...input, quantity })).status, 'invalid_quantity');
  assert.equal(calls, 0);
  assert.equal((await render().addItem({ ...input, quantity: 50 })).status, 'added');
  assert.equal((await render().addItem(input)).status, 'invalid_quantity');
  assert.equal(calls, 1);
});
test('price changes require explicit reviewed second action; no false success or line insertion', async () => {
  const render = cartHarness(async lines => ({ status: 'ready', prices: lines.map(() => ({ price: 12, priceDisplay: '₹12' })) }));
  const result = await render().addItem(input);
  assert.equal(result.status, 'price_changed');
  assert.equal(render().items.length, 0);
  assert.equal(render().isBagOpen, false);
  assert.equal((await render().addItem({ ...input, ...result.price })).status, 'added');
  assert.equal(render().items[0].price, 12);
});
test('overlapping adds and intervening remove/clear/price sync invalidate stale completions', async () => {
  const pending = []; let defer = true;
  const render = cartHarness(lines => defer ? new Promise(resolve => pending.push(() => resolve(ready(lines)))) : Promise.resolve(ready(lines)));
  const first = render().addItem(input), second = render().addItem({ ...input, productId: 'other' });
  pending[0](); assert.equal((await first).status, 'stale');
  pending[1](); assert.equal((await second).status, 'added');
  for (const mutate of [ctx => ctx.removeItem(ctx.items[0].id), ctx => ctx.clearCart(), ctx => ctx.syncPrices([{ id: 'other', unitPaise: 1200 }])]) {
    defer = false; if (!render().items.length) await render().addItem({ ...input, productId: 'other' });
    defer = true;
    const add = render().addItem(input); const complete = pending.at(-1);
    mutate(render()); complete(); assert.equal((await add).status, 'stale');
  }
});
test('caller selection cancellation prevents commit after successful verification', async () => {
  let finish;
  const render = cartHarness(lines => new Promise(resolve => { finish = () => resolve(ready(lines)); }));
  const controller = new AbortController();
  const result = render().addItem(input, { signal: controller.signal });
  controller.abort(); finish();
  assert.equal((await result).status, 'stale');
  assert.equal(render().items.length, 0);
});

test('fresh summary has no-store and no fallback on authoritative failure; legacy response remains compatible', async () => {
  const json = (body, options) => ({ body, ...options });
  const route = load('src/app/api/catalog/summary/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/storefront/catalog': { getFreshStorefrontRefs: async () => { throw Error('unreadable'); }, getStorefrontRefs: async () => ({ products: [product] }) },
  });
  const failed = await route.GET(new Request('https://offline.test/api/catalog/summary?fresh=1'));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers['Cache-Control'], 'no-store');
  assert.equal((await route.GET()).body.products.length, 1);
  const fresh = load('src/app/api/catalog/summary/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/storefront/catalog': { getFreshStorefrontRefs: async () => ({ products: [product], source: 'db', saleLive: true }) },
  });
  const success = await fresh.GET(new Request('https://offline.test/api/catalog/summary?fresh=1'));
  assert.equal(success.body.source, 'db');
  assert.equal(success.body.saleLive, true);
  assert.equal(success.headers['Cache-Control'], 'no-store');
});

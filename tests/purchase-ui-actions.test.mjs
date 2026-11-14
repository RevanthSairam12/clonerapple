import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Execute the actual customer hook/components with a deterministic hook host.
// Imports are allowlisted; no application DB module or external fetch can load.
function host({ addItem = async () => ({ status: 'added' }), verifySelections = async () => ({ status: 'ready', prices: [{ price: 100 }] }), fetch: request = async () => { throw new Error('Unexpected fetch'); } } = {}) {
  const navigations = [];
  const slots = [], effects = [], timers = new Map(), cache = new Map();
  let cursor = 0, nextTimer = 0, tree;
  const react = {
    useState(initial) { const id = cursor++; if (!slots[id]) slots[id] = { value: initial }; return [slots[id].value, value => { slots[id].value = typeof value === 'function' ? value(slots[id].value) : value; }]; },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
    useEffect(fn, deps) { const id = cursor++, previous = slots[id]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { slots[id] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[id].cleanup?.(); slots[id].cleanup = fn(); }); } },
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } }; },
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(root, relative), module = { exports: {} };
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, React: react, AbortController, URL, URLSearchParams,
      window: { scrollY: 0, addEventListener() {}, removeEventListener() {},
        location: { href: 'http://localhost/shop/product/p' }, history: { replaceState() {} },
        Image: function () { this.src = ''; } },
      setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); }, fetch: request,
      require(name) {
        if (name === 'react') return react;
        if (name === 'next/link') return { __esModule: true, default: 'a' };
        if (name === 'next/navigation') return { useRouter: () => ({ push: url => navigations.push(url) }) };
        if (name === '@/lib/cart/CartContext') return { useCart: () => ({ addItem, items: [] }) };
        if (name === '@/lib/storefront/use-availability') return { useAvailability: () => ({ blocked: false }) };
        // The real selector's contract: a model key (or null) plus a colour key.
        // Driving it by variant id keeps the fixture readable while still
        // exercising the page's exact-row resolution.
        if (name === '@/components/shop/OptionSelector') return { OptionSelector: props => react.createElement('select', {
          'data-variant-picker': true, onChange: event => {
            const chosen = props.variants.find(entry => entry.id === event.target.value);
            if (!chosen) return;
            props.onChange({ modelKey: chosen.deviceModelId ?? null, colourKey: chosen.colourId ?? null });
          } }) };
        if (name === '@/components/cart/FreeGiftCartWidgets') return { ProductPageFreeGiftStrip: () => null };
        if (name === '@/components/shop/ProductDescriptionSections') return { ProductDescriptionSections: () => null };
        if (name === '@/components/shop/DeliveryOptionsModal') return { DeliveryOptionsModal: () => null };
        if (name.endsWith('/GlobalNav')) return { GlobalNav: () => null };
        if (name.endsWith('/GlobalFooter')) return { GlobalFooter: () => null };
        if (name.endsWith('/GadzioTrustBar')) return { GadzioTrustBar: () => null };
        if (name === '@/lib/storefront/use-purchase-action') return load('src/lib/storefront/use-purchase-action.ts');
        if (name === '@/lib/storefront/selection') return { verifySelections, priceNeedsReview: (a, b) => a.price !== b.price || a.regularPrice !== b.regularPrice };
        if (name === '@/lib/storefront/availability-rules' || name === './availability-rules') return { STOCK_NOT_AVAILABLE: 'Stock not available', stockBlocked: (stock, sale) => !stock && !sale };
        if (name === '@/lib/storefront/option-selection') return load('src/lib/storefront/option-selection.ts');
        if (name === '@/lib/utils') return { formatINR: value => `₹${value}` };
        throw new Error(`Blocked application/backend import: ${name}`);
      } });
    cache.set(relative, module.exports);
    return module.exports;
  }
  function expand(node) { if (node == null || typeof node !== 'object') return node; if (typeof node.type === 'function') return expand(node.type(node.props)); return { ...node, props: { ...node.props, children: (node.props.children ?? []).map(expand) } }; }
  const nodes = node => node && typeof node === 'object' ? [node, ...(node.props.children ?? []).flatMap(nodes)] : [];
  return { load, navigations, render(Component, props, flush = true) { cursor = 0; tree = expand(Component(props)); if (flush) this.flush(); return tree; },
    flush() { while (effects.length) effects.shift()(); }, nodes() { return nodes(tree); }, unmount() { for (const slot of slots) slot?.cleanup?.(); },
    text() { const content = node => node == null ? '' : typeof node !== 'object' ? String(node) : (node.props.children ?? []).map(content).join(' '); return content(tree); },
  };
}
const event = { preventDefault() {}, stopPropagation() {} };
const product = { id: 'p', name: 'Case', subtitle: 'Shared', price: 100, priceDisplay: '₹100', image: '/case.png', href: '/shop/product/p', colors: [], compatibility: ['Phone A', 'Phone B'], inventoryMode: 'product' };
const cards = [
  ['src/components/collection/CollectionProductCard.tsx', 'CollectionProductCard'],
  ['src/components/collection/CollectionFeaturedTile.tsx', 'CollectionFeaturedTile'],
  ['src/components/sites/accessories/AccessoryProductCard.tsx', 'AccessoryProductCard'],
  ['src/components/sites/cases-protection/ProductCard.tsx', 'ProductCard'],
];
for (const [file, name] of cards) test(`${name}: pending, price review, explicit retry and committed success`, async () => {
  const first = deferred(), calls = [];
  const ui = host({ addItem: async input => { calls.push(input); return calls.length === 1 ? first.promise : { status: 'added' }; } });
  const Component = ui.load(file)[name], props = { product };
  ui.render(Component, props);
  const press = () => ui.nodes().find(node => node.type === 'button' && node.props.onClick)?.props.onClick(event);
  const pending = press();
  ui.render(Component, props);
  assert.equal(ui.nodes().find(node => node.type === 'button').props.disabled, true);
  await press();
  assert.equal(calls.length, 1, 'duplicate press does not start another purchase');
  first.resolve({ status: 'price_changed', price: { price: 80, priceDisplay: '₹80', regularPrice: 100, wasPriceDisplay: '₹100' }, message: 'Price changed.' });
  await pending;
  ui.render(Component, props);
  assert.match(ui.text(), /₹80/);
  assert.match(ui.text(), /press again/);
  assert.doesNotMatch(ui.text(), /Added/);
  assert.equal(calls.length, 1, 'a changed price never blindly replays');
  await press();
  ui.render(Component, props);
  assert.equal(calls[1].price, 80);
  assert.equal(calls[1].regularPrice, 100);
  assert.equal(calls[1].model, undefined, 'shared compatibility never selects a stock identity');
  assert.match(ui.text(), /Added/);
  ui.unmount();
});

for (const [file, name] of [
  ['src/components/shop/ProductDetailPage.tsx', 'ProductDetailPage'],
  ['src/components/sites/accessories/AccessoryDetailPage.tsx', 'AccessoryDetailPage'],
]) test(`${name}: exact variant Add and Buy Now fail closed and require explicit price-review retry`, async () => {
  const adds = [], checks = [];
  let result = { status: 'unavailable', message: 'Exact option unavailable' };
  const ui = host({
    addItem: async input => { adds.push(input); return { status: 'unavailable', message: 'Exact option unavailable' }; },
    verifySelections: async (lines, signal) => { checks.push({ lines, signal }); return result; },
  });
  // Two colours under one model: no row is chosen until the customer picks a
  // colour, so the first Add/Buy must refuse rather than substitute a sibling.
  const detail = { ...product, inventoryMode: 'variant', images: [], inTheBox: [], specs: {}, features: [], highlights: [],
    purchasableVariants: [
      { id: 'exact', sku: 'EXACT', label: 'Phone / Blue', deviceModelId: 'phone-model', deviceModelName: 'Phone',
        colourId: 'blue', colourName: 'Blue', colourHex: '#0071E3', pricePaise: 10000, regularPricePaise: 10000, inStock: true },
      { id: 'sibling', sku: 'SIBLING', label: 'Phone / Red', deviceModelId: 'phone-model', deviceModelName: 'Phone',
        colourId: 'red', colourName: 'Red', colourHex: '#FF3B30', pricePaise: 12000, regularPricePaise: 12000, inStock: true },
    ] };
  const Component = ui.load(file)[name], props = { product: detail, saleLive: true };
  const render = () => ui.render(Component, props);
  const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : (node.props.children ?? []).map(text).join(' ');
  const buy = () => ui.nodes().find(node => node.type === 'button' && text(node).trim() === 'Buy Now').props.onClick();
  const add = () => ui.nodes().find(node => node.type === 'button' && /Add to Bag/.test(text(node))).props.onClick();
  render();
  await buy(); await add(); render();
  assert.equal(checks.length, 0); assert.equal(adds.length, 0);
  assert.match(ui.text(), /Choose your model and colour/);
  ui.nodes().find(node => node.props['data-variant-picker']).props.onChange({ target: { value: 'exact' } }); render();
  await add(); render();
  assert.equal(adds[0].variantId, 'exact'); assert.equal(adds[0].variantSku, 'EXACT');
  assert.match(ui.text(), /Out of stock for this option/);
  await buy(); render();
  assert.equal(checks[0].lines[0].variantId, 'exact'); assert.equal(checks[0].lines[0].quantity, 1);
  assert.equal(ui.navigations.length, 0, 'sale display cannot bypass exact-stock refusal');
  result = { status: 'ready', prices: [{ price: 120, priceDisplay: '₹120' }] };
  await buy(); render();
  assert.equal(ui.navigations.length, 0, 'price change never auto-navigates');
  assert.match(ui.text(), /press again/);
  await buy(); render();
  assert.equal(ui.navigations.length, 1);
  assert.match(ui.navigations[0], /variantId=exact/);
  ui.unmount();
});

test('selection changes synchronously abort before effects; late success cannot announce or navigate', async () => {
  const ui = host(), { usePurchaseAction } = ui.load('src/lib/storefront/use-purchase-action.ts');
  let action;
  function Probe({ id }) { action = usePurchaseAction(id); return null; }
  ui.render(Probe, { id: 'v1' });
  const wait = deferred(); let signal, navigations = 0;
  const running = action.run(s => { signal = s; return wait.promise; }, () => navigations++);
  ui.render(Probe, { id: 'v2' }, false);
  assert.equal(signal.aborted, true, 'abort precedes passive effect cleanup');
  wait.resolve({ status: 'added' }); await running;
  ui.flush(); ui.render(Probe, { id: 'v2' });
  assert.equal(action.added, false); assert.equal(navigations, 0); assert.equal(action.notice, null);
  const unmounted = deferred();
  const pending = action.run(s => { signal = s; return unmounted.promise; });
  ui.unmount(); assert.equal(signal.aborted, true);
  unmounted.resolve({ status: 'added' }); await pending;
});

test('all rejected add statuses and thrown verification errors leave success off', async () => {
  const ui = host(), { usePurchaseAction } = ui.load('src/lib/storefront/use-purchase-action.ts'); let action;
  function Probe() { action = usePurchaseAction('p'); return null; }
  for (const status of ['unavailable', 'verification_failed', 'invalid_quantity', 'stale']) {
    ui.render(Probe, {}); await action.run(async () => ({ status, message: status })); ui.render(Probe, {});
    assert.equal(action.added, false); assert.equal(action.pending, false); assert.equal(action.notice, status);
  }
  await action.run(async () => { throw new Error('network'); }); ui.render(Probe, {});
  assert.equal(action.added, false); assert.match(action.notice, /Could not verify/); ui.unmount();
});

test('BuyAgain: variant link and refreshed mode never add a parent; changed price requires another press', async () => {
  const item = { ...product, pricePaise: 10000, regularPricePaise: 10000, onSale: false, inStock: true, lastOrderedAt: new Date() };
  let current = { ...item }, calls = 0, requests = 0;
  const ui = host({ addItem: async () => { calls++; return { status: 'added' }; }, fetch: async () => { requests++; return { ok: true, json: async () => ({ product: current }) }; } });
  const Component = ui.load('src/components/account/BuyAgainRow.tsx').BuyAgainRow;
  ui.render(Component, { items: [{ ...item, inventoryMode: 'variant' }], saleLive: false });
  assert.match(ui.text(), /Choose options/); assert.equal(ui.nodes().some(n => n.type === 'button'), false); assert.equal(requests, 0);
  ui.render(Component, { items: [item], saleLive: false });
  current = { ...item, inventoryMode: 'variant' };
  await ui.nodes().find(n => n.type === 'button').props.onClick();
  ui.render(Component, { items: [item], saleLive: false }); assert.match(ui.text(), /Choose options/); assert.equal(calls, 0);
  ui.unmount();
  const priceUi = host({ addItem: async input => { calls++; assert.equal(input.price, 80); return { status: 'added' }; }, fetch: async () => ({ ok: true, json: async () => ({ product: { ...item, pricePaise: 8000, priceDisplay: '₹80' } }) }) });
  const PriceCard = priceUi.load('src/components/account/BuyAgainRow.tsx').BuyAgainRow;
  priceUi.render(PriceCard, { items: [item], saleLive: false });
  await priceUi.nodes().find(n => n.type === 'button').props.onClick();
  priceUi.render(PriceCard, { items: [item], saleLive: false }); assert.match(priceUi.text(), /₹80/); assert.equal(calls, 0);
  await priceUi.nodes().find(n => n.type === 'button').props.onClick();
  priceUi.render(PriceCard, { items: [item], saleLive: false }); assert.match(priceUi.text(), /Added/); assert.equal(calls, 1); priceUi.unmount();
});

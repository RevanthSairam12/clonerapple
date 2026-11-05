/**
 * Phase 4 — category filters that use the same option data as the product page.
 *
 * Pure rules run through jiti against the TypeScript the app ships. The card
 * test executes the real component in a small hook host so the sold-out mark
 * and the colour photo are checked on rendered output, not on a re-implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const filters = await jiti.import(path.join(root, 'src/lib/storefront/category-filters.ts'));
const low = await jiti.import(path.join(root, 'src/lib/catalog/storefront.ts'));
const merge = await jiti.import(path.join(root, 'src/lib/storefront/catalog-merge.ts'));
const client = await jiti.import(path.join(root, 'src/lib/catalog/client-catalog.ts'));
const search = await jiti.import(path.join(root, 'src/lib/search/searchService.ts'));

const read = (file) => readFileSync(path.join(root, file), 'utf8');
const EMPTY = { models: [], colours: [], prices: [] };

const variant = (overrides = {}) => ({
  id: 'v1',
  sku: 'SKU-1',
  label: 'iPhone 17 • Colour: Red',
  deviceModelId: 'm17',
  deviceModelName: 'iPhone 17',
  deviceModelBrandId: 'apple',
  deviceModelBrandName: 'Apple',
  deviceModelEligible: true,
  optionName: 'Colour',
  optionValue: 'Red',
  combinationKey: 'm17-red',
  colourId: 'red',
  colourName: 'Red',
  colourHex: '#FF3B30',
  pricePaise: 100000,
  regularPricePaise: 100000,
  salePricePaise: null,
  onSale: false,
  inStock: true,
  ...overrides,
});

const product = (overrides = {}) => ({
  id: 'p17',
  name: 'MagPulse Case',
  subtitle: '',
  price: 900,
  priceDisplay: '₹900.00',
  image: '/default.jpg',
  images: ['/default.jpg'],
  colors: [],
  compatibility: [],
  material: '',
  brand: 'Gadzio',
  facets: {},
  features: [],
  description: '',
  inStock: true,
  href: '/shop/product/p17',
  inventoryMode: 'variant',
  purchasableVariants: [
    variant(),
    variant({ id: 'v2', colourId: 'black', colourName: 'Black', colourHex: '#1D1D1F', pricePaise: 120000, regularPricePaise: 120000, combinationKey: 'm17-black' }),
    variant({ id: 'v3', deviceModelId: 'm16', deviceModelName: 'iPhone 16', pricePaise: 90000, regularPricePaise: 90000, combinationKey: 'm16-red' }),
  ],
  ...overrides,
});

const shared = () => product({
  id: 'shared',
  name: 'Shared Stock Case',
  price: 5000,
  priceDisplay: '₹5,000.00',
  inventoryMode: 'product',
  purchasableVariants: [],
  compatibility: ['iPhone 17', 'iPhone 16'],
  compatibilityModels: [
    { id: 'm17', name: 'iPhone 17', brandId: 'apple', brandName: 'Apple' },
    { id: 'm16', name: 'iPhone 16', brandId: 'apple', brandName: 'Apple' },
  ],
});

const legacy = () => product({
  id: 'legacy',
  name: 'Saved model case',
  price: 4000,
  inventoryMode: 'variant',
  purchasableVariants: [
    variant({ id: 'old', deviceModelId: 'm4', deviceModelName: 'iPhone 4', deviceModelEligible: false, pricePaise: 400000 }),
  ],
});

const category = () => [product(), shared(), legacy()];

/* ------------------------------------------------------------------ facets */

test('filter values exist only in this category, grouped by brand, with counts', () => {
  const options = filters.buildCategoryFilterOptions(category(), EMPTY);
  const apple = options.models.find((group) => group.brand === 'Apple');
  assert.ok(apple, 'models are grouped under their brand');
  const counts = Object.fromEntries(apple.options.map((option) => [option.name, option.count]));
  assert.deepEqual(counts, { 'iPhone 16': 2, 'iPhone 17': 2 }, 'option products and shared-stock products both count');
  assert.equal(apple.options.some((option) => option.name === 'iPhone 4'), false, 'a deactivated model is never a value');
  assert.deepEqual(options.colours.map((colour) => [colour.name, colour.count]), [['Black', 1], ['Red', 1]]);
  assert.equal(options.colours.every((colour) => /^#[0-9A-F]{6}$/.test(colour.hex)), true);
  assert.deepEqual(options.prices.map((band) => [band.id, band.count]), [
    ['under-1000', 1],
    ['2500-4999', 1],
    ['5000-plus', 1],
  ]);
});

test('choosing a model narrows products and the colour list to that choice', () => {
  const selection = { models: ['m17'], colours: [], prices: [] };
  const visible = filters.filterCategoryProducts(category(), selection).map((entry) => entry.id);
  assert.deepEqual(visible, ['p17', 'shared']);

  const options = filters.buildCategoryFilterOptions(category(), selection);
  assert.deepEqual(options.colours.map((colour) => colour.name), ['Black', 'Red'], 'only colours that exist for iPhone 17');
  assert.deepEqual(options.colours.map((colour) => colour.count), [1, 1]);
  assert.deepEqual(options.models.flatMap((group) => group.options.map((option) => option.name)), ['iPhone 16', 'iPhone 17']);
});

test('filters combine: OR within a filter, AND across filters', () => {
  assert.deepEqual(
    filters.filterCategoryProducts(category(), { models: ['m17'], colours: ['red'], prices: [] }).map((entry) => entry.id),
    ['p17'],
    'a shared-stock product has no colour options, so a colour choice excludes it',
  );
  assert.deepEqual(
    filters.filterCategoryProducts(category(), { models: ['m17', 'm16'], colours: [], prices: [] }).map((entry) => entry.id),
    ['p17', 'shared'],
  );
  assert.deepEqual(
    filters.filterCategoryProducts(category(), { models: [], colours: [], prices: ['2500-4999'] }).map((entry) => entry.id),
    ['legacy'],
    'the legacy product uses its own price',
  );
});

test('the price filter uses the chosen option price, not the cheapest sibling', () => {
  // iPhone 17 / Black is 120.00, so a 1000-2499 choice must match even though
  // the card's unpriced headline is 90.00.
  const selection = { models: ['m17'], colours: ['black'], prices: ['1000-2499'] };
  assert.deepEqual(filters.filterCategoryProducts(category(), selection).map((entry) => entry.id), ['p17']);
  const bands = filters.buildCategoryFilterOptions(category(), { models: ['m17'], colours: ['black'], prices: [] });
  assert.deepEqual(bands.prices.map((band) => band.id), ['1000-2499']);
  assert.equal(filters.candidatePricePaise(product(), selection), 120000);
});

test('a selection can never surface a value the URL invented', () => {
  const parsed = filters.parseCategoryFilterSearch('?model=m17&model=retired-model&colour=red&price=under-1000');
  assert.deepEqual(parsed, { models: ['m17', 'retired-model'], colours: ['red'], prices: ['under-1000'] });
  assert.deepEqual(filters.sanitiseCategoryFilterSelection(category(), parsed), {
    models: ['m17'],
    colours: ['red'],
    prices: ['under-1000'],
  });
});

test('URL round trip keeps every value and a stable order', () => {
  const url = '?model=m17&model=m16&colour=red&price=2500-4999';
  const selection = filters.parseCategoryFilterSearch(url);
  assert.equal(
    filters.categoryFilterQuery(selection),
    'model=m17&model=m16&colour=red&price=2500-4999',
  );
  assert.equal(filters.filterSelectionIsEmpty(EMPTY), true);
  assert.equal(filters.filterSelectionIsEmpty(selection), false);
});

/* ------------------------------------------------------------------- cards */

test('a sold-out match is marked only in normal mode; the card shows the chosen row price', () => {
  const sold = product({
    purchasableVariants: [
      variant({ inStock: false }),
      variant({ id: 'v2', colourId: 'black', colourName: 'Black', pricePaise: 120000, regularPricePaise: 120000 }),
    ],
  });
  const redCard = filters.cardForFilterSelection(sold, { models: ['m17'], colours: ['red'], prices: [] });
  assert.equal(redCard.inStock, false);
  assert.equal(redCard.priceDisplay, '₹1,000.00');

  const blackCard = filters.cardForFilterSelection(sold, { models: ['m17'], colours: ['black'], prices: [] });
  assert.equal(blackCard.inStock, true, 'a sibling option in stock keeps the match listed');
  assert.equal(blackCard.priceDisplay, '₹1,200.00', 'the chosen colour prices the card');
});

test('with a colour filter active the card uses that colour photo when one exists', () => {
  const photographed = product({
    photoColours: [
      { url: '/red.jpg', alt: 'Red case', colourId: 'red', role: 'primary', sortOrder: 0 },
      { url: '/black.jpg', alt: 'Black case', colourId: 'black', role: 'primary', sortOrder: 0 },
      { url: '/red-hover.jpg', alt: '', colourId: 'red', role: 'hover', sortOrder: 1 },
    ],
  });
  assert.equal(filters.photoForColour(photographed.photoColours, 'red'), '/red.jpg');
  assert.equal(
    filters.cardForFilterSelection(photographed, { models: [], colours: ['black'], prices: [] }).image,
    '/black.jpg',
  );
  assert.equal(
    filters.cardForFilterSelection(product(), { models: [], colours: ['red'], prices: [] }).image,
    '/default.jpg',
    'a colour without photos keeps the default gallery',
  );
});

function renderCard(props) {
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) { const id = cursor++; if (!slots[id]) slots[id] = { value: initial }; return [slots[id].value, (value) => { slots[id].value = typeof value === 'function' ? value(slots[id].value) : value; }]; },
    useEffect() {},
    createElement(type, props2, ...children) { return { type, props: { ...props2, children: children.flat(Infinity) } }; },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(read('src/components/collection/CollectionProductCard.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, React: react, URL, AbortController,
    window: { location: { href: 'http://localhost/c' }, history: { replaceState() {} } },
    require(name) {
      if (name === 'react') return react;
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === '@/lib/cart/CartContext') return { useCart: () => ({ addItem: async () => ({ status: 'added' }) }) };
      if (name === '@/lib/storefront/use-purchase-action') return { usePurchaseAction: () => ({ added: false, pending: false, notice: null, priceOverride: null, run: async () => {} }) };
      if (name === '@/lib/utils') return { formatINR: (value) => `₹${value}` };
      if (name === '@/lib/storefront/availability-rules') return { STOCK_NOT_AVAILABLE: 'Stock not available' };
      throw new Error(`Blocked import: ${name}`);
    } });
  const expand = (node) => node && typeof node === 'object'
    ? (typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: (node.props.children ?? []).map(expand) } })
    : node;
  const tree = expand(module.exports.CollectionProductCard(props));
  const text = (value) => value == null ? '' : typeof value !== 'object' ? String(value) : (value.props.children ?? []).map(text).join(' ');
  return text(tree);
}

test('the rendered card shows Stock not available in normal mode and never in sale mode', () => {
  const card = filters.cardForFilterSelection(
    product({ purchasableVariants: [variant({ inStock: false })] }),
    { models: ['m17'], colours: ['red'], prices: [] },
  );
  assert.match(renderCard({ product: card, saleLive: false }), /Stock not available/);
  assert.doesNotMatch(renderCard({ product: card, saleLive: true }), /Stock not available/);
});

/* --------------------------------------------------- category page in a URL */

function pageHost({ search = '' } = {}) {
  const slots = [];
  const writes = [];
  let cursor = 0;
  const react = {
    useState(initial) { const id = cursor++; if (!slots[id]) slots[id] = { value: initial }; return [slots[id].value, (value) => { slots[id].value = typeof value === 'function' ? value(slots[id].value) : value; }]; },
    useRef(initial) { const id = cursor++; if (!slots[id]) slots[id] = { current: initial }; return slots[id]; },
    useMemo(fn) { return fn(); },
    useEffect(fn) { fn(); },
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } }; },
  };
  const cache = new Map();
  const relative = {
    './CollectionProductGrid': 'src/components/collection/CollectionProductGrid.tsx',
    './CollectionProductCard': 'src/components/collection/CollectionProductCard.tsx',
    './CollectionFilters': 'src/components/collection/CollectionFilters.tsx',
    './CollectionPagination': 'src/components/collection/CollectionPagination.tsx',
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(read(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, React: react, URL, URLSearchParams, AbortController,
      console: { warn() {} },
      window: {
        location: { search },
        history: { replaceState(_state, _title, url) { writes.push(url); } },
        addEventListener() {},
        removeEventListener() {},
      },
      require(name) {
        if (name === 'react') return react;
        if (name === 'next/link') return { __esModule: true, default: 'a' };
        if (name === 'next/navigation') return {
          useSearchParams: () => new URLSearchParams(search),
          usePathname: () => '/cat',
          useRouter: () => ({ push() {} }),
        };
        if (name === './collection.css') return {};
        if (relative[name]) return load(relative[name]);
        if (name === '@/lib/storefront/category-filters') return filters;
        if (name === '@/lib/storefront/option-selection') return { formatOptionPaise: () => '', normalizeHex: () => '' };
        if (name === '@/components/header/GadzioHeader') return { GadzioHeader: () => null };
        if (name === '@/components/trust/GadzioTrustBar') return { GadzioTrustBar: () => null };
        if (name.endsWith('/GlobalFooter')) return { GlobalFooter: () => null };
        if (name === '@/lib/whatsapp') return { WHATSAPP_ORDER_URL: '#' };
        if (name === '@/lib/cart/CartContext') return { useCart: () => ({ addItem: async () => ({ status: 'added' }) }) };
        if (name === '@/lib/storefront/use-purchase-action') return { usePurchaseAction: () => ({ added: false, pending: false, notice: null, priceOverride: null, run: async () => {} }) };
        if (name === '@/lib/utils') return { formatINR: (value) => `₹${value}` };
        if (name === '@/lib/storefront/availability-rules') return { STOCK_NOT_AVAILABLE: 'Stock not available' };
        throw new Error(`Blocked import: ${name}`);
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  }
  const expand = (node) => node && typeof node === 'object'
    ? (typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: (node.props.children ?? []).map(expand) } })
    : node;
  let tree = null;
  const text = (node) => node == null ? '' : typeof node !== 'object' ? String(node) : (node.props.children ?? []).map(text).join(' ');
  const nodes = (node) => node && typeof node === 'object' ? [node, ...(node.props.children ?? []).flatMap(nodes)] : [];
  return {
    load,
    writes,
    render(Component, props) { cursor = 0; tree = expand(Component(props)); return tree; },
    text() { return text(tree); },
    nodes() { return nodes(tree); },
  };
}

const CONFIG = {
  slug: 'cases-protection',
  title: 'Cases',
  subhead: '',
  breadcrumbLeaf: 'Cases',
  countNoun: 'products',
  categoryLinks: [],
  filters: [
    { id: 'model', label: 'Compatible With', options: ['iPhone 17'] },
    { id: 'material', label: 'Material', options: ['Silicone'] },
  ],
};

test('a shared category URL filters the grid and the filter lists before any click', () => {
  const page = pageHost({ search: '?model=m17' });
  const { CollectionPage } = page.load('src/components/collection/CollectionPage.tsx');
  page.render(CollectionPage, { config: CONFIG, products: category(), saleLive: false });

  const text = page.text();
  assert.match(text, /MagPulse Case/);
  assert.match(text, /Shared Stock Case/);
  assert.doesNotMatch(text, /Saved model case/, 'a product without the chosen model is not shown');
  assert.match(text, /Phone model/);
  assert.match(text, /iPhone 16/);
  assert.match(text, /iPhone 17/);
  assert.match(text, /Colour/);
  assert.match(text, /Price/);

  // The legacy "Compatible With" checkbox list is replaced by the model filter.
  assert.equal(page.nodes().some((node) => node.props?.id === 'filter-model'), false);

  // Choosing a colour updates the URL without a full navigation.
  const red = page.nodes().find((node) => node.props?.id === 'filter-colour-red');
  assert.ok(red, 'the colour filter renders an accessible checkbox');
  red.props.onChange();
  page.render(CollectionPage, { config: CONFIG, products: category(), saleLive: false });
  assert.equal(page.writes.at(-1), '/cat?model=m17&colour=red');
  assert.doesNotMatch(page.text(), /Shared Stock Case/, 'a colour choice excludes a product with no colour options');
});

/* ------------------------------------------------------------------ search */

function catalogLoad(overrides = {}) {
  return {
    categories: [{ id: 'c', slug: 'cases-protection', name: 'Cases' }],
    products: [{ id: 'p', category_id: 'c', name: 'MagPulse Case', price_paise: 10000, in_stock: true, brand: 'Gadzio', __category_slug: 'cases-protection' }],
    images: [], attributes: [],
    deviceModels: [{ product_id: 'p', id: 'm17', name: 'iPhone 17', brand_id: 'apple', brand_name: 'Apple', selection_eligible: true }],
    variants: [], variantColours: [], stock: [],
    ...overrides,
  };
}

test('typing a model name finds the product, and a deactivated model never does', () => {
  const active = low.snapshotFromLoad(catalogLoad()).products[0];
  const candidates = client.toSearchCandidates([merge.refFromDatabase(active)]);
  assert.equal(search.scoreProducts(candidates, 'iphone 17').totalMatches, 1);

  const inactive = low.snapshotFromLoad(catalogLoad({
    deviceModels: [{ product_id: 'p', id: 'm17', name: 'iPhone 17', brand_id: 'apple', brand_name: 'Apple', selection_eligible: false }],
  })).products[0];
  const hidden = client.toSearchCandidates([merge.refFromDatabase(inactive)]);
  assert.equal(search.scoreProducts(hidden, 'iphone 17').totalMatches, 0);
});

/* ------------------------------------------------------------- performance */

test('the filter layer adds no reads: one bounded catalogue load, cached briefly', async () => {
  const queries = [];
  await low.loadCatalogUsing(async (strings) => { queries.push(strings.join('?')); return []; });
  assert.equal(queries.length, 9, 'the existing bounded catalogue read only');
  const source = read('src/lib/storefront/category-filters.ts');
  assert.doesNotMatch(source, /getSql|from products|from product_/i, 'filters are pure over the snapshot');
  // Cached catalogue entries never carry a sale decision.
  const catalog = read('src/lib/storefront/catalog.ts');
  assert.match(catalog, /phase-b2-option-prices-v3/);
  assert.match(catalog, /applySaleDisplay\(product, sale\.live\)/);
});

test('archived, inactive and draft products can never enter a category payload', () => {
  const source = read('src/lib/catalog/storefront.ts');
  assert.match(source, /where p\.deleted_at is null[\s\S]*and p\.is_active/);
  assert.match(source, /and c\.deleted_at is null[\s\S]*and c\.is_active/);
});

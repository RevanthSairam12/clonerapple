import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const nativeRequire = createRequire(import.meta.url);
function load(relative, overrides = {}) {
  const filename = path.resolve(root, relative), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText, { module, exports: module.exports, console, fetch: overrides.fetch, require(name) {
    if (name === 'react') return {};
    if (name === '@/lib/platform/db') return { getSql: () => null };
    if (name === './sale-state' || name === '@/lib/storefront/sale-state') return {
      readSaleStateUsing: async () => ({ live: false, databaseNow: '2026-11-02T00:00:00Z' }),
    };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(`${target}.ts`, overrides);
    }
    return nativeRequire(name);
  } });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const ids = load('src/lib/cart/cart-id.ts');
const pricing = load('src/lib/checkout/client-quote.ts');
const rules = load('src/lib/storefront/availability-rules.ts');
const low = load('src/lib/catalog/storefront.ts');
const availability = load('src/lib/storefront/availability-server.ts');
const variant = (id, extra = {}) => ({ id, sku: `SKU-${id}`, label: id, optionName: 'Finish', optionValue: id,
  deviceModelId: null, deviceModelName: null, combinationKey: id, pricePaise: 1200, regularPricePaise: 1200,
  salePricePaise: null, onSale: false, inStock: true, ...extra });
const product = { id: 'p', inventoryMode: 'variant', pricePaise: 1000, inStock: true,
  purchasableVariants: [variant('v1'), variant('v2', { pricePaise: 1500, inStock: false })] };
const internal = (id, count, extra = {}) => ({ id: 'p', variantId: id, inStock: count !== 0,
  tracked: true, available: count, lowStockThreshold: 2, ...extra });

test('commerce line identity uses explicit variantId, not labels or a compatible model', () => {
  assert.equal(ids.buildCartLineId({ productId: 'P', variantId: 'v1', color: 'Red', model: 'Phone' }), 'p::variant::v1');
  assert.equal(ids.buildCartLineId({ productId: 'p', variantId: 'v1', color: 'Renamed' }), 'p::variant::v1');
  assert.notEqual(ids.buildCartLineId({ productId: 'p', variantId: 'v1' }), ids.buildCartLineId({ productId: 'p', variantId: 'v2' }));
  assert.equal(ids.normalizeCartLineId('p::variant::v1').variantId, undefined, 'encoded IDs never authorize variant selection');
  assert.equal(ids.normalizeCartLineId('p::variant::v1').model, undefined);
  assert.equal(ids.buildCartLineId({ productId: 'P', color: 'Red', model: 'Phone' }), 'p::Red::Phone');
});

test('newly activated products require reselection and exact ownership; sale changes presentation only', () => {
  for (const line of [{ id: 'p::Red::Phone', quantity: 1 }, { id: 'p', variantId: 'foreign', quantity: 1 }]) {
    assert.equal(pricing.priceCartLines([line], [product], true)[0].available, false);
  }
  assert.equal(pricing.priceCartLines([{ id: 'p', variantId: 'v1', quantity: 2 }], [product], false)[0].totalPaise, 2400);
  assert.equal(pricing.priceCartLines([{ id: 'p', variantId: 'v2', quantity: 1 }], [product], false)[0].available, false);
  assert.equal(pricing.priceCartLines([{ id: 'p', variantId: 'v2', quantity: 1 }], [product], true)[0].available, true);
  assert.equal(pricing.priceCartLines([{ id: 'legacy::Blue::Phone', quantity: 2 }], [{ id: 'legacy', pricePaise: 900, inStock: true }], false)[0].totalPaise, 1800);
});

test('price recovery updates exactly one SKU and rejects sibling selection/quantity replacement', () => {
  const quote = { items: [{ id: 'p', variantId: 'v1', variantSku: 'SKU-v1', variantLabel: 'One', name: 'P', quantity: 2,
    unitPaise: 1400, totalPaise: 2800, regularPricePaise: null }],
    totals: { subtotalPaise: 2800, discountPaise: 0, shippingPaise: 0, totalPaise: 2800 },
    shippingPolicy: { enabled: false, chargePaise: 0, freeShippingThresholdPaise: null } };
  assert.ok(pricing.parsePriceChangedQuote(quote));
  assert.equal(pricing.quoteMatchesLines(quote, [{ id: 'p', variantId: 'v1', quantity: 2 }]), true);
  assert.equal(pricing.quoteMatchesLines(quote, [{ id: 'p', variantId: 'v2', quantity: 2 }]), false);
  assert.equal(pricing.quoteMatchesLines(quote, [{ id: 'p', variantId: 'v1', quantity: 1 }]), false);
  const updated = pricing.applyQuotePrices([product], quote)[0];
  assert.equal(updated.pricePaise, 1000);
  assert.equal(updated.purchasableVariants[0].pricePaise, 1400);
  assert.equal(updated.purchasableVariants[1].pricePaise, 1500);
  const legacy = { ...quote, items: quote.items.map(line => ({ ...line, variantId: null, variantSku: null, variantLabel: null })) };
  assert.equal(pricing.parsePriceChangedQuote(legacy).items[0].variantId, undefined);
});

test('aggregate sums eligible child stock only and explicitly untracked variants make it uncapped', () => {
  assert.equal(rules.aggregateVariantAvailability('p', [internal('v1', 2), internal('v2', 3)]).available, 5);
  const uncapped = rules.aggregateVariantAvailability('p', [internal('v1', 2), internal('v2', null, { tracked: false, inStock: true })]);
  assert.equal(uncapped.available, null);
  assert.equal(uncapped.inStock, true);
  assert.equal(rules.supportsQuantity(uncapped, 50), true);
  assert.equal(rules.supportsQuantity(internal('v1', 1), 2), false);
  assert.equal(rules.stockBlocked(false, true), false);
});

test('public variant checks expose only identity, shelf state and requested-quantity boolean', () => {
  const result = rules.toPublicAvailability({ saleLive: true, databaseNow: 'private', products: [],
    variants: [{ ...internal('v1', 1), quantityAvailable: false }] });
  assert.deepEqual(plain(result.variants[0]), { id: 'p', variantId: 'v1', inStock: true, low: true, quantityAvailable: false });
  assert.doesNotMatch(JSON.stringify(result), /on_hand|reserved|available"|threshold|tracked|databaseNow/);
});

function catalogFixture() {
  return { categories: [{ id: 'c', name: 'Cases', slug: 'cases-protection' }],
    products: [{ id: 'p', category_id: 'c', inventory_mode: 'variant', name: 'P', price_paise: 1000,
      sale_price_paise: 800, in_stock: true }], images: [], attributes: [], deviceModels: [],
    variants: [
      { id: 'v1', product_id: 'p', is_active: true, is_purchasable: true, sku: 'ONE', combination_key: 'one', option_name: 'Finish', option_value: 'Blue', price_paise_override: 1200, sale_price_paise: 900 },
      { id: 'v2', product_id: 'p', is_active: true, is_purchasable: true, sku: 'TWO', combination_key: 'two' },
      { id: 'display', product_id: 'p', is_active: true, option_value: 'Red' },
      { id: 'foreign-model', product_id: 'p', is_active: true, is_purchasable: true, sku: 'BAD', combination_key: 'bad', device_model_id: 'not-compatible' },
    ], stock: [{ product_id: 'p', variant_id: null, track_inventory: true, on_hand: 999, reserved: 0 },
      { product_id: 'p', variant_id: 'v1', track_inventory: true, on_hand: 4, reserved: 1 }] };
}

test('storefront DTO projects configured combinations, price overrides, and ignores retained parent inventory', () => {
  const snapshot = low.snapshotFromLoad(catalogFixture());
  const row = snapshot.products[0];
  assert.equal(row.availableStock, 3);
  assert.equal(row.purchasableVariants.length, 1);
  assert.equal(row.purchasableVariants[0].pricePaise, 1200);
  assert.equal(row.purchasableVariants.some(v => v.id === 'v2'), false, 'missing exact stock row is not advertised');
  assert.equal(low.applySaleDisplay(row, true).purchasableVariants[0].pricePaise, 900);
  assert.doesNotMatch(JSON.stringify(row.purchasableVariants), /on_hand|reserved|lowStockThreshold|availableStock/);
  const fixture = catalogFixture();
  fixture.stock.push({ product_id: 'p', variant_id: 'v2', track_inventory: false, on_hand: 0, reserved: 0 });
  assert.equal(low.snapshotFromLoad(fixture).products[0].availableStock, null);
});

function fakeSql(products, variants) {
  const queries = [];
  const sql = async strings => { const query = strings.join('?'); queries.push(query);
    return query.includes('from product_variants v') ? variants : products; };
  return { sql, queries };
}
test('availability checks exact siblings, sums duplicate stock-key demand and leaves untracked legacy uncapped', async () => {
  const { sql, queries } = fakeSql([
    { id: 'p', inventory_mode: 'variant', is_active: true, deleted_at: null, in_stock: true, track_inventory: true, on_hand: 999, reserved: 0 },
    { id: 'legacy', inventory_mode: 'product', is_active: true, deleted_at: null, in_stock: true, track_inventory: false, on_hand: 0, reserved: 0 },
  ], [
    { product_id: 'p', variant_id: 'v1', track_inventory: true, on_hand: 2, reserved: 1 },
    { product_id: 'p', variant_id: 'v2', track_inventory: true, on_hand: 5, reserved: 0 },
    { product_id: 'p', variant_id: 'missing', track_inventory: null },
  ]);
  const result = await availability.readAvailabilityUsing(sql, ['p', 'legacy'], [
    { productId: 'p', variantId: 'v1', quantity: 1 }, { productId: 'p', variantId: 'v1', quantity: 1 },
    { productId: 'p', variantId: 'v2', quantity: 2 }, { productId: 'legacy', quantity: 50 },
    { productId: 'p', quantity: 1 }, { productId: 'p', variantId: 'foreign', quantity: 1 },
  ]);
  assert.equal(result.products[0].available, 6);
  assert.equal(result.products[0].quantityAvailable, false, 'missing variant must reselect');
  assert.equal(result.products[1].quantityAvailable, true);
  assert.equal(result.variants.find(v => v.variantId === 'v1').quantityAvailable, false);
  assert.equal(result.variants.find(v => v.variantId === 'v2').quantityAvailable, true);
  assert.equal(result.variants.find(v => v.variantId === 'foreign').quantityAvailable, false);
  assert.equal(result.variants.find(v => v.variantId === 'missing').inStock, false);
  assert.match(queries[1], /v.is_active and v.is_purchasable/);
  assert.match(queries[1], /s.variant_id = v.id/);
  assert.match(queries[1], /j.archived_at is null/);
  assert.match(queries[1], /requires_compatibility/);
});

test('click verification never treats sale presentation or failed responses as stock permission', async () => {
  let requested;
  const hook = load('src/lib/storefront/use-availability.ts', { fetch: async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ saleLive: true, products: [], variants: [{ id: 'p', variantId: 'v1', inStock: false, quantityAvailable: false }] }) };
  } });
  assert.equal(await hook.verifyAvailabilityLines([{ productId: 'p', variantId: 'v1', quantity: 3 }]), false);
  assert.match(decodeURIComponent(requested), /"variantId":"v1","quantity":3/);
  const failed = load('src/lib/storefront/use-availability.ts', { fetch: async () => { throw new Error('offline'); } });
  assert.equal(await failed.verifyAvailabilityLines([{ productId: 'p', quantity: 1 }]), null);
});

test('customer entry points carry explicit variant selection and enforce stock before purchase', () => {
  const source = file => readFileSync(path.join(root, file), 'utf8');
  // Two steps, model then colour; only the exact row can be bought.
  const selector = source('src/components/shop/OptionSelector.tsx');
  assert.match(selector, /steps\.showModel/);
  assert.match(selector, /steps\.showColour/);
  assert.match(selector, /role="radio"/);
  assert.match(selector, /aria-checked=\{checked\}/);
  assert.match(selector, /stockBlocked\(stock\[variant!\.id\] \?\? variant!\.inStock, saleLive\)/);
  assert.match(selector, /disabled=\{blocked\}/);
  for (const file of ['src/components/shop/ProductDetailPage.tsx', 'src/components/sites/accessories/AccessoryDetailPage.tsx']) {
    const text = source(file);
    assert.match(text, /optionSelectionFromSearch\(variants/);
    assert.match(text, /resolveOptionVariant\(variants, selection\)/);
    // No complete exact row means Add to Bag refuses instead of substituting.
    assert.match(text, /if \(variantMode && !selectedVariant\)/);
    assert.match(text, /variantId: selectedVariant\?\.id/);
    assert.match(text, /handleBuyNow/);
    assert.match(text, /await verifySelections/);
    assert.match(text, /priceNeedsReview\(product, checked\.prices\[0\]\)/);
    assert.match(text, /await purchase\.run\(async \(signal\) =>/);
    assert.match(text, /await addItem\(\{/);
    assert.match(text, /\{ signal \}/);
    assert.doesNotMatch(text, /model: product\.compatibility\[0\]/);
  }
  const checkout = source('src/components/checkout/CheckoutForm.tsx');
  assert.match(checkout, /variantId: i.variantId/);
  assert.match(checkout, /quoteMatchesLines\(quote, sourceItems\)/);
  assert.match(checkout, /const stockValid = await verifyAvailabilityLines/);
  assert.match(source('src/lib/cart/useCoupon.ts'), /variantId: item.variantId/);
  assert.match(source('src/app/checkout/page.tsx'), /&variantId=/);
});

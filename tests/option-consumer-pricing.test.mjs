import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { snapshotFromLoad, applySaleDisplay } = await jiti.import(path.join(root, 'src/lib/catalog/storefront.ts'));
const { refFromDatabase, accessoryProductFromDatabase, collectionProductFromDatabase } = await jiti.import(path.join(root, 'src/lib/storefront/catalog-merge.ts'));
const { getPosCatalogUsing, createPosSaleUsing } = await jiti.import(path.join(root, 'src/lib/store-admin/pos.ts'));

function fixture(options = [{ price_paise_override: 1200 }, {}]) {
  return { categories: [{ id: 'c', slug: 'power', name: 'Power' }],
    products: [{ id: 'p', category_id: 'c', name: 'Product', inventory_mode: 'variant', price_paise: 1000, sale_price_paise: 800 }],
    images: [], attributes: [], deviceModels: [],
    variants: options.map((option, index) => ({ id: `v${index}`, product_id: 'p', sku: `SKU${index}`, combination_key: `key${index}`, is_active: true, is_purchasable: true, ...option })),
    stock: options.map((_, index) => ({ product_id: 'p', variant_id: `v${index}`, track_inventory: true, on_hand: 2, reserved: 0 })) };
}
const row = data => snapshotFromLoad(data).products[0];

test('category minimum uses effective eligible option prices and headlines the cheapest amount', () => {
  const regular = row(fixture());
  assert.equal(regular.pricePaise, 1000);
  assert.equal(regular.priceDisplay, '₹10.00', 'the cheapest buyable option, never "From"');
  assert.equal(regular.priceFrom, true, 'the flag still records that rows differ');
  const sale = applySaleDisplay(regular, true);
  assert.equal(sale.pricePaise, 800);
  assert.equal(sale.priceDisplay, '₹8.00');
  assert.equal(sale.regularPricePaise, 1000);
  assert.equal(sale.purchasableVariants[0].pricePaise, 1200, 'regular override suppresses parent sale');
  const equal = applySaleDisplay(row(fixture([{ price_paise_override: 1200, sale_price_paise: 800 }, {}])), true);
  assert.equal(equal.priceDisplay, '₹8.00');
  assert.equal(equal.priceFrom, false);
});

test('raw invalid option overrides do not revive parent sale inheritance', () => {
  const sale = applySaleDisplay(row(fixture([{ price_paise_override: -10 }, { price_paise_override: 'bad' }, { price_paise_override: 1200 }])), true);
  assert.deepEqual(sale.purchasableVariants.map(v => v.pricePaise), [0, 0, 1200]);
  assert.deepEqual(sale.purchasableVariants.map(v => v.onSale), [false, false, false]);
});

test('minimum can switch options at sale boundaries without losing raw parent provenance', () => {
  const cached = row(fixture([{ price_paise_override: 2000, sale_price_paise: 500 }, {}]));
  const original = JSON.stringify(cached);
  const live = applySaleDisplay(cached, true);
  assert.equal(live.pricePaise, 500);
  assert.equal(live.regularPricePaise, 2000);
  assert.equal(live.parentPricePaise, 1000);
  assert.equal(live.parentSalePricePaise, 800);
  const off = applySaleDisplay(JSON.parse(JSON.stringify(live)), false);
  assert.equal(off.pricePaise, 1000);
  assert.equal(off.purchasableVariants[1].pricePaise, 1000);
  assert.equal(applySaleDisplay(off, true).purchasableVariants[1].pricePaise, 800);
  assert.equal(JSON.stringify(cached), original, 'request resolution never mutates the cached snapshot');
  const noOptions = applySaleDisplay({ ...live, purchasableVariants: [] }, true);
  assert.equal(noOptions.pricePaise, 800, 'internal fallback remains parent, never previous minimum');
  assert.equal(noOptions.priceDisplay, 'Unavailable');
});

test('minimum excludes missing stock, SKU/key, inactive and invalid compatibility combinations', () => {
  const data = fixture([{ price_paise_override: 1500 }, { price_paise_override: 1 }, { price_paise_override: 2, sku: '' },
    { price_paise_override: 3, combination_key: '' }, { price_paise_override: 4, is_active: false },
    { price_paise_override: 5, device_model_id: 'foreign' }]);
  data.stock = data.stock.filter(s => s.variant_id !== 'v1');
  const product = row(data);
  assert.equal(product.pricePaise, 1500);
  assert.equal(product.priceDisplay, '₹15.00');
  assert.deepEqual(product.purchasableVariants.map(v => v.id), ['v0']);
  data.products[0].__requires_compatibility = true;
  assert.equal(row(data).purchasableVariants.length, 0);
});

test('configured OOS options still participate independently of stock checks', () => {
  const data = fixture([{ price_paise_override: 500 }, { price_paise_override: 900 }]);
  data.stock[0].on_hand = 0;
  const product = row(data);
  assert.equal(product.priceDisplay, '₹5.00', 'sold-out rows still set the cheapest headline');
  assert.equal(product.purchasableVariants[0].inStock, false);
});

test('search/card projections retain minimum label without leaking internal parent defaults', () => {
  const product = applySaleDisplay(row(fixture()), true);
  for (const projection of [refFromDatabase(product), accessoryProductFromDatabase(product), collectionProductFromDatabase(product)]) {
    assert.equal(projection.priceDisplay, '₹8.00');
    assert.equal(projection.wasPriceDisplay, '₹10.00');
    assert.ok(!('parentPricePaise' in projection));
    assert.ok(!('parentSalePricePaise' in projection));
    assert.ok(!('pricePaiseOverride' in projection.purchasableVariants[0]));
  }
});

function fakeSql({ live = true, override = null, optionSale = null, entered = 777, unreadable = false } = {}) {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    queries.push({ query, values });
    if (query.includes('from sale_settings')) {
      if (unreadable) throw new Error('reference unavailable');
      return [{ enabled: live, starts_at: null, ends_at: null, db_now: '2026-11-03T00:00:00Z' }];
    }
    if (query.includes('from products p')) return [{ id: 'p', variant_id: 'v0', name: 'Product', price_paise: 1000,
      sale_price_paise: 800, price_paise_override: override, variant_sale_price_paise: optionSale }];
    if (query.startsWith('select id from pos_shifts')) return [{ id: 1 }];
    if (query.startsWith('select id, name, price_paise')) return [{ id: 'p', name: 'Product', price_paise: 1000, sale_price_paise: 800, inventory_mode: 'variant' }];
    if (query.startsWith('select v.*')) return [{ id: 'v0', sku: 'SKU0', option_name: 'Finish', option_value: 'Blue', price_paise_override: override, sale_price_paise: optionSale }];
    if (query.startsWith('select on_hand')) return [{ on_hand: 100, reserved: 0, track_inventory: false }];
    if (query.startsWith('update receipt_counters')) return [{ next_number: 2 }];
    if (query.startsWith('insert into orders')) return [{ id: 'order', txnid: 'POS-test' }];
    if (query.startsWith('select invoice_number')) return [{ invoice_number: 'INV1', invoice_issued_at: '2026-11-03T00:00:00Z' }];
    if (query.startsWith('insert into order_payments')) return [{ id: 3 }];
    if (query.startsWith('insert into store_admin_audit')) return [{ id: 4 }];
    return [];
  };
  sql.json = value => value;
  sql.begin = fn => fn(sql);
  return { sql, queries, input: { lines: [{ id: 'p', variantId: 'v0', quantity: 2, unitPricePaise: entered }],
    method: 'cash', providerRef: null, customerPhone: null, staffId: 'staff', role: 'store_admin',
    confirmUnusualPrices: true, confirmedFreeItemIds: [JSON.stringify(['p', 'v0'])] } };
}

for (const scenario of [
  { live: false, expected: 1000 }, { expected: 800 },
  { override: 1200, expected: 1200 }, { override: 1200, optionSale: 900, expected: 900 },
  { optionSale: 700, expected: 700 }, { override: 0, expected: 0 },
  { override: -10, expected: 0 }, { override: 1200, optionSale: 1400, expected: 1200 },
  { unreadable: true, expected: 1000 },
]) {
  test(`POS reference ${JSON.stringify(scenario)} never changes staff-entered charge`, async () => {
    const { sql, queries, input } = fakeSql(scenario);
    const catalog = await getPosCatalogUsing(sql);
    assert.equal(catalog.ok, true);
    assert.equal(catalog.products[0].listPricePaise, scenario.expected);
    const result = await createPosSaleUsing(sql, input);
    assert.equal(result.ok, true);
    assert.equal(result.data.lines[0].referencePricePaise, scenario.expected);
    assert.equal(result.data.lines[0].unitPricePaise, 777);
    assert.equal(result.data.lines[0].lineTotalPaise, 1554);
    assert.equal(result.data.totalPaise, 1554);
    const write = queries.find(q => q.query.startsWith('insert into order_items'));
    assert.equal(write.values[8], 777);
    assert.equal(write.values[9], scenario.expected);
    assert.equal(write.values[10], 1554);
  });
}

test('POS retains explicitly confirmed zero and unusually high staff prices', async () => {
  for (const entered of [0, 999999]) {
    const { sql, input } = fakeSql({ entered });
    const result = await createPosSaleUsing(sql, input);
    assert.equal(result.ok, true);
    assert.equal(result.data.lines[0].unitPricePaise, entered);
    assert.equal(result.data.totalPaise, entered * 2);
    assert.equal(result.data.lines[0].referencePricePaise, 800);
  }
});

test('additive description reads tolerate the pre-migration schema', async () => {
  const source = await readFile(path.join(root, 'src/lib/catalog/storefront.ts'), 'utf8');
  assert.match(source, /to_jsonb\(p\)->>'short_description' as short_description/);
  assert.match(source, /to_jsonb\(p\)->'description_sections' as description_sections/);
  assert.doesNotMatch(source, /p\.short_description|p\.description_sections/);
});

test('customer price surfaces use server label and detail has no implicit selected-option price', async () => {
  for (const file of ['src/components/collection/CollectionProductCard.tsx', 'src/components/collection/CollectionFeaturedTile.tsx']) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.match(source, /product\.priceDisplay \|\| formatINR\(product\.price\)/);
    assert.match(source, /product\.inventoryMode === 'variant'/);
  }
  for (const file of ['src/components/shop/ProductDetailPage.tsx', 'src/components/sites/accessories/AccessoryDetailPage.tsx']) {
    const source = await readFile(path.join(root, file), 'utf8');
    // The shared resolver decides the exact row's price, or the cheapest row's
    // amount until the customer chooses. No surface shows a "From" range.
    assert.match(source, /const price = optionPrice\(variants, selection/);
    assert.match(source, /priceDisplay: formatOptionPaise\(price\.unitPaise\)/);
    assert.doesNotMatch(source, /From \$\{formatOptionPaise/);
    assert.match(source, /regularPrice: price\.onSale && price\.regularPaise \? price\.regularPaise \/ 100 : undefined/);
    assert.match(source, /price: price\.unitPaise \/ 100/);
    assert.doesNotMatch(source, /selectedVariant\.pricePaise/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const rules = await jiti.import(path.join(root, 'src/lib/storefront/catalog-rules.ts'));
const merge = await jiti.import(path.join(root, 'src/lib/storefront/catalog-merge.ts'));
const staticCatalog = await jiti.import(path.join(root, 'src/lib/storefront/static-catalog.ts'));
const low = await jiti.import(path.join(root, 'src/lib/catalog/storefront.ts'));
const read = file => readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

const attribute = (key, overrides = {}) => ({ key, label: key, data_type: 'text', value_text: 'approved',
  show_in_specs: true, show_in_filters: true, show_in_search: true, ...overrides });
function load(overrides = {}) {
  return { categories: [{ id: 'c', slug: 'cases-protection', name: 'Cases' }],
    products: [{ id: 'p', category_id: 'c', name: 'Product', price_paise: 12000, in_stock: true, brand: 'Gadzio',
      material: 'legacy material', __category_slug: 'cases-protection' }],
    images: [], attributes: [], deviceModels: [], variants: [], stock: [], ...overrides };
}

function serverHarness({ snapshot = null, error, sale = { live: false } } = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(read('src/lib/storefront/catalog.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, console: { warn() {} }, require(name) {
    if (name === 'react') return { cache: fn => fn };
    if (name === 'next/cache') return { unstable_cache: fn => fn };
    if (name === '@/lib/catalog/storefront') return { ...low, readStorefrontCatalog: async () => {
      if (error) throw error;
      return snapshot;
    } };
    if (name === '@/lib/catalog/adapter') return { toCategoryConfig: category => ({ slug: category.slug,
      filters: category.facets.map(({ id, label, options }) => ({ id, label, options })),
      quickPillFacet: category.facets.find(f => f.isQuickPill)?.id,
      quickPills: category.facets.find(f => f.isQuickPill)?.options }) };
    if (name === './catalog-tags') return { CATALOG_CACHE_TAG: 'catalog', productCacheTag: id => id };
    if (name === './sale-state') return { readSaleState: async () => sale };
    if (name === './catalog-merge') return merge;
    if (name === './catalog-rules') return rules;
    if (name === './static-catalog') return staticCatalog;
    throw new Error(`Unexpected import ${name}`);
  } });
  return module.exports;
}

test('fresh purchase refs require an authoritative snapshot and readable sale state', async () => {
  const snapshot = low.snapshotFromLoad(load({ products: [{ ...load().products[0], sale_price_paise: 9000 }] }));
  const api = serverHarness({ snapshot, sale: { live: true } });
  const fresh = await api.getFreshStorefrontRefs();
  assert.equal(fresh.source, 'db');
  assert.equal(fresh.saleLive, true);
  assert.equal(fresh.products[0].id, 'p');
  assert.equal(fresh.products[0].pricePaise, 9000);
  assert.doesNotMatch(JSON.stringify(fresh), /cost_paise|on_hand|reserved|descriptionSections/);
  await assert.rejects(serverHarness().getFreshStorefrontRefs(), /unavailable/);
  await assert.rejects(serverHarness({ snapshot, sale: { live: false, unreadable: true } }).getFreshStorefrontRefs(), /unavailable/);
});

test('structured descriptions preserve null versus explicit empty across reader and detail mappings', async () => {
  for (const sections of [null, [], [{ id: 'overview', title: 'Overview', hidden: false, type: 'text', blocks: [
    { type: 'paragraph', content: [{ text: 'Visible detail' }] },
  ] }]]) {
    const snapshot = low.snapshotFromLoad(load({ products: [{ ...load().products[0],
      short_description: 'Searchable summary', description_sections: sections }] }));
    const product = snapshot.products[0];
    assert.deepEqual(product.descriptionSections, sections);
    const server = serverHarness({ snapshot });
    const detail = await server.getProductDetail('p');
    assert.deepEqual(plain(detail.product.descriptionSections), sections);
    assert.equal(detail.product.shortDescription, 'Searchable summary');
    const refs = await server.getStorefrontRefs();
    assert.ok(refs.products[0].keywords.includes('searchable'));
    assert.ok(refs.products[0].keywords.includes('summary'));
    assert.equal(refs.products[0].keywords.includes('Visible'), false);
    assert.equal('descriptionSections' in refs.products[0], false);
  }
});

test('both detail surfaces condition structured content on presence and render summary as text', () => {
  for (const file of ['src/components/shop/ProductDetailPage.tsx', 'src/components/sites/accessories/AccessoryDetailPage.tsx']) {
    const source = read(file);
    assert.match(source, /import \{ ProductDescriptionSections \}/);
    assert.match(source, /product\.descriptionSections != null \? <ProductDescriptionSections/);
    assert.match(source, /\{product\.shortDescription\}<\/p>/);
  }
});

test('typed projection respects each visibility flag, false/zero, and excludes legacy model PAV', () => {
  const result = rules.projectManagedCatalog([
    attribute('model', { value_text: 'Legacy phone' }),
    attribute('power', { data_type: 'number', value_number: 0, show_in_search: false }),
    attribute('wireless', { data_type: 'boolean', value_bool: false, show_in_filters: false }),
    attribute('connector', { data_type: 'enum', option_value: 'USB-C', show_in_specs: false }),
    attribute('blank', { value_text: null }),
  ], [{ name: 'Approved phone' }, { name: 'Approved phone' }]);
  assert.deepEqual(result.compatibility, ['Approved phone']);
  assert.deepEqual(result.specs, [{ label: 'power', value: '0' }, { label: 'wireless', value: 'No' }]);
  assert.equal(result.facets.wireless, undefined);
  assert.equal(result.facets.connector, 'USB-C');
  assert.deepEqual(result.searchValues, ['Approved phone', 'wireless No', 'connector USB-C']);
  assert.doesNotMatch(JSON.stringify(result), /Legacy phone/);
});

test('batched loader uses current type/category mapping and active definitions/models only', async () => {
  const queries = [];
  await low.loadCatalogUsing(async strings => { queries.push(strings.join('?')); return []; });
  assert.equal(queries.length, 7);
  const attributes = queries.find(q => q.includes('join product_type_attributes'));
  for (const required of ['t.id = p.product_type_id', 't.category_id = p.category_id', 't.is_active',
    'm.is_active', 'a.is_active', 'a.deleted_at is null', 'v.archived_at is null', "lower(a.key) <> 'model'"]) {
    assert.ok(attributes.includes(required), required);
  }
  const models = queries.find(q => q.includes('from product_device_models'));
  for (const required of ['j.archived_at is null', 'd.is_active', 'b.is_active']) assert.ok(models.includes(required));
  assert.equal(queries.some(q => /from product_(facets|specs)\b/.test(q)), false);
});

test('snapshot ignores unmapped legacy facets/specs and derives category filters from projection', () => {
  const snapshot = low.snapshotFromLoad(load({
    attributes: [{ product_id: 'p', ...attribute('power', { label: 'Power Output' }) }],
    deviceModels: [{ product_id: 'p', name: 'Approved phone' }],
    facets: [{ product_id: 'p', facet_key: 'legacy', facet_value: 'secret' }],
    specs: [{ product_id: 'p', label: 'Legacy', value: 'secret' }],
  }));
  const product = snapshot.products[0];
  assert.equal(product.material, '');
  assert.deepEqual(product.compatibility, ['Approved phone']);
  assert.deepEqual(product.specs, [{ label: 'Power Output', value: 'approved' }]);
  assert.deepEqual(snapshot.categories[0].facets.map(f => f.id), ['model', 'brand', 'power']);
  assert.equal(snapshot.categories[0].facets.find(f => f.id === 'power').label, 'Power Output');
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|legacy material/);
});

test('empty DB compatibility/specs/facets remain empty across accessory, case and grid merges', () => {
  const db = low.snapshotFromLoad(load()).products[0];
  const accessory = staticCatalog.getStaticProduct('ac-gadzio-silicone-pro3').product;
  const kase = staticCatalog.getStaticCaseProduct('iphone17-silicone-black');
  const outputs = [merge.mergeAccessoryProduct(accessory, db), merge.mergeCaseProduct(kase, db),
    merge.collectionProductFromDatabase(db, { ...accessory, specs: [{ label: 'Legacy', value: 'secret' }] })];
  for (const product of outputs) {
    assert.deepEqual(product.compatibility, []);
    assert.equal(product.material, '');
    assert.ok(Object.values(product.specs).every(value => !value));
    assert.equal(product.price, 120);
    assert.ok(product.description);
    assert.ok(product.image);
  }
});

test('search refs contain only explicitly searchable managed values', () => {
  const db = low.snapshotFromLoad(load({ attributes: [
    { product_id: 'p', ...attribute('private_display', { value_text: 'notsearchable', show_in_search: false }) },
    { product_id: 'p', ...attribute('search', { value_text: 'searchable', show_in_specs: false, show_in_filters: false }) },
  ] })).products[0];
  const keywords = merge.refFromDatabase(db).keywords.join(' ');
  assert.match(keywords, /searchable/);
  assert.doesNotMatch(keywords, /notsearchable|legacy material/);
});

test('outage suppresses managed static detail/category data but retains editorial, prices and images', async () => {
  const api = serverHarness();
  const detail = await api.getProductDetail('iphone17-silicone-black');
  assert.equal(detail.source, 'static');
  assert.deepEqual(plain(detail.product.compatibility), []);
  assert.ok(Object.values(detail.product.specs).every(value => !value));
  assert.ok(detail.product.image && detail.product.description && detail.product.price > 0);
  const category = await api.getCasesCategoryView();
  assert.deepEqual(plain(category.config.filters.map(f => f.id)), ['brand']);
  const accessory = await api.getAccessoryProductsView('airpods-case');
  assert.ok(accessory.products.every(p => p.compatibility.length === 0 && p.specs.length === 0));
  assert.deepEqual(plain(accessory.filters.map(f => f.id)), ['brand']);
});

test('reachable missing category never resurrects static products; explicit filters come from projected rows', async () => {
  const api = serverHarness({ snapshot: low.snapshotFromLoad(load()) });
  assert.equal((await api.getAccessoryProductsView('airpods-case')).products.length, 0);
  assert.equal(await api.getProductDetail('iphone17-silicone-black'), null);
  const category = await api.getAccessoryProductsView('cases-protection');
  assert.deepEqual(plain(category.filters.map(f => f.id)), ['brand']);
  assert.equal(category.products.length, 1);
});

test('missing schema is deployment-not-ready, distinct from connection outage', async () => {
  for (const code of ['42P01', '42703']) {
    const api = serverHarness({ error: { code } });
    await assert.rejects(api.getCasesCategoryView(), /deployment is not ready/);
    await assert.rejects(api.getProductDetail('iphone17-silicone-black'), /deployment is not ready/);
    await assert.rejects(api.getStorefrontRefs(), /deployment is not ready/);
  }
  assert.equal((await serverHarness({ error: { code: 'ECONNREFUSED' } }).getCasesCategoryView()).source, 'static');
});

test('summary shares refs with search and explicit pages preserve furniture while replacing filters', () => {
  const summary = read('src/app/api/catalog/summary/route.ts');
  assert.match(summary, /getStorefrontRefs/);
  assert.doesNotMatch(summary, /listStorefrontProductRefs/);
  for (const slug of ['airpods-case', 'cable-plug-case', 'mobile-cases', 'power-adapter-cable', 'wired-earphones']) {
    assert.match(read(`src/app/in/shop/iphone/accessories/${slug}/page.tsx`), /config=\{\{ \.\.\.CONFIG, filters, quickPillFacet, quickPills \}\}/);
  }
});

test('PDP compatibility is informational, complete and does not inject model variants', () => {
  const source = read('src/components/shop/ProductDetailPage.tsx');
  assert.match(source, /new Set\(product\.compatibility\)/);
  assert.doesNotMatch(source, /setSelectedSize|size-select/);
  assert.match(source, /Compatible devices/);
  assert.match(source, /availableSizes.map\(\(model\) => <p key=\{model\}>\{model\}<\/p>/);
  assert.match(source, /selectedVariant\?\.deviceModelName/);
  assert.match(source, /CommerceVariantSelector/);
  assert.doesNotMatch(source, /product\.compatibility\[0\]/, 'compatibility display never silently chooses a commerce model');
  assert.equal((source.match(/availableSizes.length > 0 &&/g) ?? []).length, 2);
  assert.doesNotMatch(source, /iPhone (16|17|18) Pro/);
  assert.match(source, /if \(!selectedSize\) return product\.description/);
  assert.match(source, /model: selectedSize/);
  assert.match(read('src/components/sites/accessories/AccessoryDetailPage.tsx'), /Section 2: Compatibility \*\/\}\s*\{product.compatibility.length > 0 &&/);
});

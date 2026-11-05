// Strictly offline: memory fixtures and injected SQL doubles only. No pool or DB writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const nativeRequire = createRequire(import.meta.url);
function load(relative) {
  const filename = path.resolve(root, relative), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText, { module, exports: module.exports, console, require(name) {
    if (name === '@/lib/platform/db') return { getSql() { throw Error('Unexpected application pool'); } };
    if (name === './product-metadata') return { strictMetadataAudit: async () => {}, metadataGate: async () => {}, saveProductMetadataUsing: async () => {}, MetadataError: class extends Error {} };
    if (name === './auth') return {};
    if (name === '@/lib/orders/invoice') return {};
    if (name === './product-content') return {};
    if (name === './catalog') return {};
    if (name === './sale-state' || name === '@/lib/storefront/sale-state') return {
      readSaleStateUsing: async () => ({ live: false, databaseNow: '2026-11-04T00:00:00Z' }),
    };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(`${target}.ts`);
    }
    return nativeRequire(name);
  } });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const identity = load('src/lib/store-admin/variant-identity.ts');
const metadata = load('src/lib/catalog/product-metadata-rules.ts');
const storefront = load('src/lib/catalog/storefront.ts');
const availability = load('src/lib/storefront/availability-server.ts');
const payu = load('src/lib/payu/db-catalog.ts');
const inventory = load('src/lib/store-admin/variant-inventory.ts');
const pos = load('src/lib/store-admin/pos.ts');
const drafts = load('src/lib/store-admin/product-draft.ts');
const { parseProductDraft } = load('src/lib/store-admin/product-draft-rules.ts');
const input = { id: 'v', sku: 'SAVED', optionName: 'Finish', optionValue: 'Blue', optionHex: null,
  isActive: true, isPurchasable: true, combinationKey: 'saved-key', optionIdentity: 'blue', deviceModelId: 'm', sortOrder: 0 };
const saved = { id: 'v', product_id: 'p', sku: 'SAVED', option_name: 'Finish', option_value: 'Blue', option_hex: null,
  is_active: true, is_purchasable: true, combination_key: 'saved-key', option_identity: 'blue', device_model_id: 'm', sort_order: 0, retired_at: null };
function identitySql({ old = saved, mapped = true, active = false, mode = 'variant' } = {}) {
  const events = [];
  const tx = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim(); events.push({ query, values });
    if (query.startsWith('select * from product_variants')) {
      assert.match(query, /id=\? and product_id=\? for update/);
      return old && old.id === values[0] && old.product_id === values[1] ? [old] : [];
    }
    if (query.startsWith('select 1 from product_device_models')) {
      assert.match(query, /pm.archived_at is null/);
      assert.match(query, /dm.is_active and db.is_active/);
      assert.match(query, /p.id=pm.product_id and p.inventory_mode='variant'/);
      return mapped && (active || (values[2] === true && mode === 'variant')) ? [{ ok: 1 }] : [];
    }
    if (/^(insert into|update) product_variants/.test(query)) return [{ id: 'v' }];
    return [];
  };
  return { tx, events };
}

test('an owned active commerce option retains an inactive model/brand without changing identity, prices or stock', async () => {
  const { tx, events } = identitySql();
  const result = await identity.saveVariantIdentityUsing(tx, 'p', input, 'staff');
  assert.equal(result.created, false);
  assert.equal(result.id, 'v');
  const update = events.find(e => e.query.startsWith('update product_variants'));
  assert.deepEqual(update.values.slice(0, 9), ['SAVED', 'Finish', 'Blue', null, true, 'm', 'saved-key', 'blue', true]);
  assert.ok(events.every(e => !/^(insert into|update) (stock|price_history|orders)/.test(e.query)));
  assert.doesNotMatch(update.query, /price_paise/);
});

test('inactive refs cannot admit new, replacement, reactivated, converted, model-changing or restored options', async () => {
  const cases = [
    { options: { old: null }, next: { ...input, id: undefined } },
    { options: {}, next: { ...input, id: undefined, replacesVariantId: 'v', sku: 'NEW' } },
    { options: {}, next: { ...input, id: undefined, replacesVariantId: 'v', sku: 'NEW', isActive: false } },
    { options: { old: { ...saved, is_active: false } }, next: input },
    { options: { old: { ...saved, is_purchasable: false } }, next: input },
    { options: { old: { ...saved, is_purchasable: false, device_model_id: 'other' } }, next: { ...input, isActive: false, isPurchasable: false } },
    { options: { mode: 'product' }, next: input },
    { options: { mapped: false }, next: input },
    { options: { old: null }, next: { ...input, id: undefined, isActive: false } },
  ];
  for (const { options, next } of cases) {
    const { tx, events } = identitySql(options);
    await assert.rejects(identity.saveVariantIdentityUsing(tx, 'p', next, 'staff'), /active model/);
    assert.ok(events.every(e => !/^(insert|update)/.test(e.query)), 'reject before writes');
  }
});

test('foreign IDs, retirement and identity mutation cannot obtain retention; active refs still permit creation', async () => {
  await assert.rejects(identity.saveVariantIdentityUsing(identitySql({ old: { ...saved, product_id: 'foreign' } }).tx, 'p', input, 'staff'), /not found/);
  await assert.rejects(identity.saveVariantIdentityUsing(identitySql({ old: { ...saved, retired_at: '2026-11-03' } }).tx, 'p', input, 'staff'), /cannot be reactivated/);
  for (const patch of [{ sku: 'OTHER' }, { combinationKey: 'other' }, { optionIdentity: 'other' }, { deviceModelId: 'other' }, { optionValue: 'Other' }]) {
    await assert.rejects(identity.saveVariantIdentityUsing(identitySql().tx, 'p', { ...input, ...patch }, 'staff'), /immutable/);
  }
  assert.equal((await identity.saveVariantIdentityUsing(identitySql({ old: null, active: true }).tx, 'p', { ...input, id: undefined }, 'staff')).created, true);
});

test('publication separates active choices, inactive review mappings and retained commerce compatibility', () => {
  const type = { id: 't', categoryId: 'c', isActive: true, requiresCompatibility: true, attributes: [] };
  const problems = retention => metadata.publicationProblems(type, 'c', {}, [], 't', retention);
  assert.equal(problems({ retainedModelIds: ['m'] }).length, 1);
  assert.equal(problems({ retainedOptionModelIds: ['m'] }).length, 1);
  assert.equal(problems({ retainedModelIds: ['m'], retainedOptionModelIds: ['other'] }).length, 1);
  assert.equal(problems({ retainedModelIds: ['m'], retainedOptionModelIds: ['m'] }).length, 0);
  assert.equal(metadata.publicationProblems(type, 'c', {}, ['active'], 't').length, 0);
  assert.ok(metadata.publicationProblems({ ...type, isActive: false }, 'c', {}, [], 't', { retainedModelIds: ['m'], retainedOptionModelIds: ['m'] }).length);
});

function fixture() {
  return { categories: [{ id: 'c', name: 'Category' }],
    products: [{ id: 'p', category_id: 'c', name: 'Product', inventory_mode: 'variant', price_paise: 1000, sale_price_paise: 800, in_stock: true, __requires_compatibility: true }],
    images: [], attributes: [], deviceModels: [{ product_id: 'p', id: 'm', name: 'Saved model', selection_eligible: false }],
    variants: [{ ...saved, price_paise_override: 1500, sale_price_paise: 1200 }],
    stock: [{ product_id: 'p', variant_id: 'v', track_inventory: true, on_hand: 4, reserved: 1 }] };
}
test('storefront retains mapped inactive labels/prices/stock but omits them from discovery', () => {
  const snapshot = storefront.snapshotFromLoad(fixture());
  const product = snapshot.products[0];
  assert.equal(product.purchasableVariants.length, 1);
  assert.equal(product.purchasableVariants[0].deviceModelName, 'Saved model');
  assert.match(product.purchasableVariants[0].label, /Saved model/);
  assert.equal(product.pricePaise, 1500);
  assert.equal(product.availableStock, 3);
  assert.deepEqual(plain(product.compatibility), []);
  assert.deepEqual(plain(product.searchValues), []);
  assert.equal(product.facetValues.model, undefined);
  assert.equal(snapshot.categories[0].facets.some(f => f.id === 'model'), false);
  const sale = storefront.applySaleDisplay(product, true);
  assert.equal(sale.pricePaise, 1200);
  assert.equal(product.pricePaise, 1500);
  const active = fixture(); active.deviceModels[0].selection_eligible = true;
  assert.deepEqual(plain(storefront.snapshotFromLoad(active).products[0].compatibility), ['Saved model']);
});

test('storefront retains exact ownership/mapping/retirement/SKU/key/stock/required-model checks', () => {
  const cases = [
    f => { f.deviceModels = []; },
    f => { f.deviceModels[0].product_id = 'other'; },
    f => { f.variants[0].product_id = 'other'; },
    f => { f.variants[0].retired_at = 'now'; },
    f => { f.variants[0].is_active = false; },
    f => { f.variants[0].is_purchasable = false; },
    f => { f.variants[0].sku = ' '; },
    f => { f.variants[0].combination_key = ' '; },
    f => { f.stock = []; },
    f => { f.stock[0].product_id = 'other'; },
    f => { f.variants[0].device_model_id = null; },
  ];
  for (const mutate of cases) {
    const f = fixture(); mutate(f);
    const p = storefront.snapshotFromLoad(f).products[0];
    assert.equal(p.purchasableVariants.length, 0);
    assert.equal(p.inStock, false);
  }
});

test('catalog SQL loads retained mapping labels separately from active discovery and includes retirement', async () => {
  const queries = [];
  await storefront.loadCatalogUsing(async strings => { queries.push(strings.join('?')); return []; });
  const modelQuery = queries.find(q => q.includes('from product_device_models j'));
  assert.match(modelQuery, /\(d.is_active and b.is_active\) as selection_eligible/);
  assert.match(modelQuery, /where j.archived_at is null/);
  assert.doesNotMatch(modelQuery, /join[^\n]+ and [db].is_active/);
  assert.match(queries.find(q => q.includes('from product_variants')), /retired_at/);
});

test('availability retains mapped inactive references with exact stock and requested quantity checks', async () => {
  const queries = [];
  const sql = async strings => {
    const q = strings.join('?'); queries.push(q);
    return q.includes('from product_variants v')
      ? [{ variant_id: 'v', product_id: 'p', track_inventory: true, on_hand: 4, reserved: 1 }]
      : [{ id: 'p', inventory_mode: 'variant', is_active: true, deleted_at: null }];
  };
  const result = await availability.readAvailabilityUsing(sql, ['p'], [{ productId: 'p', variantId: 'v', quantity: 4 }, { productId: 'p', variantId: 'foreign', quantity: 1 }]);
  assert.equal(result.products[0].available, 3);
  assert.equal(result.variants[0].quantityAvailable, false);
  assert.equal(result.variants[1].inStock, false);
  const q = queries.find(q => q.includes('from product_variants v'));
  for (const pattern of [/v.is_active and v.is_purchasable/, /v.retired_at is null/, /trim\(v.sku\)/, /trim\(v.combination_key\)/, /requires_compatibility/, /s.product_id = v.product_id and s.variant_id = v.id/, /j.product_id = v.product_id/, /j.archived_at is null/]) assert.match(q, pattern);
  assert.doesNotMatch(q, /\b[db].is_active/);
});

test('inventory adjustment retains live options, while product-to-variant activation remains active-only', async () => {
  for (const mode of ['variant', 'product']) {
    const queries = [];
    const tx = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim(); queries.push(q);
      if (q.startsWith('select id,inventory_mode')) return [{ id: 'p', inventory_mode: mode }];
      if (q.startsWith('select v.id')) {
        assert.match(q, /v.retired_at is null/);
        assert.match(q, /pm.archived_at is null/);
        assert.match(q, /dm.is_active and db.is_active/);
        return values.at(-1) === true ? [{ id: 'v' }] : [];
      }
      if (q.startsWith('select * from stock')) return [{ id: 's', on_hand: 4, reserved: 1, track_inventory: true }];
      return [];
    };
    const run = inventory.adjustVariantInventoryUsing(tx, { productId: 'p', variantId: 'v', delta: 1, reason: 'receipt' }, 'staff');
    if (mode === 'variant') assert.equal((await run).onHand, 5);
    else await assert.rejects(run, /valid model mapping/);
  }
  const queries = [];
  const tx = async strings => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim(); queries.push(q);
    if (q.startsWith('select id,inventory_mode')) return [{ id: 'p', inventory_mode: 'product', product_type_id: null }];
    if (q.startsWith('select v.*')) return [{ ...saved, requires_compatibility: true }];
    if (q.startsWith('select * from stock')) return [{ id: 's', on_hand: 4, reserved: 0 }];
    return [];
  };
  await assert.rejects(inventory.activateVariantInventoryUsing(tx, 'p', { confirm: true, reason: 'activation', allocations: [] }, 'staff'), /active product compatibility/);
  assert.match(queries.find(q => q.startsWith('select 1 from product_device_models')), /dm.is_active and db.is_active/);
  assert.ok(queries.every(q => !/^(insert|update)/.test(q)));
});

test('unrelated draft saves retain inactive compatibility only for an already converted parent', async () => {
  for (const mode of ['variant', 'product']) {
    const queries = [];
    const tx = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim(); queries.push(q);
      if (q.startsWith('select * from products')) return [{ id: 'p', inventory_mode: mode, price_paise: 1000, sale_price_paise: null, catalog_revision: 1 }];
      if (q.startsWith('select id from categories')) return [{ id: 'c' }];
      if (q.startsWith('select v.id')) {
        assert.match(q, /v.retired_at is not null/);
        assert.match(q, /nullif\(trim\(v.sku\),''\) is null/);
        assert.match(q, /pm.archived_at is null/);
        return values[1] === true ? [] : [{ id: 'v' }];
      }
      if (q.startsWith('select catalog_revision')) return [{ catalog_revision: 1 }];
      return [];
    };
    const draft = parseProductDraft({ id: 'p', product: { id: 'p', name: 'Renamed product', slug: 'p', categoryId: 'c', pricePaise: 1000, isActive: true } });
    const run = drafts.saveProductDraftInTransaction(tx, draft, 'staff');
    if (mode === 'variant') assert.equal((await run).ok, true);
    else await assert.rejects(run, /invalid SKU, combination key or compatible device/);
    assert.ok(queries.every(q => !/^(insert into|update) (stock|stock_movements)/.test(q)));
  }
});

test('POS catalog and final sale guard retain mapped references without bypassing exact-stock rejection', async () => {
  const queries = [];
  const sql = async strings => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim(); queries.push(q);
    return [{ id: 'p', name: 'Product', variant_id: 'v', variant_sku: 'SAVED', variant_label: 'Saved model / Blue', price_paise: 1000, price_paise_override: 1500, track_inventory: true, on_hand: 3 }];
  };
  const catalog = await pos.getPosCatalogUsing(sql);
  assert.equal(catalog.ok, true);
  assert.equal(catalog.products[0].variantLabel, 'Saved model / Blue');
  assert.equal(catalog.products[0].listPricePaise, 1500);
  const catalogQuery = queries[0];
  assert.match(catalogQuery, /v.retired_at is null/);
  assert.match(catalogQuery, /pm.archived_at is null/);
  assert.match(catalogQuery, /s.id is not null/);
  assert.doesNotMatch(catalogQuery, /\b(?:dm|db).is_active/);
  const tx = async strings => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim(); queries.push(q);
    if (q.startsWith('select id from pos_shifts')) return [{ id: 1 }];
    if (q.startsWith('select id, name, price_paise')) return [{ id: 'p', name: 'Product', price_paise: 1000, inventory_mode: 'variant' }];
    if (q.startsWith('select v.*')) return [saved];
    return [];
  };
  const result = await pos.createPosSaleUsing({ begin: fn => fn(tx) }, { lines: [{ id: 'p', variantId: 'v', quantity: 1, unitPricePaise: 1000 }], method: 'cash', providerRef: null, customerPhone: null, staffId: 'staff', role: 'store_admin' });
  assert.equal(result.reason, 'out-of-stock');
  const saleQuery = queries.find(q => q.startsWith('select v.*'));
  assert.match(saleQuery, /v.id=\? and v.product_id=\?/);
  assert.match(saleQuery, /v.retired_at is null/);
  assert.match(saleQuery, /trim\(v.sku\)/);
  assert.match(saleQuery, /pm.archived_at is null/);
  assert.doesNotMatch(saleQuery, /\b(?:dm|db).is_active/);
  assert.ok(queries.every(q => !q.startsWith('insert into orders')));
});

test('starter publication guard accepts retained commerce but rejects missing mappings and pending conversion', () => {
  const source = readFileSync(path.join(root, 'src/lib/store-admin/catalog-starter-setup.ts'), 'utf8');
  const q = source.split('\n').find(line => line.includes('const invalidVariants ='));
  assert.match(q, /v.retired_at is not null/);
  assert.match(q, /not exists\(select 1 from product_device_models pm/);
  assert.match(q, /pm.archived_at is null/);
  assert.match(q, /p.inventory_mode<>'variant' and \(not coalesce\(dm.is_active,false\)/);
});

test('PayU SQL retains inactive refs without weakening ownership, stock, price or selection checks', async () => {
  const queries = [];
  const sql = async strings => {
    const q = strings.join('?'); queries.push(q);
    return [{ id: 'p', name: 'Product', inventory_mode: 'variant', variant_id: 'v', variant_sku: 'SAVED', variant_label: 'Saved model / Blue', price_paise: 1000, option_price_paise: 1500 }];
  };
  const cart = await payu.resolveCartItemsFromDbUsing(sql, [{ id: 'p', variantId: 'v', quantity: 2, expectedUnitPaise: 1000 }]);
  assert.equal(cart.totalPaise, 3000);
  assert.equal(cart.items[0].variantSku, 'SAVED');
  assert.match(cart.items[0].variantLabel, /Saved model/);
  assert.equal(cart.priceChanges.length, 1);
  await assert.rejects(payu.resolveCartItemsFromDbUsing(sql, [{ id: 'p', variantId: 'foreign', quantity: 1 }]), /selection is no longer available/);
  // The first statement is the colour-link capability probe; assert on the
  // catalogue statement itself.
  const q = queries.find(query => query.includes('from products p'));
  assert.ok(q, 'the catalogue statement ran');
  for (const pattern of [/c.is_active and c.deleted_at is null/, /p.deleted_at is null/, /and p.is_active/, /v.product_id=p.id/, /v.is_active and v.is_purchasable and v.retired_at is null/, /s.id is not null/, /trim\(v.sku\)/, /trim\(v.combination_key\)/, /requires_compatibility/, /dm.id is not null and db.id is not null/, /pdm.product_id=p.id/, /pdm.archived_at is null/]) assert.match(q, pattern);
  assert.doesNotMatch(q, /\b(?:dm|db).is_active/);
});

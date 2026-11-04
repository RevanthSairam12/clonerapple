import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { HISTORICAL_PRODUCTS, HISTORICAL_TYPES, HISTORICAL_MODELS, planProductMetadataBackfill: plan, assertBackfillApproval: approve, safeBackfillId } =
  await jiti.import(path.join(root, 'src/lib/catalog/product-metadata-backfill.ts'));
const target = 'host:5432/database/role';
function fixture() {
  const slugs = [...new Set(HISTORICAL_PRODUCTS.map(row => row.category))];
  const categories = slugs.map(slug => ({ id: `cat_${slug}`, slug, is_active: true, deleted_at: null }));
  const keys = [...new Set(HISTORICAL_TYPES.flatMap(row => row.keys)), 'model'];
  return {
    schema: { missing: [], rlsDisabled: [] }, categories,
    products: HISTORICAL_PRODUCTS.map(row => ({ id: row.id, category_id: `cat_${row.category}`, deleted_at: null, product_type_id: null, compatibility_reviewed_at: null })),
    attributes: keys.map(key => ({ id: `attr_${key}`, key, data_type: 'enum', is_active: true, deleted_at: null })),
    facetDefs: categories.flatMap(category => [...new Set(HISTORICAL_TYPES.filter(row => row.category === category.slug).flatMap(row => row.keys)), 'model'].map((key, index) => ({ category_id: category.id, facet_key: key, sort_order: index }))),
    facets: HISTORICAL_PRODUCTS.flatMap(row => row.models.map((name, index) => ({ product_id: row.id, facet_key: 'model', facet_value: name, sort_order: index }))),
    values: [], types: [], typeAttributes: [],
    brands: [{ id: 'owner_apple', name: 'Apple', sort_order: 0, is_active: true }],
    models: HISTORICAL_MODELS.map(([id, name], sort_order) => ({ id, name, brand_id: 'owner_apple', sort_order, is_active: true })), joins: [],
  };
}
function simulate(snapshot, planned) {
  const result = structuredClone(snapshot);
  for (const [key, table] of Object.entries({ types: 'product_types', typeAttributes: 'product_type_attributes', brands: 'device_brands', models: 'device_models', joins: 'product_device_models' })) result[key].push(...structuredClone(planned.inserts[table]));
  for (const update of planned.updates) {
    const product = result.products.find(row => row.id === update.product_id);
    if (update.product_type_id) product.product_type_id = update.product_type_id;
    if (update.review_compatibility) product.compatibility_reviewed_at = '2026-11-02T00:00:00.000Z';
  }
  return result;
}

test('exact allowlist: 12 products, six categories, seven types, seven distinct models and seven joins', () => {
  const result = plan(fixture(), target);
  assert.equal(HISTORICAL_PRODUCTS.length, 12);
  assert.equal(new Set(HISTORICAL_PRODUCTS.map(row => row.category)).size, 6);
  assert.equal(result.inserts.product_types.length, 7);
  assert.equal(result.inserts.device_brands.length, 0);
  assert.equal(result.inserts.device_models.length, 0);
  assert.equal(result.inserts.product_device_models.length, 7);
  assert.equal(result.updates.length, 12);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(fixture().models.map(row => row.name).sort(), HISTORICAL_MODELS.map(row => row[1]).sort());
  assert.equal(result.updates.filter(row => row.review_compatibility).length, 6);
  assert.equal(result.counts.store_admin_audit.insert, 1);
  approve(result, result.digest);
});

test('first case has exactly the two explicit static models, all other joins are exact', () => {
  const result = plan(fixture(), target);
  for (const product of HISTORICAL_PRODUCTS) {
    const names = result.inserts.product_device_models.filter(row => row.product_id === product.id).map(row => HISTORICAL_MODELS.find(model => model[0] === row.device_model_id)[1]);
    assert.deepEqual(names.sort(), [...product.models].sort());
  }
});

test('static sources still match the complete historical allowlist and exact device strings', async () => {
  const { STATIC_CASE_PRODUCTS, STATIC_ACCESSORY_CATEGORIES } = await jiti.import(path.join(root, 'src/lib/storefront/static-catalog.ts'));
  const source = [...STATIC_CASE_PRODUCTS.map(row => ({ ...row, categorySlug: 'cases-protection' })), ...Object.values(STATIC_ACCESSORY_CATEGORIES).flatMap(row => row.products)];
  assert.deepEqual(source.map(row => row.id).sort(), HISTORICAL_PRODUCTS.map(row => row.id).sort());
  for (const historical of HISTORICAL_PRODUCTS) {
    const product = source.find(row => row.id === historical.id);
    assert.equal(product.categorySlug, historical.category);
    if (historical.models.length) assert.deepEqual(product.compatibility, [...historical.models]);
  }
});

test('pure, deterministic, order-independent plan and digest', () => {
  const snapshot = fixture(), original = structuredClone(snapshot);
  const first = plan(snapshot, target);
  assert.deepEqual(snapshot, original);
  for (const value of Object.values(snapshot)) if (Array.isArray(value)) value.reverse();
  assert.deepEqual(plan(snapshot, target), first);
  assert.deepEqual(plan(original, target), first);
});

test('second run is a genuine no-op including the audit, preserving archived and unrelated PAVs', () => {
  const snapshot = fixture();
  snapshot.values.push({ product_id: HISTORICAL_PRODUCTS[0].id, attribute_id: 'attr_connector', option_value: 'PRIVATE VALUE', archived_at: '2025-01-01' });
  const first = plan(snapshot, target);
  const second = plan(simulate(snapshot, first), target);
  assert.equal(second.updates.length, 0);
  assert.equal(Object.values(second.inserts).flat().length, 0);
  assert.equal(second.counts.store_admin_audit.insert, 0);
  assert.equal(second.conflicts.length, 0);
  assert.deepEqual(second.unrelatedValues, first.unrelatedValues);
  assert.equal(second.counts.product_attribute_values.update, 0);
  assert.equal(second.counts.product_attribute_history.insert, 0);
});

test('three unknown live products remain NULL and require review; deleted products are ignored', () => {
  const snapshot = fixture();
  snapshot.products.push(...['test_1', 'test_2', 'test_3'].map(id => ({ id, category_id: snapshot.categories[0].id, product_type_id: null })));
  snapshot.products.push({ id: 'deleted', deleted_at: '2025-01-01' });
  const result = plan(snapshot, target);
  assert.equal(result.review.filter(row => row.code === 'unknown-product-needs-type').length, 3);
  assert.equal(result.updates.some(row => row.product_id.startsWith('test_')), false);
  assert.equal(result.review.some(row => row.id === 'deleted'), false);
});

test('unknown model facets and unknown model PAVs report review without importing or mutating', () => {
  for (const source of ['facet', 'pav']) {
    const snapshot = fixture(), id = HISTORICAL_PRODUCTS[0].id;
    if (source === 'facet') snapshot.facets.push({ product_id: id, facet_key: 'model', facet_value: 'iPhone 99 Secret' });
    else snapshot.values.push({ product_id: id, attribute_id: 'attr_model', option_value: 'iPhone 99 Secret' });
    const result = plan(snapshot, target);
    assert.ok(result.review.some(row => row.code === 'unknown-explicit-model'));
    assert.ok(result.conflicts.some(row => row.code === 'product-model-conflict'));
    assert.equal(result.updates.some(row => row.product_id === id), false);
    assert.equal(JSON.stringify(result).includes('iPhone 99 Secret'), false);
    assert.equal(result.inserts.device_models.length, 0);
    assert.throws(() => approve(result, result.digest), /conflicts/);
  }
});

test('no broad phrases are expanded, even on the six known non-device products', () => {
  const snapshot = fixture();
  const result = plan(snapshot, target);
  for (const row of HISTORICAL_PRODUCTS.filter(product => !product.models.length)) {
    assert.equal(result.inserts.product_device_models.some(join => join.product_id === row.id), false);
    assert.equal(result.updates.find(update => update.product_id === row.id).review_compatibility, false);
  }
  snapshot.facets.push({ product_id: 'pa-gadzio-20w-usbc', facet_key: 'model', facet_value: 'iPhone 15 and later' });
  const changed = plan(snapshot, target);
  assert.ok(changed.review.some(row => row.id === 'pa-gadzio-20w-usbc'));
  assert.equal(changed.inserts.product_device_models.some(row => row.product_id === 'pa-gadzio-20w-usbc'), false);
});

test('deliberately reviewed-empty compatibility is never refilled or remarked', () => {
  const snapshot = fixture(), id = HISTORICAL_PRODUCTS[0].id;
  snapshot.products[0].compatibility_reviewed_at = '2025-01-01';
  const result = plan(snapshot, target);
  assert.equal(result.inserts.product_device_models.some(row => row.product_id === id), false);
  assert.equal(result.updates.find(row => row.product_id === id).review_compatibility, false);
  assert.equal(result.conflicts.length, 0);
});

test('existing correct joins are preserved, missing joins alone inserted', () => {
  const snapshot = fixture(), id = HISTORICAL_PRODUCTS[0].id;
  snapshot.joins.push({ product_id: id, device_model_id: 'device_iphone_18_pro_max', sort_order: 42, archived_at: null });
  const result = plan(snapshot, target);
  assert.equal(result.inserts.product_device_models.length, 6);
  assert.equal(result.conflicts.length, 0);
  assert.equal(snapshot.joins[0].sort_order, 42);
});

test('unreviewed archived or unexpected joins conflict and are not revived/replaced', () => {
  for (const join of [
    { device_model_id: 'device_iphone_18_pro_max', archived_at: '2025-01-01' },
    { device_model_id: 'device_unknown', archived_at: null },
  ]) {
    const snapshot = fixture(), id = HISTORICAL_PRODUCTS[0].id;
    snapshot.joins.push({ product_id: id, ...join });
    const result = plan(snapshot, target);
    assert.ok(result.conflicts.some(row => row.code === 'existing-join-conflict'));
    assert.equal(result.inserts.product_device_models.some(row => row.product_id === id), false);
    assert.throws(() => approve(result, result.digest));
  }
});

test('reviewed existing joins, including archived joins, remain untouched', () => {
  const snapshot = fixture(), id = HISTORICAL_PRODUCTS[0].id;
  snapshot.products[0].compatibility_reviewed_at = '2025-01-01';
  snapshot.joins.push({ product_id: id, device_model_id: 'device_custom', archived_at: '2025-01-01' });
  const result = plan(snapshot, target);
  assert.equal(result.inserts.product_device_models.some(row => row.product_id === id), false);
  assert.equal(result.conflicts.length, 0);
});

test('different existing type and wrong category are conflicts, not assignments', () => {
  for (const patch of [{ product_type_id: 'custom_type' }, { category_id: 'another_category' }]) {
    const snapshot = fixture(); Object.assign(snapshot.products[0], patch);
    const result = plan(snapshot, target);
    assert.equal(result.updates.some(row => row.product_id === snapshot.products[0].id), false);
    assert.ok(result.conflicts.length);
    assert.throws(() => approve(result, result.digest));
  }
});

test('missing/inactive/ambiguous owner brand references block apply without creating devices', () => {
  for (const modify of [
    s => { s.brands[0].name = 'Another'; },
    s => { s.brands[0].is_active = false; },
    s => { s.brands.push({ ...s.brands[0], id: 'another_apple', name: ' apple ' }); },
  ]) {
    const snapshot = fixture(); modify(snapshot);
    const result = plan(snapshot, target);
    assert.ok(result.conflicts.some(issue => issue.code === 'owner-device-reference-missing-or-ambiguous'));
    assert.equal(result.inserts.device_brands.length, 0);
    assert.equal(result.inserts.device_models.length, 0);
    assert.throws(() => approve(result, result.digest));
  }
});

test('empty owner references cause review conflicts and zero device or compatibility inserts', () => {
  const snapshot = fixture(); snapshot.brands = []; snapshot.models = [];
  const result = plan(snapshot, target);
  assert.ok(result.conflicts.some(row => row.code === 'owner-device-reference-missing-or-ambiguous'));
  assert.equal(result.inserts.device_brands.length, 0);
  assert.equal(result.inserts.device_models.length, 0);
  assert.equal(result.inserts.product_device_models.length, 0);
  assert.throws(() => approve(result, result.digest));
});

test('compatibility resolves owner-created IDs rather than historical fixture IDs', () => {
  const snapshot = fixture();
  snapshot.models = snapshot.models.map((row, index) => ({ ...row, id: `owner_model_${index}`, name: ` ${row.name.toUpperCase()} ` }));
  const result = plan(snapshot, target);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.inserts.product_device_models.length, 7);
  assert.ok(result.inserts.product_device_models.every(row => row.device_model_id.startsWith('owner_model_')));
  assert.equal(result.inserts.device_models.length, 0);
});

test('type attributes intersect explicit category facets, never model and never required', () => {
  const snapshot = fixture();
  const result = plan(snapshot, target);
  assert.equal(result.inserts.product_type_attributes.length, 18);
  for (const row of result.inserts.product_type_attributes) {
    assert.notEqual(row.attribute_id, 'attr_model');
    assert.equal(row.is_required, false);
    assert.equal(row.show_in_search, false);
    assert.equal(row.show_in_filters, true);
  }
  snapshot.facetDefs.push({ category_id: snapshot.categories[0].id, facet_key: 'new_sensitive_attribute', sort_order: 99 });
  const extra = plan(snapshot, target);
  assert.ok(extra.review.some(row => row.code === 'unmapped-category-facet'));
  assert.equal(extra.inserts.product_type_attributes.length, 18);
});

test('missing/inactive attributes and missing/inactive category prevent apply', () => {
  for (const modify of [s => { s.attributes[0].is_active = false; }, s => { s.categories[0].is_active = false; }, s => { s.facetDefs = s.facetDefs.filter(row => row.facet_key !== 'material'); }]) {
    const snapshot = fixture(); modify(snapshot);
    const result = plan(snapshot, target);
    assert.ok(result.conflicts.length);
    assert.throws(() => approve(result, result.digest));
  }
});

test('existing deliberately required attribute mapping is not overwritten', () => {
  const snapshot = fixture(), first = plan(snapshot, target);
  snapshot.typeAttributes.push({ ...first.inserts.product_type_attributes[0], is_required: true });
  const result = plan(snapshot, target);
  assert.ok(result.conflicts.some(row => row.code === 'type-attribute-conflict'));
  assert.throws(() => approve(result, result.digest));
});

test('missing/deleted historical products are reported without recreating products', () => {
  const snapshot = fixture();
  const missingId = snapshot.products.shift().id;
  snapshot.products[0].deleted_at = '2025-01-01';
  const result = plan(snapshot, target);
  assert.equal(result.review.filter(row => row.code === 'historical-product-missing-or-deleted').length, 2);
  assert.ok(result.review.some(row => row.id === missingId));
  assert.equal(result.counts.products.insert, 0);
  assert.equal(result.updates.length, 10);
});

test('unexpected existing type mappings, including model, block apply without deleting rows', () => {
  const snapshot = fixture();
  snapshot.typeAttributes.push({ product_type_id: HISTORICAL_TYPES[0].id, attribute_id: 'attr_model', is_active: true });
  const result = plan(snapshot, target);
  assert.ok(result.conflicts.some(row => row.code === 'unexpected-type-attribute'));
  assert.throws(() => approve(result, result.digest));
  assert.equal(snapshot.typeAttributes.length, 1);
});

test('inactive/differently branded model reference is never reactivated or moved', () => {
  const snapshot = fixture();
  Object.assign(snapshot.models[0], { is_active: false, brand_id: 'other_brand' });
  const result = plan(snapshot, target);
  assert.ok(result.conflicts.some(row => row.code === 'owner-device-reference-missing-or-ambiguous'));
  assert.throws(() => approve(result, result.digest));
  assert.equal(result.inserts.device_models.length, 0);
});

test('pre-schema dry-run still produces references/counts, but schema and RLS gate apply', () => {
  for (const schema of [{ missing: ['products.product_type_id', 'device_models.id'], rlsDisabled: [] }, { missing: [], rlsDisabled: ['device_models'] }]) {
    const snapshot = fixture(); snapshot.schema = schema;
    const result = plan(snapshot, target);
    assert.equal(result.updates.length, 12);
    assert.equal(result.inserts.product_device_models.length, 7);
    assert.throws(() => approve(result, result.digest), /schema\/RLS/);
  }
});

test('digest binds exact target and relevant full state including unprinted PAV values and schema', () => {
  const snapshot = fixture(), initial = plan(snapshot, target);
  assert.throws(() => approve(initial, '0'.repeat(64)), /mismatch/);
  assert.notEqual(plan(snapshot, 'other-host'), initial.digest);
  snapshot.values.push({ product_id: snapshot.products[0].id, attribute_id: 'attr_material', option_value: 'secret' });
  const changed = plan(snapshot, target);
  assert.notEqual(changed.digest, initial.digest);
  assert.equal(JSON.stringify(changed).includes('secret'), false);
  assert.throws(() => approve(changed, initial.digest));
  snapshot.schema.missing.push('device_models.id');
  assert.notEqual(plan(snapshot, target).digest, changed.digest);
});

test('unrelated PAV report includes only sanitized IDs/keys and archive state, never values', () => {
  const snapshot = fixture();
  snapshot.values.push({ product_id: snapshot.products[0].id, attribute_id: 'attr_connector', option_value: 'person@example.com', archived_at: null });
  snapshot.values.push({ product_id: snapshot.products[0].id, attribute_id: 'attr_model', option_value: 'iPhone 18 Pro Max', archived_at: '2025-01-01' });
  const result = plan(snapshot, target);
  assert.equal(result.unrelatedValues.length, 2);
  assert.equal(JSON.stringify(result).includes('person@example.com'), false);
  assert.deepEqual(Object.keys(result.unrelatedValues[0]).sort(), ['productId', 'attributeId', 'key', 'archived'].sort());
  assert.equal(safeBackfillId('email@example.com'), '[redacted-id]');
  assert.equal(safeBackfillId('bad\nvalue'), '[redacted-id]');
});

test('script safety contract is read-only default, max one, schema detection, explicit gated apply, writeAudit, and no seeder/CSV/DDL', async () => {
  const source = await readFile(path.join(root, 'scripts/migrate-product-compatibility.mjs'), 'utf8');
  assert.match(source, /max: 1/);
  assert.match(source, /default_transaction_read_only: args.apply \? 'off' : 'on'/);
  assert.match(source, /isolation level repeatable read read only/);
  assert.match(source, /show transaction_read_only/);
  assert.match(source, /information_schema.columns/);
  assert.match(source, /approvedHost !== url.host/);
  assert.match(source, /assertBackfillApproval\(fresh, args.approvedDigest\)/);
  assert.match(source, /role='store_owner'/);
  assert.match(source, /lock table/);
  assert.match(source, /writeAudit\(/);
  assert.doesNotMatch(source, /console\.(error|log)\([^\n]*(?:error|\.message|DATABASE_URL)/);
  assert.doesNotMatch(source, /(?:create|alter|drop|truncate)\s+table\s|seed-store-catalog|catalog-transfer|catalog-csv/i);
});

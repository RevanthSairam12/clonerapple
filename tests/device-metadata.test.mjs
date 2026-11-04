// Offline only: module imports are allowlisted and every SQL/audit call is fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const root = path.resolve('src');
function load(relative, mocks) {
  const file = path.resolve(root, relative);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, Request, Response,
    require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected offline import: ${name}`); },
  }, { filename: file });
  return module.exports;
}
const catalogRules = load('lib/store-admin/catalog-rules.ts', {});
const rules = load('lib/catalog/product-metadata-rules.ts', { '@/lib/store-admin/catalog-rules': catalogRules });
function serviceHarness() {
  const calls = [];
  const controls = { audit: true, brand: { name: 'Brand', is_active: true }, existing: null, duplicate: false, invalidVariants: false, products: [], product: { category_id: 'cases', product_type_id: null, compatibility_reviewed_at: null }, joins: [] };
  const tx = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    if (query.startsWith('insert into device_') && controls.duplicate) throw Object.assign(new Error('private SQL detail'), { code: '23505' });
    if (query.startsWith('select name from device_brands') || query.startsWith('select is_active from device_brands')) return controls.brand ? [controls.brand] : [];
    if (query.startsWith('select brand_id from device_models')) return controls.existing ? [controls.existing] : [];
    if (query.startsWith('select v.id from product_variants')) return controls.invalidVariants ? [{ id: 'variant' }] : [];
    if (query.startsWith('select id from products')) return controls.products;
    if (query.startsWith('select category_id,product_type_id,compatibility_reviewed_at')) return [controls.product];
    if (query.startsWith('select device_model_id from product_device_models')) return controls.joins;
    return [];
  };
  const service = load('lib/store-admin/product-metadata.ts', {
    'node:crypto': { randomUUID },
    '@/lib/platform/db': { getSql() { throw new Error('Offline test attempted database access'); } },
    './audit': { writeAudit: async (input, transaction) => { assert.equal(transaction, tx); calls.push({ query: 'AUDIT', input }); return controls.audit; } },
    './catalog-rules': catalogRules,
    '@/lib/catalog/product-metadata-rules': rules,
  });
  return { service, tx, calls, controls };
}
const type = { id: 'case', categoryId: 'cases', name: 'Case', isActive: true, requiresCompatibility: true, sortOrder: 0, attributes: [{ attributeId: 'flag', key: 'flag', label: 'Flag', dataType: 'boolean', isRequired: true, options: [] }] };
const refs = { types: [type], brands: [], models: [{ id: 'phone', isActive: true }] };

test('plain device creates generate IDs, gate before insertion, audit strictly and return reference', async () => {
  for (const kind of ['brands', 'models']) {
    const { service, tx, calls } = serviceHarness();
    const reference = await service.createMetadataReferenceUsing(tx, kind, { name: '  New device  ', ...(kind === 'models' ? { brandId: 'brand' } : {}) }, 'owner');
    assert.match(reference.id, /^[a-f0-9-]{36}$/);
    assert.equal(reference.name, 'New device');
    assert.equal(reference.isActive, true);
    assert.equal(reference.sortOrder, 0);
    if (kind === 'models') { assert.equal(reference.brandId, 'brand'); assert.equal(reference.brandName, 'Brand'); }
    assert.match(calls[0].query, /pg_advisory_xact_lock/);
    const insert = calls.find(call => call.query.startsWith('insert into device_'));
    assert.doesNotMatch(insert.query, /on conflict|update/i);
    assert.equal(insert.values[0], reference.id);
    assert.equal(calls.at(-1).input.entityId, reference.id);
    assert.equal(calls.at(-1).input.action, `catalog.metadata.${kind}.create`);
    assert.ok(calls.every(call => !/product_device_models|insert into products|product_variants/.test(call.query)));
  }
});

test('create whitelist and bounds reject supplied IDs, associations, malformed values and wrong kinds before SQL', async () => {
  const { service, tx, calls } = serviceHarness();
  const invalid = [null, [], { name: ' ' }, { name: 2 }, { name: 'a'.repeat(101) }, { name: 'bad\nname' }, { name: 'OK', id: 'client-id' }, { name: 'OK', productId: 'p' }, { name: 'OK', deviceModelIds: [] }, { name: 'OK', brandId: 'brand' }, { name: 'OK', isActive: 'true' }, { name: 'OK', sortOrder: '1' }, { name: 'OK', sortOrder: null }, { name: 'OK', sortOrder: 10000 }, { name: 'OK', sortOrder: -1 }, { name: 'OK', sortOrder: 0.5 }];
  for (const input of invalid) await assert.rejects(service.createMetadataReferenceUsing(tx, 'brands', input, 'owner'), rules.MetadataError);
  for (const input of [{ name: 'M' }, { name: 'M', brandId: '../bad' }, { name: 'M', brandId: 'brand', id: 'bad' }, { name: 'M'.repeat(121), brandId: 'brand' }]) await assert.rejects(service.createMetadataReferenceUsing(tx, 'models', input, 'owner'), rules.MetadataError);
  await assert.rejects(service.createMetadataReferenceUsing(tx, 'types', { name: 'T' }, 'owner'), /Only device/);
  assert.equal(calls.length, 0);
});

test('models require an active brand even for inactive creates; boundary values are accepted', async () => {
  for (const kind of ['brands', 'models']) {
    const { service, tx } = serviceHarness();
    const ref = await service.createMetadataReferenceUsing(tx, kind, { name: 'x'.repeat(kind === 'brands' ? 100 : 120), sortOrder: 9999, isActive: false, ...(kind === 'models' ? { brandId: 'brand' } : {}) }, 'owner');
    assert.equal(ref.sortOrder, 9999); assert.equal(ref.isActive, false);
  }
  const { service, tx, controls, calls } = serviceHarness();
  controls.brand = null; // Query includes `and is_active`, so absent/inactive both return no row.
  await assert.rejects(service.createMetadataReferenceUsing(tx, 'models', { name: 'M', brandId: 'off', isActive: false }, 'owner'), /active device brand/);
  assert.ok(calls.every(call => !call.query.startsWith('insert')));
});

test('create and PUT map duplicate names to clear conflicts; unexpected SQL stays unknown', async () => {
  for (const kind of ['brands', 'models']) for (const mode of ['create', 'save']) {
    const { service, tx, controls } = serviceHarness();
    controls.duplicate = true;
    const input = { name: 'Duplicate', ...(kind === 'models' ? { brandId: 'brand' } : {}) };
    const work = mode === 'create' ? service.createMetadataReferenceUsing(tx, kind, input, 'owner') : service.saveMetadataReferenceUsing(tx, kind, { ...input, id: 'existing' }, 'owner');
    await assert.rejects(work, error => error instanceof service.MetadataConflictError && /already exists/.test(error.message) && !/private/.test(error.message));
  }
});

test('PUT never reparents models and preserves active variant deactivation guard', async () => {
  const { service, tx, controls, calls } = serviceHarness();
  controls.existing = { brand_id: 'original' };
  await assert.rejects(service.saveMetadataReferenceUsing(tx, 'models', { id: 'm', name: 'M', brandId: 'other' }, 'owner'), /cannot move brands/);
  assert.ok(calls.every(call => !call.query.startsWith('insert')));
  controls.existing = { brand_id: 'original' };
  controls.invalidVariants = true;
  await assert.rejects(service.saveMetadataReferenceUsing(tx, 'models', { id: 'm', name: 'M', brandId: 'original', isActive: false }, 'owner'), /active purchasable variant/);
  const insert = calls.find(call => call.query.startsWith('insert into device_models'));
  assert.doesNotMatch(insert.query.split('do update')[1], /brand_id=/);
  assert.equal(calls.some(call => call.query === 'AUDIT'), false);
});

test('create and save audit failure propagate to transaction owner; published product guard remains', async () => {
  for (const mode of ['create', 'save']) {
    const { service, tx, controls } = serviceHarness();
    controls.audit = false;
    const work = mode === 'create' ? service.createMetadataReferenceUsing(tx, 'brands', { name: 'B' }, 'owner') : service.saveMetadataReferenceUsing(tx, 'brands', { id: 'b', name: 'B' }, 'owner');
    await assert.rejects(work, /audit could not be saved/);
  }
  const { service, tx, controls, calls } = serviceHarness();
  controls.products = [{ id: 'published' }];
  controls.product.product_type_id = 'invalid';
  await assert.rejects(service.saveMetadataReferenceUsing(tx, 'brands', { id: 'b', name: 'B' }, 'owner'), /invalidate published product/);
  assert.equal(calls.some(call => call.query === 'AUDIT'), false);
});

test('shared publication callers parse and pass the explicit effective type ID', () => {
  for (const relative of ['components/store-admin/ProductWorkflow.tsx', 'lib/store-admin/product-metadata.ts']) {
    const file = path.join(root, relative);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length, 0, `${relative} must parse`);
    let found = 0;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'publicationProblems') {
        found++;
        assert.equal(node.arguments.length, 5);
        assert.equal(node.arguments[4].getText(source), relative.endsWith('.tsx') ? 'metadata.productTypeId' : 'productTypeId');
      }
      ts.forEachChild(node, visit);
    }
    visit(source); assert.equal(found, 1);
  }
});

test('metadata state allows null type without review but flags invalid type and inactive saved devices', async () => {
  const { service, tx, controls } = serviceHarness();
  let state = await service.productMetadataUsing(tx, 'p', refs);
  assert.equal(state.productTypeId, null); assert.equal(state.needsCompatibilityReview, false); assert.equal(state.problems.length, 0);
  controls.product.product_type_id = 'missing';
  state = await service.productMetadataUsing(tx, 'p', refs);
  assert.equal(state.needsCompatibilityReview, true); assert.equal(state.problems.length, 1);
  controls.product.product_type_id = 'case';
  state = await service.productMetadataUsing(tx, 'p', refs);
  assert.equal(state.needsCompatibilityReview, true); assert.equal(state.problems.length, 2);
  controls.product.product_type_id = null;
  controls.joins = [{ device_model_id: 'off' }];
  state = await service.productMetadataUsing(tx, 'p', refs);
  assert.equal(state.needsCompatibilityReview, true); assert.equal(state.problems.length, 0);
});

function routeHarness({ serviceOverrides = {}, ruleOverrides = {} } = {}) {
  const calls = [];
  const controls = { origin: false, denied: false, error: null };
  const { service } = serviceHarness();
  const route = load('app/api/store-admin/catalog/metadata/[kind]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/platform/api-guard': { assertSameOrigin: () => controls.origin ? Response.json({}, { status: 403 }) : null },
    '@/lib/store-admin/auth': { requireStoreRole: async role => { calls.push(role); return controls.denied ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, session: { adminId: 'owner' } }; } },
    '@/lib/catalog/product-metadata-rules': { ...rules, ...ruleOverrides },
    '@/lib/store-admin/product-metadata': { MetadataConflictError: service.MetadataConflictError, createMetadataReference: async (...args) => { calls.push(args); if (controls.error) throw controls.error; return { id: 'server-id', name: 'Brand', isActive: true, sortOrder: 0 }; }, saveMetadataReference: async () => { if (controls.error) throw controls.error; }, loadMetadataEditor: async () => { if (controls.error) throw controls.error; return { references: { brands: [], models: [], types: [] } }; }, ...serviceOverrides },
    '@/lib/storefront/revalidate': { revalidateCatalog: () => calls.push('revalidate') },
  });
  return { route, controls, calls, service };
}
const ctx = kind => ({ params: Promise.resolve({ kind }) });
const request = (body = { name: 'Brand' }, method = 'POST') => new Request('https://example.test/api', { method, body: JSON.stringify(body) });

test('POST requires owner and same origin; only brand/model creates return 201 reference', async () => {
  for (const kind of ['brands', 'models']) {
    const { route, calls } = routeHarness();
    const response = await route.POST(request(), ctx(kind));
    assert.equal(response.status, 201); assert.equal((await response.json()).reference.id, 'server-id');
    assert.equal(calls[0], 'store_owner'); assert.equal(calls[1][0], kind); assert.equal(calls[1][2], 'owner'); assert.equal(calls.at(-1), 'revalidate');
  }
  for (const control of ['origin', 'denied']) {
    const { route, calls, controls } = routeHarness(); controls[control] = true;
    assert.equal((await route.POST(request(), ctx('brands'))).status, 403);
    assert.ok(calls.every(call => !Array.isArray(call) && call !== 'revalidate'));
  }
  const { route, calls } = routeHarness();
  assert.equal((await route.POST(request(), ctx('types'))).status, 400);
  assert.equal((await route.POST(new Request('https://example.test/api', { method: 'POST', body: '{' }), ctx('brands'))).status, 400);
  assert.ok(calls.every(call => !Array.isArray(call) && call !== 'revalidate'));
});

test('missing or incompatible error-class exports never replace the original failure with instanceof errors', async () => {
  const hostile = function () {};
  Object.defineProperty(hostile, Symbol.hasInstance, { value() { throw new Error('private incompatible class detail'); } });
  for (const candidate of [undefined, null, {}, () => {}, hostile]) {
    for (const method of ['GET', 'POST', 'PUT']) {
      const { route, controls, calls } = routeHarness({ serviceOverrides: { MetadataConflictError: candidate }, ruleOverrides: { MetadataError: candidate } });
      controls.error = new Error('private database connection detail');
      const response = await route[method](method === 'GET' ? new Request('https://example.test/api') : request({}, method), ctx('brands'));
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(typeof body.error, 'string');
      assert.doesNotMatch(body.error, /private|instanceof|export/);
      assert.equal(calls.includes('revalidate'), false);
    }
  }
});

test('missing service functions fail closed with sanitized JSON and no mutation or revalidation', async () => {
  for (const [method, name] of [['GET', 'loadMetadataEditor'], ['POST', 'createMetadataReference'], ['PUT', 'saveMetadataReference']]) {
    const { route, calls } = routeHarness({ serviceOverrides: { [name]: undefined, MetadataConflictError: undefined } });
    const response = await route[method](method === 'GET' ? new Request('https://example.test/api') : request({}, method), ctx('brands'));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /export|instanceof|TypeError/);
    assert.ok(calls.every(call => typeof call === 'string' && call !== 'revalidate'));
  }
});

test('canonical validation export still returns 400 when the conflict class export is missing', async () => {
  for (const method of ['GET', 'POST', 'PUT']) {
    const { route, controls } = routeHarness({ serviceOverrides: { MetadataConflictError: undefined } });
    controls.error = new rules.MetadataError('Select an active device brand.');
    const response = await route[method](method === 'GET' ? new Request('https://example.test/api') : request({}, method), ctx('brands'));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Select an active device brand.');
  }
});

test('conflict export returns 409 independently of a missing validation class', async () => {
  const { route, controls, service } = routeHarness({ ruleOverrides: { MetadataError: undefined } });
  controls.error = new service.MetadataConflictError('A device brand with this name already exists.');
  const response = await route.POST(request(), ctx('brands'));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'A device brand with this name already exists.');
});

test('POST/PUT expose clear 409 duplicates and redact unknown failures as 503 without revalidation', async () => {
  for (const method of ['POST', 'PUT']) for (const status of [400, 409, 503]) {
    const { route, calls, controls, service } = routeHarness();
    controls.error = status === 409 ? new service.MetadataConflictError('A device brand with this name already exists.') : status === 400 ? new rules.MetadataError('Select an active device brand.') : new Error('private connection detail');
    const response = await route[method](request({}, method), ctx('brands'));
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private connection/);
    assert.equal(calls.includes('revalidate'), false);
  }
});

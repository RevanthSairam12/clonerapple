import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const root = path.resolve('src');
function load(relative, mocks = {}) {
  const file = path.resolve(root, relative);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, Request, Response, URL,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), `${name}.tsx`)), mocks);
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, mocks);
      return require(name);
    },
  }, { filename: file });
  return module.exports;
}
const attribute = { attributeId: 'capacity', key: 'capacity', label: 'Capacity', dataType: 'number', options: [], isRequired: true, sortOrder: 0, showInSpecs: true, showInFilters: false, showInSearch: false };
const references = { types: [{ id: 'bank', categoryId: 'power', name: 'Power bank', requiresCompatibility: false, isActive: true, sortOrder: 0, attributes: [attribute] }], brands: [{ id: 'device-brand', name: 'Device brand', isActive: true, sortOrder: 0 }], models: [{ id: 'phone', name: 'Phone', brandId: 'device-brand', brandName: 'Device brand', isActive: true, sortOrder: 0 }] };
const fields = load('components/store-admin/ProductMetadataFields.tsx');

test('metadata drafts never auto-select a product type or compatible models', () => {
  const draft = fields.emptyMetadataDraft();
  assert.equal(draft.productTypeId, null);
  assert.equal(draft.deviceModelIds.length, 0);
  const html = renderToStaticMarkup(React.createElement(fields.ProductMetadataFields, { references, categoryId: 'power', value: draft, onChange() {} }));
  assert.match(html, /No type selected \(optional\)/);
  assert.doesNotMatch(html, /checked=""/);
  assert.doesNotMatch(html, />Capacity/);
});

test('metadata payload includes only selected category/type mapped values, retaining false and zero', () => {
  const draft = { productTypeId: 'bank', deviceModelIds: ['phone'], attributeValues: { capacity: 0, legacy: false } };
  const input = fields.scopedMetadataInput(draft, references, 'power');
  assert.equal(input.attributeValues.capacity, 0);
  assert.equal('legacy' in input.attributeValues, false);
  assert.equal(draft.attributeValues.legacy, false, 'scope changes must not discard local state');
  assert.equal(Object.keys(fields.scopedMetadataInput(draft, references, 'other').attributeValues).length, 0);
});

test('archived values are read-only with explicit Restore and Clear, scope-hidden stays distinct', () => {
  const { ProductAttributes } = load('components/store-admin/ProductAttributes.tsx');
  const savedValues = [{ attributeId: 'capacity', key: 'capacity', label: 'Capacity', value: 0, archived: true, applicable: true }, { attributeId: 'legacy', key: 'legacy', label: 'Legacy flag', value: false, archived: false, applicable: false }];
  const html = renderToStaticMarkup(React.createElement(ProductAttributes, { attributes: [attribute], savedValues, changes: {}, disabled: false, onChange() {} }));
  assert.match(html, /Restore saved value/);
  assert.match(html, />Clear</);
  assert.match(html, /false · for another product type/);
  assert.match(html, /value=""/);
});

test('viewers have no attribute mutation controls', () => {
  const { ProductAttributes } = load('components/store-admin/ProductAttributes.tsx');
  const html = renderToStaticMarkup(React.createElement(ProductAttributes, { attributes: [attribute], savedValues: [], changes: {}, disabled: true, onChange() {} }));
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, />Clear</);
});

function routeHarness(relative) {
  const calls = [];
  const controls = { denied: false, origin: false, error: null };
  const rules = load('lib/catalog/product-metadata-rules.ts');
  const route = load(relative, {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/platform/api-guard': { assertSameOrigin: () => controls.origin ? Response.json({ error: 'Origin' }, { status: 403 }) : null },
    '@/lib/store-admin/auth': { requireStoreRole: async role => { calls.push(['role', role]); return controls.denied ? { ok: false, response: Response.json({ error: 'Denied' }, { status: 403 }) } : { ok: true, session: { adminId: 'staff' } }; } },
    '@/lib/catalog/product-metadata-rules': rules,
    '@/lib/store-admin/product-metadata': {
      ...rules,
      MetadataConflictError: class extends rules.MetadataError {},
      loadMetadataEditor: async () => { if (controls.error) throw controls.error; return { references, state: null }; },
      updateProductMetadata: async (...args) => { calls.push(['update', ...args]); if (controls.error) throw controls.error; },
      saveMetadataReference: async (...args) => { calls.push(['save', ...args]); if (controls.error) throw controls.error; },
    },
    '@/lib/storefront/revalidate': { revalidateCatalog: id => calls.push(['invalidate', id]) },
  });
  return { route, calls, controls, MetadataError: rules.MetadataError };
}
const metadataRoute = 'app/api/store-admin/catalog/products/[id]/metadata/route.ts';
const referenceRoute = 'app/api/store-admin/catalog/metadata/[kind]/route.ts';
const context = { params: Promise.resolve({ id: 'product', kind: 'types' }) };
const request = (body, method = 'PATCH') => new Request('https://example.test/api', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

test('product metadata PATCH passes classification and status atomically and invalidates after service', async () => {
  const { route, calls } = routeHarness(metadataRoute);
  const response = await route.PATCH(request({ productTypeId: 'bank', deviceModelIds: [], attributeValues: { capacity: null }, categoryId: 'power', isActive: false }), context);
  assert.equal(response.status, 200);
  const update = calls.find(call => call[0] === 'update');
  assert.equal(update[1], 'product');
  assert.equal(update[2].attributeValues.capacity, null);
  assert.equal(update[5].categoryId, 'power');
  assert.equal(update[5].isActive, false);
  assert.deepEqual(calls.map(call => call[0]), ['role', 'update', 'invalidate']);
  assert.equal(calls[0][1], 'store_admin');
});

test('metadata writes reject invalid primitive/publication bodies without calling the service', async () => {
  for (const body of [{ attributeValues: { capacity: {} } }, { isActive: 'yes' }, { categoryId: '../wrong' }, null]) {
    const { route, calls } = routeHarness(metadataRoute);
    assert.equal((await route.PATCH(request(body), context)).status, 400);
    assert.equal(calls.some(call => call[0] === 'update'), false);
  }
});

test('write role and same-origin failures prevent writes and invalidation', async () => {
  for (const control of ['origin', 'denied']) {
    const { route, calls, controls } = routeHarness(metadataRoute);
    controls[control] = true;
    assert.equal((await route.PATCH(request({}), context)).status, 403);
    assert.equal(calls.some(call => ['update', 'invalidate'].includes(call[0])), false);
  }
});

test('unknown SQL errors are redacted 503 and known validation errors are 400 with no invalidation', async () => {
  for (const known of [false, true]) {
    const { route, controls, calls, MetadataError } = routeHarness(metadataRoute);
    controls.error = known ? new MetadataError('Choose a product type.') : new Error('raw SQL connection detail');
    const response = await route.PATCH(request({}), context);
    assert.equal(response.status, known ? 400 : 503);
    assert.doesNotMatch(await response.text(), /raw SQL/);
    assert.equal(calls.some(call => call[0] === 'invalidate'), false);
  }
});

test('reference writes require owner and recognized kinds; viewer GET uses read guard', async () => {
  const { route, calls } = routeHarness(referenceRoute);
  assert.equal((await route.PUT(request({ id: 'bank' }, 'PUT'), context)).status, 200);
  assert.equal(calls[0][1], 'store_owner');
  assert.equal(calls.find(call => call[0] === 'save')[1], 'types');
  assert.equal((await route.GET(new Request('https://example.test/api'), { params: Promise.resolve({ kind: 'unknown' }) })).status, 400);
  assert.equal(calls.at(-1)[1], 'store_viewer');
});

test('new product defaults to draft and metadata keys are integrated at the top level', () => {
  const create = readFileSync(path.join(root, 'components/store-admin/ProductCreateForm.tsx'), 'utf8');
  assert.match(create, /<ProductWorkflow/);
  const source = readFileSync(path.join(root, 'components/store-admin/ProductWorkflow.tsx'), 'utf8');
  assert.match(source, /isActive: product\?\.isActive \?\? false/);
  assert.match(source, /const metadataInput = scopedMetadataInput\(metadata, metadataReferences, form.categoryId\)/);
  assert.match(source, /metadata: metadataPayload/);
  const editor = readFileSync(path.join(root, 'components/store-admin/ProductEditor.tsx'), 'utf8');
  assert.doesNotMatch(editor, /patch\.category_id|patch\.is_active/);
  assert.match(editor, /\/duplicate/);
  assert.match(editor, /Fresh unique slug/);
  assert.match(source, /window\.confirm\('Change category/);
  const metadataFields = readFileSync(path.join(root, 'components/store-admin/ProductMetadataFields.tsx'), 'utf8');
  const metadataEditor = readFileSync(path.join(root, 'components/store-admin/ProductMetadataEditor.tsx'), 'utf8');
  assert.match(metadataFields, /window\.confirm\('Change product type/);
  assert.match(metadataEditor, /window\.confirm\('Change category/);
  assert.match(metadataEditor, /productTypeId: null/);
});

test('metadata reference manager renders all reference groups but locks mutations for non-owners', () => {
  const { MetadataReferenceManager } = load('components/store-admin/MetadataReferenceManager.tsx', { 'next/navigation': { useRouter: () => ({ refresh() {} }) } });
  const html = renderToStaticMarkup(React.createElement(MetadataReferenceManager, { references, categories: [{ id: 'power', name: 'Power' }], attributes: [], canEdit: false }));
  for (const group of ['Product types', 'Device brands', 'Device models', 'Type attribute mappings']) assert.ok(html.includes(group));
  assert.match(html, /Only store owners/);
  assert.doesNotMatch(html, />Save reference</);
  assert.doesNotMatch(html, />Edit</);
});

test('reference write and product read endpoints redact unexpected failures', async () => {
  for (const relative of [referenceRoute, metadataRoute]) {
    const { route, controls } = routeHarness(relative);
    controls.error = new Error('private SQL details');
    const response = await route.GET(new Request('https://example.test/api'), context);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private SQL/);
  }
  const { route, calls, controls } = routeHarness(referenceRoute);
  controls.origin = true;
  assert.equal((await route.PUT(request({ id: 'bank' }, 'PUT'), context)).status, 403);
  assert.equal(calls.length, 0);
});

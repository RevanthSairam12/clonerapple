// Offline only: all imports are allowlisted stubs, SQL is an in-memory recorder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  const queries = [];
  const controls = { parent: true, image: true, archived: true };
  const tx = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    queries.push({ query, values });
    if (query.startsWith('select 1 from products')) return controls.parent ? [{}] : [];
    if (query.startsWith('select * from product_images')) return controls.image ? [{ id: 'image', role: 'primary', deleted_at: controls.archived ? 'archived' : null }] : [];
    if (/^(insert into|update) product_images/.test(query)) return [{ id: 'image', product_id: 'product', role: 'primary' }];
    throw new Error(`Unexpected offline query: ${query}`);
  };
  const sql = { begin: callback => callback(tx) };
  const mocks = {
    'node:crypto': { randomUUID: () => 'fake-uuid' },
    '@/lib/platform/db': { getSql: () => sql },
    './product-metadata': {},
    '@/lib/catalog/product-metadata-rules': {},
    './catalog-rules': {},
    './catalog': { mapImageRow: row => row },
  };
  const file = path.resolve('src/lib/store-admin/catalog-writes.ts');
  const module = { exports: {} };
  const source = readFileSync(file, 'utf8');
  assert.equal(ts.createSourceFile(file, source, ts.ScriptTarget.Latest).parseDiagnostics.length, 0);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, console,
    require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected offline import: ${name}`); },
  }, { filename: file });
  return { service: module.exports, queries, controls };
}
const image = { url: '/image.png', alt: 'Product', role: 'primary', sort_order: 0 };
function invoke(service, action) {
  return action === 'addProductImage' ? service[action]('product', image) : action === 'updateProductImage' ? service[action]('product', 'image', image) : service[action]('product', 'image');
}
const actions = ['addProductImage', 'updateProductImage', 'archiveProductImage', 'restoreProductImage'];
for (const action of actions) {
  test(`${action} locks live parent before any child lock or mutation`, async () => {
    const { service, queries } = harness();
    const result = await invoke(service, action);
    assert.equal(result.ok, true);
    assert.match(queries[0].query, /^select 1 from products .*deleted_at is null for update$/);
    assert.deepEqual(queries[0].values, ['product']);
    assert.ok(queries.slice(1).every(call => /product_images/.test(call.query)));
    assert.ok(queries.some(call => /^(insert into|update) product_images/.test(call.query)));
    if (action !== 'addProductImage') assert.match(queries[1].query, /^select \* from product_images .*for update$/);
  });
  test(`${action} stops at missing/archived parent without touching images`, async () => {
    const { service, queries, controls } = harness();
    controls.parent = false;
    const result = await invoke(service, action);
    assert.equal(result.ok, false); assert.equal(result.reason, 'not-found');
    assert.equal(queries.length, 1);
  });
}
test('image-not-found and restore-not-archived guards survive parent-first locking', async () => {
  for (const action of actions.filter(action => action !== 'addProductImage')) {
    const { service, queries, controls } = harness(); controls.image = false;
    const result = await invoke(service, action);
    assert.equal(result.reason, 'not-found'); assert.equal(queries.length, 2);
  }
  const { service, queries, controls } = harness(); controls.archived = false;
  const result = await invoke(service, 'restoreProductImage');
  assert.equal(result.reason, 'conflict'); assert.equal(queries.length, 2);
});

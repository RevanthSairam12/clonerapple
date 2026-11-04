import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';

let allowed = true;
let originAllowed = true;
let saved = [];
let saveError = null;
let refreshFails = false;
const result = { ok: true, product: { id: 'product', created: false }, optionIds: {}, warnings: [] };
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.resolve('src') }, virtualModules: {
  '@/lib/platform/api-guard': { assertSameOrigin: () => originAllowed ? null : new Response('Forbidden', { status: 403 }) },
  '@/lib/store-admin/auth': { requireStoreRole: async role => { assert.equal(role, 'store_admin'); return allowed ? { ok: true, session: { adminId: 'staff' } } : { ok: false, response: new Response('Forbidden', { status: 403 }) }; } },
  '@/lib/store-admin/product-draft': { ProductDraftError: class extends Error {}, saveProductDraft: async (...args) => { saved.push(args); if (saveError) throw saveError; return result; } },
  '@/lib/store-admin/product-metadata': { MetadataError: class extends Error {} },
  '@/lib/storefront/revalidate': { revalidateCatalog: () => { if (refreshFails) throw new Error('Cache unavailable'); } },
} });
const { POST } = await jiti.import(path.resolve('src/app/api/store-admin/catalog/products/draft/route.ts'));
const request = body => new Request('http://localhost/api/store-admin/catalog/products/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
function reset() { allowed = originAllowed = true; saved = []; saveError = null; refreshFails = false; result.product.created = false; }

test('atomic draft route denies foreign-origin and viewer requests before any write', async () => {
  reset(); originAllowed = false;
  assert.equal((await POST(request('{}'))).status, 403);
  assert.equal(saved.length, 0);
  originAllowed = true; allowed = false;
  assert.equal((await POST(request('{}'))).status, 403);
  assert.equal(saved.length, 0);
});
test('atomic draft route rejects malformed JSON before saving', async () => {
  reset();
  assert.equal((await POST(request('{'))).status, 400);
  assert.equal(saved.length, 0);
});
test('atomic draft route passes trusted actor and request to one save and returns create status', async () => {
  reset(); result.product.created = true;
  const req = request('{"product":{"name":"Case"}}');
  const response = await POST(req);
  assert.equal(response.status, 201);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], [{ product: { name: 'Case' } }, 'staff', req]);
});
test('post-commit cache failure never tells staff the transaction rolled back', async () => {
  reset(); refreshFails = true;
  const response = await POST(request('{}'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(saved.length, 1);
});
test('unexpected save failure returns no partial success or leaked details', async () => {
  reset(); saveError = new Error('Private database detail');
  const response = await POST(request('{}'));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /No draft changes were committed/);
  assert.doesNotMatch(body.error, /Private/);
});

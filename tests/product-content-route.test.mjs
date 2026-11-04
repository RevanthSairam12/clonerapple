import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let allowed = true, sameOrigin = true, failRefresh = false, serviceError = null;
let calls = [], roles = [];
class ProductContentError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') }, virtualModules: {
  '@/lib/platform/api-guard': { assertSameOrigin: () => sameOrigin ? null : new Response('Forbidden', { status: 403 }) },
  '@/lib/store-admin/auth': { requireStoreRole: async role => { roles.push(role); return allowed ? { ok: true, session: { adminId: 'trusted-staff' } } : { ok: false, response: new Response('Forbidden', { status: 403 }) }; } },
  '@/lib/store-admin/product-content': {
    ProductContentError,
    productContentHistory: async (...args) => { calls.push(args); if (serviceError) throw serviceError; return { revisions: [], latestRevision: null }; },
    restoreProductContent: async (...args) => { calls.push(args); if (serviceError) throw serviceError; return { changed: true, revisionId: 'new' }; },
  },
  '@/lib/storefront/revalidate': { revalidateCatalog: () => { if (failRefresh) throw new Error('cache failed'); } },
} });
const { GET } = await jiti.import(path.join(root, 'src/app/api/store-admin/catalog/products/[id]/content-history/route.ts'));
const { POST } = await jiti.import(path.join(root, 'src/app/api/store-admin/catalog/products/[id]/content-history/restore/route.ts'));
const context = { params: Promise.resolve({ id: 'product' }) };
const request = body => new Request('http://localhost/api/store-admin/catalog/products/product/content-history/restore', { method: 'POST', body });
function reset() { allowed = sameOrigin = true; failRefresh = false; serviceError = null; calls = []; roles = []; }
test('history requires viewer role, is private/no-store, and denies before loading', async () => {
  reset();
  const response = await GET(new Request('http://localhost/history'), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(roles, ['store_viewer']);
  assert.deepEqual(calls, [['product']]);
  allowed = false; calls = [];
  assert.equal((await GET(new Request('http://localhost/history'), context)).status, 403);
  assert.equal(calls.length, 0);
});
test('restore denies foreign origin and insufficient role before mutation', async () => {
  reset(); sameOrigin = false;
  assert.equal((await POST(request('{}'), context)).status, 403);
  assert.equal(calls.length, 0);
  assert.equal(roles.length, 0);
  sameOrigin = true; allowed = false;
  assert.equal((await POST(request('{}'), context)).status, 403);
  assert.deepEqual(roles, ['store_admin']);
  assert.equal(calls.length, 0);
});
test('restore rejects malformed bodies and user-supplied actor/source/prose', async () => {
  for (const body of ['{', 'null', '[]', '{}', '{"revisionId":"../bad"}', '{"revisionId":"r","staffId":"other"}', '{"revisionId":"r","source":"csv_import"}', '{"revisionId":"r","descriptionSections":[]}', '{"revisionId":"r","expectedContentRevision":7}', '{"revisionId":"r","snapshot":"unknown"}']) {
    reset();
    assert.equal((await POST(request(body), context)).status, 400);
    assert.equal(calls.length, 0);
  }
});
test('restore uses authenticated actor, passes expected revision/snapshot, and cache failure cannot undo success', async () => {
  reset(); failRefresh = true;
  const req = request('{"revisionId":"r-old","expectedContentRevision":"r-current","snapshot":"before"}');
  const response = await POST(req, context);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ['product', 'r-old', 'trusted-staff', { request: req, expectedRevision: 'r-current', snapshot: 'before' }]);
  assert.deepEqual(await response.json(), { ok: true, changed: true, revisionId: 'new' });
});
test('restore conflicts are actionable while unexpected DB failures never leak internals', async () => {
  reset(); serviceError = new ProductContentError('Reload history.', 409);
  assert.equal((await POST(request('{"revisionId":"r"}'), context)).status, 409);
  serviceError = new Error('secret internal database connection');
  const response = await POST(request('{"revisionId":"r"}'), context);
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /secret|connection/);
});

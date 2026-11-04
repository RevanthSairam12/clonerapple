import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadRoute(file, { shared = null, legacy = null } = {}) {
  const queries = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?');
    queries.push({ query, values });
    if (query.includes('from store_media')) {
      if (query.includes('deleted_at is null') && shared?.deleted_at) return [];
      return shared ? [shared] : [];
    }
    if (query.includes('from media')) return legacy ? [legacy] : [];
    throw new Error('Unexpected query');
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Response, Uint8Array, console,
    require(name) {
      if (name === '@/lib/platform/db') return { getSql: () => sql };
      if (name === '@/lib/platform/storage') return { publicObjectUrl: path => `https://media.example.test/${path}` };
      if (name === '@/lib/website/legacy-gone') return { legacyAdminGone: () => new Response('This admin panel has moved to Store Admin', { status: 410, headers: { 'Cache-Control': 'no-store' } }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { ...module.exports, queries };
}

const oldRoute = 'src/app/api/admin/media/[id]/route.ts';
const newRoute = 'src/app/api/media/[id]/route.ts';
const request = id => new Request(`https://shop.example.test/api/media/${id}`);
const context = id => ({ params: Promise.resolve({ id }) });

for (const file of [oldRoute, newRoute]) {
  test(`${file}: shared storage object resolves without an admin session`, async () => {
    const route = loadRoute(file, { shared: { storage_path: 'fixture.webp', deleted_at: null } });
    const response = await route.GET(request('shared-id'), context('shared-id'));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://media.example.test/fixture.webp');
    assert.deepEqual(route.queries[0].values, ['shared-id']);
  });
  test(`${file}: archived and absent uploads do not resolve`, async () => {
    for (const shared of [null, { storage_path: 'archived.webp', deleted_at: new Date() }]) {
      const route = loadRoute(file, { shared });
      assert.equal((await route.GET(request('missing-id'), context('missing-id'))).status, 404);
    }
  });
}

test('legacy media URL mutations return 410 without touching the database', async () => {
  const route = loadRoute(oldRoute);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await route[method]();
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(route.queries.length, 0);
});

test('legacy storage rows still resolve through the old URL', async () => {
  const route = loadRoute(oldRoute, { legacy: { storage_path: 'legacy.webp' } });
  const response = await route.GET(request('legacy-id'), context('legacy-id'));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://media.example.test/legacy.webp');
  assert.deepEqual(route.queries[1].values, ['legacy-id']);
});

test('legacy byte uploads retain inert content headers', async () => {
  const route = loadRoute(oldRoute, { legacy: { data: new Uint8Array([1, 2, 3]), mime_type: 'image/svg+xml' } });
  const response = await route.GET(request('bytes-id'), context('bytes-id'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test('an archived shared row cannot fall through to a legacy row', async () => {
  const route = loadRoute(oldRoute, {
    shared: { storage_path: 'gone.webp', deleted_at: new Date() },
    legacy: { storage_path: 'legacy.webp' },
  });
  assert.equal((await route.GET(request('same-id'), context('same-id'))).status, 404);
  assert.equal(route.queries.length, 1);
});

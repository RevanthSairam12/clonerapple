import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { createJiti } from 'jiti';

const require = createRequire(import.meta.url);

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      URL,
      crypto: webcrypto,
      ...globals,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('.') || name.startsWith('@/')) {
          const base = name.startsWith('@/')
            ? path.resolve('src', name.slice(2))
            : path.resolve(path.dirname(file), name);
          const target = ['.ts', '.tsx', '']
            .map((extension) => base + extension)
            .find((candidate) => existsSync(candidate));
          return load(target, mocks, globals);
        }
        return require(name);
      },
    },
    { filename: file },
  );
  return module.exports;
}

/**
 * The real auth module, with only the session lookup replaced. This proves the
 * actual role ranking used by every store-admin route, not a copy of it.
 */
let currentRole = 'store_viewer';
let signedIn = true;
const auth = load(path.resolve('src/lib/store-admin/auth.ts'), {
  'next/headers': { cookies: async () => ({ get: () => (signedIn ? { value: 'session-token' } : undefined) }) },
  'next/navigation': { redirect: () => {} },
  '@/lib/platform/db': {
    getSql: () => async () => [
      {
        id: 'staff-1',
        email: 'staff@example.test',
        name: 'Staff',
        role: currentRole,
        must_change_password: false,
      },
    ],
  },
  '@/lib/platform/client-ip': { clientIp: async () => '127.0.0.1' },
  '@/lib/store-admin/totp': { verifySecondFactor: async () => true },
}, { process });

test('the real role gate allows admins and owners but denies viewers for price edits', async () => {
  for (const [role, expected] of [
    ['store_viewer', 403],
    ['store_admin', 200],
    ['store_owner', 200],
  ]) {
    currentRole = role;
    const guard = await auth.requireStoreRole('store_admin');
    if (expected === 200) {
      assert.equal(guard.ok, true, `${role} passes the store_admin requirement`);
      assert.equal(guard.session.role, role);
    } else {
      assert.equal(guard.ok, false, `${role} is denied`);
      assert.equal(guard.response.status, 403);
    }
  }
  signedIn = false;
  assert.equal((await auth.requireStoreRole('store_admin')).response.status, 401, 'no session is unauthenticated');
  signedIn = true;
});

const upserts = [];
const draftSaves = [];
const audits = [];

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.resolve('src') },
  virtualModules: {
    '@/lib/platform/api-guard': { assertSameOrigin: () => null },
    '@/lib/store-admin/auth': auth,
    '@/lib/store-admin/audit': {
      writeAudit: async (entry) => {
        audits.push(entry);
      },
    },
    '@/lib/store-admin/catalog-crud': {
      upsertVariant: async (id, value, actorId) => {
        upserts.push([id, value, actorId]);
        return {
          ok: true,
          data: { created: false, before: {}, after: { pricePaise: value.priceOverridePaise }, warnings: [] },
        };
      },
    },
    '@/lib/store-admin/catalog-writes': { catalogFailureStatus: () => 409 },
    '@/lib/store-admin/product-draft': {
      ProductDraftError: class extends Error {},
      saveProductDraft: async (...args) => {
        draftSaves.push(args);
        return { ok: true, product: { id: 'product', created: false } };
      },
    },
    '@/lib/store-admin/product-metadata': { MetadataError: class extends Error {} },
    '@/lib/store-admin/product-content': { ProductContentError: class extends Error {} },
    '@/lib/store-admin/catalog-revision': { CatalogRevisionError: class extends Error {} },
    '@/lib/store-admin/variant-identity': { VariantIdentityError: class extends Error {} },
    '@/lib/storefront/revalidate': { revalidateCatalog: () => {} },
  },
});

const variantRoute = await jiti.import(
  path.resolve('src/app/api/store-admin/catalog/products/[id]/variants/route.ts'),
);
const draftRoute = await jiti.import(path.resolve('src/app/api/store-admin/catalog/products/draft/route.ts'));

function reset() {
  upserts.length = 0;
  draftSaves.length = 0;
  audits.length = 0;
  currentRole = 'store_viewer';
}

const optionPrice = {
  sku: 'CASE-BLACK',
  optionName: 'Colour',
  optionValue: 'Black',
  priceOverridePaise: 12000,
  salePricePaise: 10000,
  confirmLargeChange: false,
};

function post(route, body, url) {
  return route.POST(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'product' }) },
  );
}

test('the variants API rejects a viewer before any option price is written', async () => {
  reset();
  const response = await post(variantRoute, optionPrice, 'http://localhost/api/store-admin/catalog/products/product/variants');
  assert.equal(response.status, 403);
  assert.equal(upserts.length, 0, 'no service call and no price history for a viewer');
  assert.equal(audits.length, 0);
});

test('the variants API lets a store admin and a store owner write option price and sale price', async () => {
  for (const role of ['store_admin', 'store_owner']) {
    reset();
    currentRole = role;
    const response = await post(variantRoute, optionPrice, 'http://localhost/api/store-admin/catalog/products/product/variants');
    assert.equal(response.status, 200, `${role} may edit option pricing`);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0][0], 'product');
    assert.equal(upserts[0][1].priceOverridePaise, 12000);
    assert.equal(upserts[0][1].salePricePaise, 10000);
    assert.equal(upserts[0][2], 'staff-1', 'the trusted session actor is passed, never a body value');
    assert.equal(audits.length, 1, 'a successful option save is audited');
  }
});

test('the atomic draft API rejects a viewer before any product or option write', async () => {
  reset();
  const response = await post(
    draftRoute,
    { product: { name: 'Case' }, options: [{ ...optionPrice, priceOverridePaise: 9900 }] },
    'http://localhost/api/store-admin/catalog/products/draft',
  );
  assert.equal(response.status, 403);
  assert.equal(draftSaves.length, 0);
});

test('the atomic draft API lets a store admin save option prices and sales', async () => {
  reset();
  currentRole = 'store_admin';
  const response = await post(
    draftRoute,
    { product: { name: 'Case' }, options: [{ ...optionPrice, priceOverridePaise: 9900 }] },
    'http://localhost/api/store-admin/catalog/products/draft',
  );
  assert.equal(response.status, 200);
  assert.equal(draftSaves.length, 1);
  assert.equal(draftSaves[0][0].options[0].priceOverridePaise, 9900);
});

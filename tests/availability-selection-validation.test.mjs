import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const module = { exports: {} };
let reads = 0;
const source = ts.transpileModule(readFileSync('src/app/api/catalog/availability/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mocks = {
  'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
  '@/lib/platform/api-guard': { assertSameOrigin: () => null },
  '@/lib/platform/db': { getSql: () => { reads++; return 'injected-only'; } },
  '@/lib/storefront/availability-rules': { toPublicAvailability: read => read },
  '@/lib/storefront/availability-server': { readAvailabilityUsing: async (_sql, _ids, lines) => ({ products: lines }) },
  '@/lib/storefront/maintenance-guard': { requireStorefrontOpen: async () => null },
  '@/lib/payu/rate-limit': { checkRateLimit: () => ({ allowed: true }) },
};
vm.runInNewContext(source, { module, exports: module.exports, URL, console, require(name) {
  if (!(name in mocks)) throw Error(`Unexpected backend import: ${name}`);
  return mocks[name];
} });
const get = variantId => module.exports.GET(new Request(`https://offline.test/api/catalog/availability?lines=${encodeURIComponent(JSON.stringify([{ productId: 'p', variantId, quantity: 1 }]))}`));
test('availability accepts same bounded legacy variant IDs as checkout without rewriting', async () => {
  const id = 'legacy-'.repeat(30);
  const response = await get(id);
  assert.equal(response.status, 200);
  assert.equal(response.body.products[0].variantId, id);
});
test('availability rejects malformed variant identifiers before any database seam', async () => {
  const before = reads;
  for (const id of ['', ' ', 7, {}, 'v'.repeat(257)]) assert.equal((await get(id)).status, 400);
  assert.equal(reads, before);
});

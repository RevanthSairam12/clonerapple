import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const rules = await jiti.import(path.resolve('src/lib/website/homepage-products.ts'));
const boundary = await jiti.import(path.resolve('src/lib/website/boundary.ts'));
const collections = await jiti.import(path.resolve('src/lib/website/collections.ts'));
const source = ts.transpileModule(readFileSync('src/app/api/store-admin/website/content/[key]/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ available = ['a', 'b', 'c', 'd'], authorized = true, sameOrigin = true } = {}) {
  const calls = { saves: [], audits: [], paths: [], roles: [] };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (name === 'next/cache') return { revalidatePath: value => calls.paths.push(value) };
      if (name === 'next/server') return { NextResponse: { json: (value, options) => Response.json(value, options) } };
      if (name === '@/lib/content') return { getContentRaw: async () => null };
      if (name === '@/lib/platform/api-guard') return { assertSameOrigin: () => sameOrigin ? null : Response.json({}, { status: 403 }) };
      if (name === '@/lib/store-admin/audit') return { writeAudit: async value => calls.audits.push(value) };
      if (name === '@/lib/store-admin/auth') return { requireStoreRole: async role => {
        calls.roles.push(role);
        return authorized ? { ok: true, session: { adminId: 'owner', email: 'owner@example.test', name: 'Owner' } } : { ok: false, response: Response.json({}, { status: 403 }) };
      } };
      if (name === '@/lib/website/boundary') return boundary;
      if (name === '@/lib/website/collections') return collections;
      if (name === '@/lib/website/homepage-products') return rules;
      if (name === '@/lib/catalog/storefront') return { getStorefrontProducts: async ids => ids.filter(id => available.includes(id)).map(id => ({ id })) };
      if (name === '@/lib/website/content-store') return { saveContentBlock: async (key, value) => { calls.saves.push({ key, value }); return { ok: true }; } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { calls, save: value => module.exports.PUT(new Request('https://example.test/api', { method: 'PUT', body: JSON.stringify({ value }) }), { params: Promise.resolve({ key: 'gadzio.diwali_campaign' }) }) };
}
const selection = { items: ['a', 'b', 'c', 'd'].map(productId => ({ productId })) };

test('valid homepage selection saves ordered references and revalidates homepage', async () => {
  const app = harness();
  assert.equal((await app.save(selection)).status, 200);
  assert.deepEqual(app.calls.saves[0].value, selection);
  assert.deepEqual(app.calls.roles, ['store_owner']);
  assert.ok(app.calls.paths.includes('/'));
  assert.equal(app.calls.audits[0].status, 'ok');
});

test('invalid counts, duplicates, copied prices and unavailable catalog IDs never persist', async () => {
  for (const value of [
    { items: selection.items.slice(1) },
    { items: [...selection.items.slice(0, 3), { productId: 'a' }] },
    { items: [...selection.items.slice(0, 3), { productId: 'retired' }] },
    { items: [{ productId: 'a', price: 1 }, ...selection.items.slice(1)] },
  ]) {
    const app = harness();
    assert.equal((await app.save(value)).status, 400);
    assert.equal(app.calls.saves.length, 0);
    assert.equal(app.calls.audits[0].status, 'denied');
    assert.equal(app.calls.paths.length, 0);
  }
  const app = harness({ available: [] });
  assert.equal((await app.save(selection)).status, 400);
  assert.equal(app.calls.saves.length, 0);
});

test('unauthorized and cross-origin saves cannot persist homepage selections', async () => {
  for (const options of [{ authorized: false }, { sameOrigin: false }]) {
    const app = harness(options);
    assert.equal((await app.save(selection)).status, 403);
    assert.equal(app.calls.saves.length, 0);
  }
});

test('editor save button invokes save and hidden fixed slots remain editable', () => {
  const editor = readFileSync('src/components/store-admin/website/WebsiteContentEditor.tsx', 'utf8');
  assert.match(editor, /disabled=\{busy !== null \|\| \(slotCount > 0 && !slotsValid\)\}\s+onClick=\{save\}/);
  assert.match(editor, /style=\{enabled \|\| slotCount > 0 \? undefined/);
});

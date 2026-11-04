import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const { THEME_FIELDS } = await jiti.import(path.resolve('src/lib/website/collections.ts'));
const calls = [];
const module = { exports: {} };
const json = (body, options) => Response.json(body, options);
vm.runInNewContext(ts.transpileModule(readFileSync('src/app/api/store-admin/website/theme/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module, exports: module.exports, URL, Response,
  require(name) {
    if (name === 'next/cache') return { revalidatePath: () => {} };
    if (name === 'next/server') return { NextResponse: { json } };
    if (name === '@/lib/content') return { THEME_SETTING_KEYS: new Set([...THEME_FIELDS.map(field => field.path), 'logoText', 'oppoPrimaryColor', 'oppoGreenDark', 'oppoGreenLight']) };
    if (name === '@/lib/platform/api-guard') return { assertSameOrigin: () => null };
    if (name === '@/lib/store-admin/audit') return { writeAudit: async () => {} };
    if (name === '@/lib/store-admin/auth') return { requireStoreRole: async () => ({ ok: true, session: { adminId: 'owner', email: 'owner@example.test', name: 'Owner' } }) };
    if (name === '@/lib/website/collections') return { THEME_FIELDS };
    if (name === '@/lib/website/content-store') return {
      saveThemeValue: async key => { calls.push(key); return { ok: true }; },
      archiveThemeValue: async key => { calls.push(key); return { ok: true, data: true }; },
    };
    throw new Error(`Unexpected import: ${name}`);
  },
});

test('dead theme fields are preserved for readers but cannot be saved or reset', async () => {
  for (const key of ['logoText', 'oppoPrimaryColor', 'oppoGreenDark', 'oppoGreenLight']) {
    const save = await module.exports.PUT(new Request('https://example.test/api', {
      method: 'PUT', body: JSON.stringify({ values: { [key]: 'dead-value' } }),
    }));
    assert.equal(save.status, 400, key);
    const reset = await module.exports.DELETE(new Request(`https://example.test/api?key=${key}`, { method: 'DELETE' }));
    assert.equal(reset.status, 400, key);
  }
  assert.deepEqual(calls, []);
});

test('live theme keys still save and archive normally', async () => {
  const save = await module.exports.PUT(new Request('https://example.test/api', {
    method: 'PUT', body: JSON.stringify({ values: { homepageUiMode: 'new' } }),
  }));
  assert.equal(save.status, 200);
  const reset = await module.exports.DELETE(new Request('https://example.test/api?key=homepageUiMode', { method: 'DELETE' }));
  assert.equal(reset.status, 200);
  assert.deepEqual(calls, ['homepageUiMode', 'homepageUiMode']);
});

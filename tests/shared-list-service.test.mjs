// Memory-only tests. All imports are allowlisted; SQL is a rollback-capable fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(relative, mocks = {}, globals = {}) {
  const file = path.join(root, relative); const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Request, Response, TextEncoder, TextDecoder, Buffer, URL,
    require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected offline import: ${name}`); },
    ...globals,
  }, { filename: file });
  return module.exports;
}
const rules = load('src/lib/catalog/shared-list-rules.ts');
const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
const plain = value => JSON.parse(JSON.stringify(value));
function httpHarness() {
  const controls = { allowed: true }; const calls = [];
  const http = load('src/lib/store-admin/shared-list-http.ts', {
    'next/server': next,
    '@/lib/catalog/shared-list-rules': rules,
    '@/lib/payu/rate-limit': { checkRateLimit(key, options) { calls.push({ key, options }); return { allowed: controls.allowed, retryAfterSec: 12 }; } },
  });
  return { http, controls, calls };
}
function streamed(chunks, headers = {}) {
  return new Request('https://example.test/api', { method: 'POST', headers, duplex: 'half',
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
  });
}
const encode = text => new TextEncoder().encode(text);
const input = { kind: 'colours', format: 'paste', text: 'Ocean #123456' };
function serviceHarness() {
  const state = { brands: [], models: [], colours: [], audits: [] };
  const controls = { now: 1_800_000_000_000, owner: true, audit: true, publication: true, failInsert: 0, inserts: 0,
    target: { database: 'offline', schema: 'memory', role: 'offline' }, cookie: 'synthetic-session' };
  const calls = [];
  const tx = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim(); calls.push({ query, values });
    if (query.startsWith('select id,name,is_active,sort_order from device_brands')) return state.brands;
    if (query.startsWith('select d.id,d.name,d.brand_id')) return state.models;
    if (query.startsWith('select id,name,hex,is_active,sort_order from colours')) return state.colours;
    if (query.startsWith('select current_database()')) return [controls.target];
    if (query.startsWith('select id from store_admins')) return controls.owner ? [{ id: values[0] }] : [];
    if (query.startsWith('insert into colours')) {
      controls.inserts++; if (controls.failInsert === controls.inserts) throw new Error('injected insert failure');
      state.colours.push({ id: values[0], name: values[1], hex: values[2], is_active: values[3], sort_order: values[4] }); return [];
    }
    if (query.startsWith('insert into device_models')) {
      controls.inserts++; if (controls.failInsert === controls.inserts) throw new Error('injected insert failure');
      state.models.push({ id: values[0], brand_id: values[1], name: values[2], is_active: values[3], sort_order: values[4] }); return [];
    }
    if (query.startsWith('update device_models set')) {
      const row = state.models.find(row => row.id === values[3]);
      Object.assign(row, { name: values[0], is_active: values[1], sort_order: values[2] }); return [];
    }
    if (query.startsWith('set local ')) return [];
    throw new Error(`Unexpected fake query: ${query}`);
  };
  const sql = { async begin(...args) {
    const mode = typeof args[0] === 'string' ? args[0] : 'write';
    const callback = args.at(-1); const before = structuredClone(state);
    calls.push({ transaction: mode });
    try { return await callback(tx); }
    catch (error) { for (const key of Object.keys(state)) state[key] = before[key]; calls.push({ rollback: true }); throw error; }
  } };
  class Clock extends Date { static now() { return controls.now; } }
  const service = load('src/lib/store-admin/shared-lists.ts', {
    'node:crypto': crypto,
    'next/headers': { cookies: async () => ({ get: () => controls.cookie ? { value: controls.cookie } : undefined }) },
    '@/lib/platform/db': { getSql: () => sql },
    '@/lib/catalog/shared-list-rules': rules,
    './product-metadata': {
      MetadataError: rules.SharedListError,
      assertMetadataPublicationUsing: async () => { calls.push({ publication: true }); if (!controls.publication) throw new rules.SharedListError('This reference change would invalidate published product synthetic.'); },
      metadataGate: async () => calls.push({ gate: true }),
      strictMetadataAudit: async (_tx, audit) => { if (!controls.audit) throw new Error('injected audit failure'); state.audits.push(audit); calls.push({ audit: true }); },
    },
  }, { Date: Clock });
  return { service, state, controls, calls, tx };
}
const conflict = error => error instanceof rules.SharedListError && error.status === 409;

test('streamed body bounds actual bytes, ignores false small content length and decodes split UTF-8', async () => {
  const { http } = httpHarness();
  const bytes = encode('{"name":"é"}'); const split = bytes.indexOf(0xc3) + 1;
  assert.deepEqual(plain(await http.readSharedBody(streamed([bytes.slice(0, split), bytes.slice(split)]))), { name: 'é' });
  const boundary = '{"text":"' + 'x'.repeat(262144 - 11) + '"}';
  assert.equal(encode(boundary).length, 262144);
  assert.equal((await http.readSharedBody(streamed([encode(boundary)]))).text.length, 262133);
  await assert.rejects(http.readSharedBody(streamed([encode(boundary), encode(' ')], { 'content-length': '1' })), error => error.status === 413);
  await assert.rejects(http.readSharedBody(streamed([encode('{}')], { 'content-length': '262145' })), error => error.status === 413);
  await assert.rejects(http.readSharedBody(streamed([encode('{}')], { 'content-length': 'invalid' })), error => error.status === 413);
});

test('streamed body rejects invalid UTF-8, malformed JSON, arrays, null and absent bodies', async () => {
  const { http } = httpHarness();
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82]), encode('{'), encode('[]'), encode('null')]) {
    await assert.rejects(http.readSharedBody(streamed([bytes])), rules.SharedListError);
  }
  await assert.rejects(http.readSharedBody(new Request('https://example.test')), rules.SharedListError);
});

test('HTTP rate limits are actor scoped, private, and sanitize unknown failures', async () => {
  const { http, controls, calls } = httpHarness();
  assert.equal(http.sharedRateLimit('owner', 'preview'), null);
  controls.allowed = false;
  const denied = http.sharedRateLimit('owner', 'apply');
  assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '12');
  assert.match(denied.headers.get('cache-control'), /private, no-store/);
  assert.equal(calls[1].options.limit, 10); assert.equal(calls[1].key, 'shared-list:apply:owner');
  const failed = http.sharedFailure(new Error('private SQL connection detail'));
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private SQL/);
  assert.equal(http.sharedFailure(new rules.SharedListError('safe conflict', 409)).status, 409);
});

test('preview is read-only, issues authenticated approval, and session binding hashes its cookie', async () => {
  const { service, state, calls, controls } = serviceHarness();
  const preview = await service.previewSharedImport(input, 'owner', 'session');
  assert.equal(preview.plan.counts.new, 1); assert.match(preview.token, /^[\w-]+\.[\w-]+$/);
  assert.equal(calls[0].transaction, 'isolation level repeatable read read only');
  assert.ok(calls.every(call => !/^(insert|update|delete)/.test(call.query ?? '')));
  assert.equal(state.audits.length, 0);
  assert.equal(await service.sharedSessionBinding(), crypto.createHash('sha256').update('synthetic-session').digest('hex'));
  controls.cookie = ''; await assert.rejects(service.sharedSessionBinding(), error => error.status === 401);
});

test('injected transaction seams keep signing, metadata gate and strict audit without opening nested transactions', async () => {
  const h = serviceHarness();
  const { token } = await h.service.previewSharedImportUsing(h.tx, input, 'owner', 'session');
  assert.equal((await h.service.applySharedImportUsing(h.tx, input, token, [], 'owner', 'session')).created, 1);
  await h.service.saveSharedReferenceUsing(h.tx, 'colours', { name: 'Desert', hex: '#654321' }, 'owner', new Request('https://example.test'));
  assert.equal(h.state.audits.length, 2);
  assert.equal(h.calls.filter(call => call.gate).length, 2);
  assert.ok(!h.calls.some(call => call.transaction));
});

test('confirmation rejects token tampering, wrong actor/session/input, expiry and cross-process replay', async () => {
  const { service, state, controls } = serviceHarness();
  const { token } = await service.previewSharedImport(input, 'owner', 'session');
  for (const [raw, approval, actor, session] of [
    [input, 'invalid', 'owner', 'session'], [input, token + '.extra', 'owner', 'session'],
    [input, token.replace(/^./, token[0] === 'a' ? 'b' : 'a'), 'owner', 'session'],
    [input, token, 'other', 'session'], [input, token, 'owner', 'other'],
    [{ ...input, text: 'Other #123456' }, token, 'owner', 'session'],
  ]) await assert.rejects(service.applySharedImport(raw, approval, [], actor, session), conflict);
  const other = serviceHarness();
  await assert.rejects(other.service.applySharedImport(input, token, [], 'owner', 'session'), conflict);
  controls.now += 10 * 60_000 + 1;
  await assert.rejects(service.applySharedImport(input, token, [], 'owner', 'session'), conflict);
  assert.equal(state.colours.length, 0); assert.equal(state.audits.length, 0);
});

test('apply replans under metadata gate and active-owner check; changed target/catalogue rejects stale preview', async () => {
  for (const mutate of [h => h.state.colours.push({ id: 'x', name: 'Other', hex: '#654321', is_active: true, sort_order: 0 }),
    h => { h.controls.target = { ...h.controls.target, schema: 'changed' }; }]) {
    const h = serviceHarness(); const { token } = await h.service.previewSharedImport(input, 'owner', 'session');
    mutate(h); await assert.rejects(h.service.applySharedImport(input, token, [], 'owner', 'session'), conflict);
    assert.equal(h.state.audits.length, 0);
  }
  const h = serviceHarness(); const { token } = await h.service.previewSharedImport(input, 'owner', 'session');
  h.controls.owner = false;
  await assert.rejects(h.service.applySharedImport(input, token, [], 'owner', 'session'), error => error.status === 403);
  assert.ok(h.calls.some(call => call.gate)); assert.equal(h.state.colours.length, 0);
});

test('apply inserts valid rows with one count-only audit, repeated preview/apply is an audited no-op', async () => {
  const h = serviceHarness(); const { token } = await h.service.previewSharedImport(input, 'owner', 'session');
  const first = await h.service.applySharedImport(input, token, [], 'owner', 'session');
  assert.equal(first.created, 1); assert.equal(first.noop, false); assert.equal(h.state.audits.length, 1);
  assert.deepEqual(plain(h.state.audits[0].after), { created: 1, existing: 0, invalid: 0, acknowledged: 0 });
  assert.doesNotMatch(JSON.stringify(h.state.audits), /Ocean|#123456/);
  const before = JSON.stringify(h.state.colours);
  const next = await h.service.previewSharedImport(input, 'owner', 'session');
  const second = await h.service.applySharedImport(input, next.token, [], 'owner', 'session');
  assert.equal(second.created, 0); assert.equal(second.existing, 1); assert.equal(second.noop, true);
  assert.equal(JSON.stringify(h.state.colours), before); assert.equal(h.state.audits.length, 2);
});

test('near rows require explicit complete acknowledgement and invalid rows never insert', async () => {
  const h = serviceHarness(); h.state.colours.push({ id: 'x', name: 'Ocean', hex: '#111111', is_active: false, sort_order: 0 });
  const raw = { ...input, text: 'Oceam #123456\n=bad #654321' };
  const preview = await h.service.previewSharedImport(raw, 'owner', 'session');
  assert.equal(preview.plan.counts.near, 1); assert.equal(preview.plan.counts.invalid, 1);
  await assert.rejects(h.service.applySharedImport(raw, preview.token, [], 'owner', 'session'), conflict);
  await assert.rejects(h.service.applySharedImport(raw, preview.token, [2], 'owner', 'session'), conflict);
  const result = await h.service.applySharedImport(raw, preview.token, [1], 'owner', 'session');
  assert.equal(result.created, 1); assert.equal(result.invalid, 1); assert.equal(h.state.colours.length, 2);
});

test('signed approval contains exact selected-row and near-row decisions, not uploaded text', async () => {
  const h = serviceHarness(); h.state.colours.push({ id: 'x', name: 'Ocean', hex: '#111111', is_active: false, sort_order: 0 });
  const raw = { ...input, text: 'Oceam #123456\nDesert #654321\n=bad #123123' };
  const { token } = await h.service.previewSharedImport(raw, 'owner', 'session');
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  assert.match(payload.selectedRows, /^[a-f0-9]{64}$/); assert.match(payload.nearRows, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(payload), /Oceam|Desert|#123456/);
  const forged = Buffer.from(JSON.stringify({ ...payload, selectedRows: 'forged' })).toString('base64url') + '.' + token.split('.')[1];
  await assert.rejects(h.service.applySharedImport(raw, forged, [1], 'owner', 'session'), conflict);
});

test('maximum 500 near-match rows have a bounded token and can all be confirmed', async () => {
  const h = serviceHarness();
  const actor = 'a'.repeat(80), session = 's'.repeat(64);
  const raw = { kind: 'colours', format: 'paste', text: Array.from({ length: 500 }, (_, index) => `Synthetic colour ${String(index).padStart(4, '0')} #${(index + 1).toString(16).padStart(6, '0')}`).join('\n') };
  const preview = await h.service.previewSharedImport(raw, actor, session);
  assert.equal(preview.plan.counts.new + preview.plan.counts.near, 500);
  assert.ok(preview.token.length < 4096, `token bytes: ${preview.token.length}`);
  const acknowledged = preview.plan.rows.filter(row => row.status === 'near').map(row => row.row);
  assert.ok(acknowledged.length > 400);
  const result = await h.service.applySharedImport(raw, preview.token, acknowledged, actor, session);
  assert.equal(result.created, 500); assert.equal(h.state.colours.length, 500);
  assert.equal(h.state.audits.length, 1);
});

test('inline create forbids owner-management fields, invisible formulas and inactive/unknown brands', async () => {
  const h = serviceHarness();
  for (const name of ['=formula', '​@formula', '＝formula', 'Name\u0001']) {
    await assert.rejects(h.service.saveSharedReference('colours', { name, hex: '#123456' }, 'admin', new Request('https://example.test'), true), rules.SharedListError);
  }
  for (const extra of [{ id: 'client-id' }, { isActive: false }, { sortOrder: 1 }, { brandId: 'brand' }]) {
    await assert.rejects(h.service.saveSharedReference('colours', { name: 'Ocean', hex: '#123456', ...extra }, 'admin', new Request('https://example.test'), true), rules.SharedListError);
  }
  await assert.rejects(h.service.saveSharedReference('models', { name: 'Model', brandId: 'unknown' }, 'admin', new Request('https://example.test'), true), /active existing/);
  const created = await h.service.saveSharedReference('colours', { name: 'Ocean', hex: '#abcdef' }, 'admin', new Request('https://example.test'), true);
  assert.equal(created.hex, '#ABCDEF'); assert.equal(created.sortOrder, 0); assert.equal(created.isActive, true);
  assert.equal(h.state.audits.length, 1);
});

test('shared model edits reuse publication guard and roll back deactivation before audit', async () => {
  const h = serviceHarness();
  h.state.brands.push({ id: 'brand', name: 'Synthetic brand', is_active: true, sort_order: 0 });
  h.state.models.push({ id: 'model', name: 'Synthetic model', brand_id: 'brand', is_active: true, sort_order: 0 });
  const raw = { id: 'model', name: 'Synthetic model', brandId: 'brand', isActive: false, confirmDeactivation: true };
  h.controls.publication = false;
  await assert.rejects(h.service.saveSharedReference('models', raw, 'owner', new Request('https://example.test')), error => conflict(error) && /invalidate published product/.test(error.message));
  assert.equal(h.state.models[0].is_active, true); assert.equal(h.state.audits.length, 0);
  h.controls.publication = true;
  await h.service.saveSharedReference('models', raw, 'owner', new Request('https://example.test'));
  assert.equal(h.state.models[0].is_active, false); assert.equal(h.state.audits.length, 1);
  assert.ok(h.calls.some(call => call.publication));
});

test('affected-use pagination orders by the exact filtered cursor for prefix product IDs', () => {
  const source = readFileSync(path.join(root, 'src/lib/store-admin/shared-lists.ts'), 'utf8');
  assert.match(source, /order by p\.id \|\| '\|' \|\| coalesce\(v\.id,''\) limit 51/);
  assert.match(source, /order by p\.id \|\| '\|' \|\| v\.id limit 51/);
  const cursors = ['p|v050', 'p-2|v001', 'p|v001'].sort();
  const seen = []; let cursor = '';
  for (;;) { const page = cursors.filter(value => value > cursor).slice(0, 1); if (!page.length) break; seen.push(...page); cursor = page.at(-1); }
  assert.deepEqual(seen, cursors); assert.ok(seen.includes('p-2|v001'));
});

test('insert or strict audit failure rolls back the entire fake transaction', async () => {
  for (const failure of ['insert', 'audit']) {
    const h = serviceHarness(); const raw = { ...input, text: 'Ocean #123456\nDesert #654321' };
    const { token } = await h.service.previewSharedImport(raw, 'owner', 'session');
    if (failure === 'insert') h.controls.failInsert = 2; else h.controls.audit = false;
    await assert.rejects(h.service.applySharedImport(raw, token, [], 'owner', 'session'), /injected/);
    assert.equal(h.state.colours.length, 0); assert.equal(h.state.audits.length, 0);
    assert.ok(h.calls.some(call => call.rollback));
  }
});

function routeHarness(suffix = '', role = 'store_owner') {
  const calls = []; const controls = { origin: true };
  const rank = { store_viewer: 0, store_admin: 1, store_owner: 2 };
  const { http } = httpHarness();
  const service = {
    sharedKind: value => { if (!['models', 'colours'].includes(value)) throw new rules.SharedListError('Choose models or colours.'); return value; },
    loadSharedSnapshot: async () => { calls.push('snapshot'); return { brands: [], models: [], colours: [] }; },
    sharedSessionBinding: async () => 'session',
    previewSharedImport: async () => { calls.push('preview'); return { plan: { rows: [], counts: {} }, token: 'approval' }; },
    applySharedImport: async () => { calls.push('apply'); return { created: 0, noop: true }; },
    saveSharedReference: async (...args) => { calls.push({ save: args }); return { id: 'new', name: 'Ocean' }; },
    sharedUses: async () => { calls.push('uses'); return { rows: [], nextCursor: null }; },
  };
  const route = load(`src/app/api/store-admin/catalog/shared/[kind]/${suffix ? suffix + '/' : ''}route.ts`, {
    'next/server': next,
    '@/lib/platform/api-guard': { assertSameOrigin: () => controls.origin ? null : Response.json({}, { status: 403 }) },
    '@/lib/store-admin/auth': { requireStoreRole: async required => { calls.push({ role: required }); return rank[role] >= rank[required]
      ? { ok: true, session: { adminId: 'actor' } } : { ok: false, response: Response.json({}, { status: 403 }) }; } },
    '@/lib/store-admin/shared-lists': service,
    '@/lib/store-admin/shared-list-http': http,
    '@/lib/catalog/shared-list-rules': rules,
    '@/lib/storefront/revalidate': { revalidateCatalog: () => calls.push('revalidate') },
  });
  return { route, calls, controls };
}
const context = { params: Promise.resolve({ kind: 'colours' }) };
const req = (method = 'POST') => new Request('https://example.test/api?id=colour', {
  method, ...(method === 'GET' ? {} : { body: JSON.stringify({ name: 'Ocean', hex: '#123456', id: 'saved', input, token: 'approval' }) }),
});

test('route role matrix isolates owner management, admin inline create, viewer reads', async () => {
  const matrix = [['', 'GET', 'store_viewer'], ['', 'POST', 'store_owner'], ['', 'PUT', 'store_owner'],
    ['inline', 'POST', 'store_admin'], ['preview', 'POST', 'store_owner'], ['apply', 'POST', 'store_owner'],
    ['template', 'GET', 'store_owner'], ['export', 'GET', 'store_owner'], ['uses', 'GET', 'store_owner']];
  const rank = { store_viewer: 0, store_admin: 1, store_owner: 2 };
  for (const [suffix, method, required] of matrix) for (const role of Object.keys(rank)) {
    const h = routeHarness(suffix, role);
    const response = await h.route[method](req(method), context);
    assert.equal(response.status, rank[role] < rank[required] ? 403 : method === 'POST' && ['', 'inline'].includes(suffix) ? 201 : 200,
      `${suffix || 'root'} ${method} ${role}`);
    assert.equal(h.calls.find(call => call.role)?.role, required);
    if (response.status !== 403) assert.match(response.headers.get('cache-control'), /private, no-store/);
    else assert.ok(h.calls.every(call => typeof call === 'object' && call.role));
  }
});

test('all mutating shared routes enforce same-origin before body parsing or service calls', async () => {
  for (const [suffix, method] of [['', 'POST'], ['', 'PUT'], ['inline', 'POST'], ['preview', 'POST'], ['apply', 'POST']]) {
    const h = routeHarness(suffix); h.controls.origin = false;
    const response = await h.route[method](req(method), context);
    assert.equal(response.status, 403); assert.equal(h.calls.length, 0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve('src');
function loader(mocks = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
      module, exports: module.exports, Request, Response, URL, Uint8Array, TextDecoder,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), `${name}.ts`)));
        if (name === 'node:crypto') return require(name);
        throw new Error(`Unexpected dependency: ${name}`);
      },
    }, { filename: file });
    return module.exports;
  }
  return load;
}
const rules = loader()('lib/catalog/catalog-starter-rules.ts');
const { CATALOG_STARTER_TEMPLATES: templates, planCatalogStarterSetup: plan, parseCatalogStarterRequest: parse } = rules;
const json = value => JSON.parse(JSON.stringify(value));
const selection = id => [{ templateId: id }];
const all = templates.map(t => ({ templateId: t.id }));
function snapshot() {
  return { schema: { missing: [], rlsDisabled: [] }, categories: [...new Set(templates.map(t => t.categorySlug))].map(slug => ({ id: `cat_${slug}`, slug, name: slug, is_active: true, deleted_at: null })), types: [], attributes: [], mappings: [], units: [], options: [] };
}
function install(s, p) {
  s.types.push(...json(p.inserts.types));
  s.attributes.push(...json(p.inserts.attributes));
  s.mappings.push(...json(p.inserts.mappings));
}
const power = selection('type_power_adapter');
const cases = selection('type_cases_protection_case');

test('templates are serializable, seven historical groups without brand/model suggestions or node imports', () => {
  assert.equal(templates.length, 7);
  assert.equal(new Set(templates.map(t => t.id)).size, 7);
  assert.equal(templates.flatMap(t => t.attributes).some(a => ['brand', 'model'].includes(a.key)), false);
  assert.deepEqual(json(templates).map(t => t.id).sort(), ['type_airpods_case', 'type_cable_organizer', 'type_cases_protection_case', 'type_charger_shell', 'type_mobile_case', 'type_power_adapter', 'type_wired_earphones'].sort());
  assert.doesNotMatch(readFileSync(path.join(root, 'lib/catalog/catalog-starter-rules.ts'), 'utf8'), /^import\s/m);
});

test('strict intent validation rejects empty, excess, duplicate, unknown, prototype-like and unexpected fields', () => {
  for (const body of [null, [], {}, { selections: [] }, { selections: [...all, all[0]] }, { selections: [all[0], all[0]] }, { selections: [{ templateId: 'unknown' }] }, { selections: [{ templateId: '__proto__' }] }, { selections: [{ ...all[0], categoryId: '' }] }, { selections: [{ ...all[0], categoryId: '../bad' }] }, { selections: [{ ...all[0], categoryId: null }] }, { selections: [{ ...all[0], publish: true }] }, { selections: cases, price: 1 }, { selections: cases, fingerprint: 'a'.repeat(64) }]) assert.throws(() => parse(body), rules.CatalogStarterError);
  for (const fingerprint of ['', 'A'.repeat(64), 'a'.repeat(63), 123]) assert.throws(() => parse({ selections: cases, fingerprint }, true));
  assert.equal(parse({ selections: cases, fingerprint: 'a'.repeat(64) }, true).fingerprint.length, 64);
  assert.deepEqual(json(parse({ selections: [...all].reverse() }).selections), json(parse({ selections: all }).selections));
});

test('empty references produce exactly seven types, five reusable definitions and eleven optional mappings', () => {
  const s = snapshot(), before = JSON.stringify(s);
  const p = plan(s, all);
  assert.equal(p.preview.canApply, true);
  assert.deepEqual(json(p.preview.summary), { create: 29, reuse: 7, conflict: 0, missing: 0, types: 7, attributes: 5, mappings: 11 });
  assert.equal(p.inserts.types.length, 7);
  assert.equal(p.inserts.attributes.length, 5);
  for (const m of p.inserts.mappings) assert.deepEqual([m.is_required, m.show_in_specs, m.show_in_filters, m.show_in_search, m.is_active], [false, true, false, false, true]);
  assert.equal(JSON.stringify(s), before, 'planner does not mutate snapshots');
  assert.deepEqual(Object.keys(p.inserts).sort(), ['attributes', 'mappings', 'types']);
});

test('planning is independent of snapshot and selection order', () => {
  const s = snapshot();
  s.units.push({ id: 'watts', code: 'W', factor: 1, base_code: null });
  const a = plan(s, all);
  for (const value of Object.values(s)) if (Array.isArray(value)) value.reverse();
  assert.equal(rules.catalogStarterCanonical(a), rules.catalogStarterCanonical(plan(s, [...all].reverse())));
});

test('exact active slug only; explicit category is allowed and never creates categories', () => {
  const s = snapshot();
  s.categories = [{ id: 'manual', slug: 'Cases-Protection', name: 'cases-protection', is_active: true }];
  assert.equal(plan(s, cases).preview.rows[0].status, 'missing');
  const explicit = plan(s, [{ ...cases[0], categoryId: 'manual' }]);
  assert.equal(explicit.preview.canApply, true);
  assert.equal(explicit.inserts.types[0].category_id, 'manual');
  for (const patch of [{ is_active: false }, { deleted_at: 'archived' }]) {
    const c = { ...s.categories[0], ...patch };
    assert.equal(plan({ ...s, categories: [c] }, [{ ...cases[0], categoryId: 'manual' }]).preview.canApply, false);
  }
});

test('missing group blocks whole plan and inactive archived type/key/mapping cannot be revived', () => {
  const s = snapshot();
  const p = plan(s, cases); install(s, p);
  for (const [table, field] of [['types', 'is_active'], ['attributes', 'is_active'], ['attributes', 'deleted_at'], ['mappings', 'is_active']]) {
    const copy = json(s); copy[table][0][field] = field === 'deleted_at' ? 'archived' : false;
    assert.equal(plan(copy, cases).preview.canApply, false, `${table}.${field}`);
    assert.equal(plan(copy, cases).preview.summary.conflict > 0, true);
  }
  s.categories = [];
  assert.equal(plan(s, cases).preview.summary.missing, 1);
});

test('stable type IDs and unique normalized category/name reuse only compatible matching types', () => {
  for (const byId of [true, false]) {
    const s = snapshot();
    s.types.push({ id: byId ? cases[0].templateId : 'custom_case_type', category_id: s.categories[0].id, name: '  PROTECTIVE CASE  ', is_active: true, requires_compatibility: true, sort_order: 99 });
    const p = plan(s, cases);
    assert.equal(p.preview.canApply, true);
    assert.equal(p.inserts.types.length, 0);
    assert.equal(p.inserts.mappings[0].product_type_id, s.types[0].id);
  }
});

test('stable type category/compatibility collisions and ambiguous names block instead of overwriting', () => {
  for (const patch of [{ name: 'Different owner-defined type' }, { category_id: 'wrong' }, { requires_compatibility: false }, { is_active: false }]) {
    const s = snapshot(); install(s, plan(s, cases)); Object.assign(s.types[0], patch);
    assert.equal(plan(s, cases).preview.canApply, false);
  }
  const s = snapshot(); install(s, plan(s, cases)); s.types.push({ ...s.types[0], id: 'another' });
  assert.equal(plan(s, cases).preview.canApply, false);
});

test('active enum text suggestions retain existing options, units and owner mapping flags', () => {
  const s = snapshot(); install(s, plan(s, cases));
  Object.assign(s.attributes[0], { id: 'owner_material', data_type: 'enum', label: 'Owner material' });
  s.options.push({ attribute_id: 'owner_material', value: 'Silicone', sort_order: 0 }, { attribute_id: 'owner_material', value: 'Leather', sort_order: 1 });
  Object.assign(s.mappings[0], { attribute_id: 'owner_material', is_required: true, show_in_specs: false, show_in_filters: true, show_in_search: true });
  const p = plan(s, cases);
  assert.equal(p.preview.canApply, true);
  assert.equal(p.inserts.mappings.length, 0);
  assert.equal(p.inserts.attributes.length, 0);
  assert.deepEqual(json(p.preview.rows.find(r => r.kind === 'attribute').options), ['Leather', 'Silicone']);
  assert.equal(p.preview.rows.find(r => r.kind === 'attribute').dataType, 'enum');
  s.options = [];
  assert.equal(plan(s, cases).preview.canApply, false, 'empty enum cannot support a text suggestion');
});

test('incompatible attributes, stable IDs and units are conflicts; valid W may be reused without creation', () => {
  for (const attribute of [
    { id: 'material', key: 'material', data_type: 'number', is_active: true },
    { id: 'attr_material', key: 'something_else', data_type: 'text', is_active: true },
    { id: 'material', key: 'material', data_type: 'text', is_active: true, unit_id: 'watts' },
  ]) { const s = snapshot(); s.attributes.push(attribute); assert.equal(plan(s, cases).preview.canApply, false); }
  const s = snapshot();
  s.units.push({ id: 'watts', code: 'W', label: 'Watts', factor: '1.000000', base_code: null });
  const p = plan(s, power);
  assert.equal(p.inserts.attributes.find(a => a.key === 'wattage').unit_id, 'watts');
  assert.match(p.preview.rows.find(r => r.kind === 'attribute' && r.unitId === 'watts').message, /Unit: Watts \(W\)/);
  install(s, p);
  assert.equal(plan(s, power).preview.canApply, true);
  s.units[0].factor = 1000;
  assert.equal(plan(s, power).preview.canApply, false);
  const empty = snapshot();
  assert.equal(plan(empty, power).inserts.attributes.find(a => a.key === 'wattage').unit_id, null);
});

test('installed equivalent intent is a pure no-op and schema problems disable apply', () => {
  const s = snapshot(); install(s, plan(s, all));
  assert.equal(plan(s, all).preview.canApply, true);
  assert.deepEqual(json(plan(s, all).inserts), { types: [], attributes: [], mappings: [] });
  for (const schema of [{ missing: ['product_types.id'], rlsDisabled: [] }, { missing: [], rlsDisabled: ['attributes'] }]) assert.equal(plan({ ...s, schema }, all).preview.canApply, false);
});

// All service SQL below is a VM-only in-memory test double. No env loader,
// database package, migrations, seeds, or real network client is imported.
const columns = {
  categories: 'id slug name is_active deleted_at',
  product_types: 'id category_id name requires_compatibility sort_order is_active',
  attributes: 'id key label data_type unit_id is_active deleted_at sort_order is_filterable is_variant_option',
  product_type_attributes: 'product_type_id attribute_id is_required sort_order show_in_specs show_in_filters show_in_search is_active',
  units: 'id code label dimension base_code factor', attribute_options: 'attribute_id value sort_order',
  products: 'id category_id product_type_id is_active deleted_at compatibility_reviewed_at',
  product_attribute_values: 'product_id attribute_id value_text value_number value_bool option_value archived_at',
  product_variants: 'id product_id device_model_id is_active is_purchasable',
  device_brands: 'id name sort_order is_active', device_models: 'id brand_id name sort_order is_active',
  product_device_models: 'product_id device_model_id sort_order archived_at', store_admin_audit: 'actor_id action entity entity_id before after',
};
function harness() {
  let state = snapshot(), pending;
  const calls = [], controls = { missing: false, rls: false, auditFailure: false, publicationFailure: false, dependencyFailure: false, actor: true, insertCode: null, denied: false, origin: false, routeError: null };
  function sql(strings, ...values) {
    if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw')) return { identifier: strings, columns: values };
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    if (query.includes('information_schema.columns')) return Promise.resolve(controls.missing ? [] : Object.entries(columns).flatMap(([table_name, names]) => names.split(' ').map(column_name => ({ table_name, column_name }))));
    if (query.includes('c.relrowsecurity')) return Promise.resolve(Object.keys(columns).map(relname => ({ relname, relrowsecurity: !controls.rls })));
    if (query.includes('from pg_constraint')) return Promise.resolve([{ conname: 'products_type_category_fk' }]);
    if (query.includes('from pg_trigger')) return Promise.resolve([{ tgname: 'retain_product_attribute_value' }, { tgname: 'store_admin_audit_immutable' }]);
    if (query.includes('current_database()')) return Promise.resolve([{ database: 'fixture', schema: 'public', role: 'fixture' }]);
    if (query.startsWith('select id from store_admins')) return Promise.resolve(controls.actor ? [{ id: 'owner' }] : []);
    const source = pending ?? state;
    for (const [table, key] of [['categories', 'categories'], ['product_types', 'types'], ['attributes', 'attributes'], ['product_type_attributes', 'mappings'], ['units', 'units'], ['attribute_options', 'options']]) if (query.includes(`from ${table} order by`)) return Promise.resolve(json(source[key]));
    if (query.startsWith('insert into')) {
      if (controls.insertCode) return Promise.reject(Object.assign(new Error('private driver detail'), { code: controls.insertCode }));
      const table = values[0].identifier, rows = values[1].identifier;
      const key = { product_types: 'types', attributes: 'attributes', product_type_attributes: 'mappings' }[table];
      if (!key) throw new Error(`Unexpected write table ${table}`);
      pending[key].push(...json(rows)); return Promise.resolve([]);
    }
    if (query.startsWith('select v.id from product_variants')) return Promise.resolve(controls.dependencyFailure ? [{ id: 'variant' }] : []);
    if (query.startsWith('select id from products')) return Promise.resolve([{ id: 'published' }]);
    if (query.startsWith('set local') || query.startsWith('lock table')) return Promise.resolve([]);
    throw new Error(`Unexpected SQL: ${query}`);
  }
  sql.begin = async (mode, callback) => {
    calls.push({ event: 'begin', mode }); pending = json(state);
    try { const result = await callback(sql); state = pending; pending = null; calls.push({ event: 'commit' }); return result; }
    catch (error) { pending = null; calls.push({ event: 'rollback' }); throw error; }
  };
  const load = loader({
    '@/lib/platform/db': { getSql: () => sql },
    './product-metadata': {
      metadataGate: async () => { calls.push({ event: 'gate' }); },
      metadataReferencesUsing: async () => { calls.push({ event: 'references' }); return {}; },
      productMetadataUsing: async () => ({ problems: controls.publicationFailure ? ['private product detail'] : [] }),
      strictMetadataAudit: async () => { calls.push({ event: 'audit' }); if (controls.auditFailure) throw new Error('private audit detail'); },
    },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/platform/api-guard': { assertSameOrigin: () => controls.origin ? Response.json({ error: 'Origin' }, { status: 403 }) : null },
    '@/lib/store-admin/auth': { requireStoreRole: async role => { calls.push({ event: 'role', role }); return controls.denied ? { ok: false, response: Response.json({ error: 'Denied' }, { status: 403 }) } : { ok: true, session: { adminId: 'owner' } }; } },
    '@/lib/storefront/revalidate': { revalidateCatalog: () => calls.push({ event: 'revalidate' }) },
  });
  return { service: load('lib/store-admin/catalog-starter-setup.ts'), load, controls, calls, getState: () => state, change: fn => fn(state) };
}

test('preview is read-only; apply reloads under gate and locks, inserts only allowed references, audits before commit', async () => {
  const h = harness();
  const preview = await h.service.previewCatalogStarterSetup(all);
  assert.equal(preview.fingerprint.length, 64);
  assert.equal(h.calls[0].mode, 'isolation level repeatable read read only');
  assert.equal(h.calls.some(c => c.query?.startsWith('insert')), false);
  h.calls.length = 0;
  const result = await h.service.applyCatalogStarterSetup(all, preview.fingerprint, 'owner');
  assert.deepEqual(json(result.applied), { types: 7, attributes: 5, mappings: 11 });
  assert.equal(result.noop, false);
  assert.equal(h.calls.filter(c => c.query?.startsWith('insert into')).length, 3);
  assert.ok(h.calls.some(c => c.query === "set local statement_timeout = '15s'"));
  assert.ok(h.calls.some(c => c.query === "set local lock_timeout = '5s'"));
  const eventIndex = e => h.calls.findIndex(c => c.event === e);
  assert.ok(eventIndex('gate') < h.calls.findIndex(c => c.query?.startsWith('lock table')));
  assert.ok(h.calls.findIndex(c => c.query?.startsWith('lock table')) < h.calls.findIndex(c => c.query?.startsWith('select id,slug')));
  assert.ok(eventIndex('audit') < eventIndex('commit'));
  assert.equal(h.calls.some(c => /\b(update|delete)\b/.test(c.query ?? '') && !c.query.includes('for share')), false);
});

test('stale state or changed selected intent returns 409 without inserts', async () => {
  for (const mutate of [h => h.change(s => s.options.push({ attribute_id: 'unrelated', value: 'changed', sort_order: 0 })), h => h.change(s => { s.categories[0].is_active = false; })]) {
    const h = harness(); const p = await h.service.previewCatalogStarterSetup(cases); mutate(h);
    await assert.rejects(h.service.applyCatalogStarterSetup(cases, p.fingerprint, 'owner'), e => e.status === 409);
    assert.equal(h.calls.some(c => c.query?.startsWith('insert')), false);
  }
  const h = harness(), p = await h.service.previewCatalogStarterSetup(cases);
  await assert.rejects(h.service.applyCatalogStarterSetup(power, p.fingerprint, 'owner'), e => e.status === 409);
});

test('replay of applied approval is stale; fresh equivalent preview is no-op without inserts or audit', async () => {
  const h = harness(), p = await h.service.previewCatalogStarterSetup(all);
  await h.service.applyCatalogStarterSetup(all, p.fingerprint, 'owner');
  await assert.rejects(h.service.applyCatalogStarterSetup(all, p.fingerprint, 'owner'), e => e.status === 409);
  const fresh = await h.service.previewCatalogStarterSetup(all);
  h.calls.length = 0;
  const result = await h.service.applyCatalogStarterSetup(all, fresh.fingerprint, 'owner');
  assert.equal(result.noop, true);
  assert.equal(h.calls.some(c => c.query?.startsWith('insert') || c.event === 'audit'), false);
});

test('schema/RLS readiness, owner recheck and conflicts block all writes', async () => {
  for (const control of ['missing', 'rls', 'actor']) {
    const h = harness(), p = await h.service.previewCatalogStarterSetup(cases);
    h.controls[control] = control === 'actor' ? false : true;
    await assert.rejects(h.service.applyCatalogStarterSetup(cases, p.fingerprint, 'owner'), e => e.status === (control === 'actor' ? 409 : 503));
    assert.equal(h.calls.some(c => c.query?.startsWith('insert')), false);
  }
  const h = harness(); h.change(s => { install(s, plan(s, cases)); s.types[0].is_active = false; });
  const p = await h.service.previewCatalogStarterSetup(cases);
  assert.equal(p.canApply, false);
  await assert.rejects(h.service.applyCatalogStarterSetup(cases, p.fingerprint, 'owner'), e => e.status === 409);
});

test('audit and publication/dependency failures roll back every insert and redact private errors', async () => {
  for (const control of ['auditFailure', 'publicationFailure', 'dependencyFailure']) {
    const h = harness(), before = JSON.stringify(h.getState()), p = await h.service.previewCatalogStarterSetup(all);
    h.controls[control] = true;
    await assert.rejects(h.service.applyCatalogStarterSetup(all, p.fingerprint, 'owner'), e => !/private/.test(e.message));
    assert.equal(JSON.stringify(h.getState()), before);
    assert.equal(h.calls.at(-1).event, 'rollback');
    if (control !== 'auditFailure') assert.equal(h.calls.some(c => c.event === 'audit'), false);
  }
});

test('unique/FK/serialization/lock races are redacted 409 without overwrite or commit', async () => {
  for (const code of ['23505', '23503', '40001', '40P01', '55P03', '57014']) {
    const h = harness(), p = await h.service.previewCatalogStarterSetup(cases); h.controls.insertCode = code;
    await assert.rejects(h.service.applyCatalogStarterSetup(cases, p.fingerprint, 'owner'), e => e.status === 409 && !/private/.test(e.message));
    assert.equal(h.getState().types.length, 0);
  }
});

const request = body => new Request('https://example.test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const previewRoute = 'app/api/store-admin/catalog/setup/preview/route.ts';
const applyRoute = 'app/api/store-admin/catalog/setup/apply/route.ts';

test('both POST routes enforce same-origin and owner before any database access', async () => {
  for (const file of [previewRoute, applyRoute]) for (const control of ['origin', 'denied']) {
    const h = harness(); h.controls[control] = true;
    const response = await h.load(file).POST(request({ selections: cases, fingerprint: 'a'.repeat(64) }));
    assert.equal(response.status, 403);
    assert.equal(h.calls.some(c => c.event === 'begin'), false);
    if (control === 'denied') assert.equal(h.calls[0].role, 'store_owner');
  }
});

test('routes expose preview/apply response contract, no-store and refresh only committed changes', async () => {
  const h = harness();
  const response = await h.load(previewRoute).POST(request({ selections: cases }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { preview } = await response.json();
  const applied = await h.load(applyRoute).POST(request({ selections: cases, fingerprint: preview.fingerprint }));
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).applied.types, 1);
  assert.equal(h.calls.filter(c => c.event === 'revalidate').length, 1);
  const stale = await h.load(applyRoute).POST(request({ selections: cases, fingerprint: preview.fingerprint }));
  assert.equal(stale.status, 409);
  assert.equal(h.calls.filter(c => c.event === 'revalidate').length, 1);
});

test('bounded body parser rejects excessive declared/streamed bytes and malformed JSON before DB', async () => {
  const h = harness(), route = h.load(previewRoute);
  for (const req of [
    new Request('https://example.test/api', { method: 'POST', body: 'x'.repeat(8200) }),
    new Request('https://example.test/api', { method: 'POST', body: '{}', headers: { 'content-length': '99999' } }),
    new Request('https://example.test/api', { method: 'POST', body: '{bad' }),
    request({ selections: [...cases, ...cases] }),
  ]) assert.equal((await route.POST(req)).status, 400);
  assert.equal(h.calls.some(c => c.event === 'begin'), false);
});

test('readiness preview reports problems without querying missing tables or running DDL', async () => {
  const h = harness(); h.controls.missing = true;
  const preview = await h.service.previewCatalogStarterSetup(cases);
  assert.equal(preview.canApply, false);
  assert.ok(preview.schema.missing.length);
  assert.equal(h.calls.some(c => /from (categories|product_types) order/.test(c.query ?? '')), false);
  assert.equal(h.calls.some(c => /^(create|alter|drop|update|delete)/i.test(c.query ?? '')), false);
});

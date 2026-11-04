// Offline only. All imports are allowlisted; fetch, router and server loaders are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const creatorFile = 'src/components/store-admin/DeviceReferenceCreator.tsx';
const managerFile = 'src/components/store-admin/MetadataReferenceManager.tsx';
const pageFile = 'src/app/(store-admin)/store-admin/(protected)/device-models/page.tsx';
const activeBrand = { id: 'brand', name: 'Brand', isActive: true, sortOrder: 0 };
const inactiveBrand = { ...activeBrand, id: 'off', name: 'Off', isActive: false };
const brands = [activeBrand, inactiveBrand];
const reference = { id: 'server-uuid', name: 'Model', brandId: 'brand', brandName: 'Brand', isActive: true, sortOrder: 0 };
const references = { types: [], brands, models: [{ ...reference, isActive: false }] };
const management = { references, mappings: [], modelStatus: [{ id: reference.id, modelActive: true, brandActive: false }] };
const managerProps = { references, management, categories: [], attributes: [], canEdit: true, group: 'models' };
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const allowed = { react: React, 'react/jsx-runtime': jsx, ...mocks };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, Response, ...globals,
    require(name) { if (name in allowed) return allowed[name]; throw new Error(`Unexpected offline import: ${name}`); },
  }, { filename: file });
  return module.exports;
}
function hookHarness(file, exportName, props, mocks = {}, globals = {}) {
  let cursor = 0;
  const slots = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect() {},
  };
  const component = load(file, { ...mocks, react: { ...React, ...hooks } }, globals)[exportName];
  return { render() { cursor = 0; return component(props); } };
}
function nodes(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  const children = React.Children.toArray(element.props?.children);
  return [...(predicate(element) ? [element] : []), ...children.flatMap(child => nodes(child, predicate))];
}
const buttons = tree => nodes(tree, node => node.type === 'button');
const button = (tree, text) => buttons(tree).find(node => String(node.props.children).includes(text));
const input = tree => nodes(tree, node => node.type === 'input' && node.props.maxLength)[0];
const creator = load(creatorFile);

test('creator defaults fail closed and is a fieldset fragment without form or client ID', () => {
  const closed = renderToStaticMarkup(React.createElement(creator.DeviceReferenceCreator, { kind: 'models', brands, onCreated() {} }));
  assert.match(closed, /Only store owners/); assert.doesNotMatch(closed, /<input|<button/);
  const html = renderToStaticMarkup(React.createElement(creator.DeviceReferenceCreator, { kind: 'models', brands, canManage: true, onCreated() {} }));
  assert.match(html, /<fieldset/); assert.doesNotMatch(html, /<form|Stable ID|value="off"/);
  assert.ok(nodes(creatorElement(), node => node.type === 'button').every(node => node.props.type === 'button'));
  function creatorElement() { return hookHarness(creatorFile, 'DeviceReferenceCreator', { kind: 'models', brands, canManage: true, onCreated() {} }).render(); }
});

test('creator payload whitelist, trimming, input bounds and active parent brand', () => {
  const draft = { name: ' Model ', brandId: 'brand', sortOrder: '9999', isActive: false, id: 'forbidden', productId: 'forbidden' };
  const model = creator.deviceReferencePayload('models', draft, brands);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), { name: 'Model', sortOrder: 9999, isActive: false, brandId: 'brand' });
  const brand = creator.deviceReferencePayload('brands', draft, brands);
  assert.equal('brandId' in brand, false);
  for (const patch of [{ name: '' }, { name: 'x'.repeat(121) }, { name: 'bad\nname' }, { sortOrder: '' }, { sortOrder: '-1' }, { sortOrder: '0.5' }, { sortOrder: '10000' }, { brandId: 'off' }]) assert.throws(() => creator.deviceReferencePayload('models', { ...draft, ...patch }, brands));
});

test('201 response shape must match kind and payload; models include parent identity', async () => {
  const payload = { name: 'Model', brandId: 'brand', isActive: true, sortOrder: 0 };
  const calls = [];
  const ref = await creator.postDeviceReference('models', payload, async (...args) => { calls.push(args); return Response.json({ reference }, { status: 201 }); });
  assert.equal(ref.id, 'server-uuid'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/store-admin/catalog/metadata/models'); assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  for (const bad of [null, {}, { ...reference, id: '' }, { ...reference, name: 1 }, { ...reference, sortOrder: '0' }, { ...reference, isActive: 1 }, { ...reference, brandId: undefined }, { ...reference, brandName: '' }]) {
    assert.equal(creator.createdDeviceReference('models', { reference: bad }), null);
  }
  for (const [status, body] of [[200, { reference }], [201, { reference: { ...reference, brandId: 'other' } }], [201, { reference: { ...reference, name: 'other' } }]]) await assert.rejects(creator.postDeviceReference('models', payload, async () => Response.json(body, { status })), error => error.ambiguous);
});

test('known failures preserve explicit errors; network/5xx/invalid success are ambiguous with no retry', async () => {
  const payload = { name: 'Model', brandId: 'brand', isActive: true, sortOrder: 0 };
  for (const status of [400, 401, 403, 409, 422]) await assert.rejects(creator.postDeviceReference('models', payload, async () => Response.json({ error: 'Precise error' }, { status })), error => !error.ambiguous && error.message === 'Precise error');
  for (const result of ['network', 'json', 500, 503]) {
    let count = 0;
    await assert.rejects(creator.postDeviceReference('models', payload, async () => { count++; if (result === 'network') throw new Error('private detail'); return result === 'json' ? new Response('{', { status: 201 }) : Response.json({}, { status: result }); }), error => error.ambiguous && /Do not submit again/.test(error.message) && !/private/.test(error.message));
    assert.equal(count, 1);
  }
});

test('creator double-click, busy callback, preserved conflict input and successful callback', async () => {
  let finish;
  const busy = [], created = [], calls = [];
  const harness = hookHarness(creatorFile, 'DeviceReferenceCreator', { kind: 'models', brands, canManage: true, initialBrandId: 'brand', onBusyChange: value => busy.push(value), onCreated: (...args) => created.push(args) }, {}, { fetch: async (...args) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); } });
  input(harness.render()).props.onChange({ target: { value: 'Model' } });
  const submit = button(harness.render(), 'Create device');
  const first = submit.props.onClick(); await submit.props.onClick(); assert.equal(calls.length, 1);
  finish(Response.json({ error: 'Already exists' }, { status: 409 })); await first;
  assert.equal(input(harness.render()).props.value, 'Model');
  assert.ok(nodes(harness.render(), node => node.props.role === 'alert').some(node => node.props.children === 'Already exists'));
  const second = button(harness.render(), 'Create device').props.onClick(); finish(Response.json({ reference }, { status: 201 })); await second;
  assert.deepEqual(busy, [true, false, true, false]); assert.equal(created.length, 1); assert.equal(created[0][0], 'models'); assert.equal(created[0][1].id, 'server-uuid');
  assert.equal(input(harness.render()).props.value, '');
});

test('ambiguous outcomes retain input and disable repeat create/reset; disabled creator never POSTs', async () => {
  let calls = 0;
  for (const disabled of [false, true]) {
    const harness = hookHarness(creatorFile, 'DeviceReferenceCreator', { kind: 'brands', brands, canManage: true, disabled, onCreated() { assert.fail('must not report success'); } }, {}, { fetch: async () => { calls++; throw new Error('network'); } });
    input(harness.render()).props.onChange({ target: { value: 'Brand' } });
    await button(harness.render(), 'Create device').props.onClick();
    if (!disabled) { assert.equal(input(harness.render()).props.value, 'Brand'); assert.equal(button(harness.render(), 'Reset').props.disabled, true); }
    await button(harness.render(), 'Create device').props.onClick();
  }
  assert.equal(calls, 1);
});

test('consumer update failure is a saved-reference warning, not a retryable create error', async () => {
  const harness = hookHarness(creatorFile, 'DeviceReferenceCreator', { kind: 'models', brands, canManage: true, initialBrandId: 'brand', onCreated() { throw new Error('reload failed'); } }, {}, { fetch: async () => Response.json({ reference }, { status: 201 }) });
  input(harness.render()).props.onChange({ target: { value: 'Model' } });
  await button(harness.render(), 'Create device').props.onClick();
  assert.equal(input(harness.render()).props.value, '');
  assert.equal(nodes(harness.render(), node => node.props.role === 'alert').length, 0);
  assert.ok(nodes(harness.render(), node => node.props.role === 'status').some(node => /saved, but the local list/.test(node.props.children)));
});

const managerMocks = { 'next/navigation': { useRouter: () => ({ refresh() {} }) }, './DeviceReferenceCreator': creator };
test('device manager uses shared POST creator for new devices, PUT for edits and locks saved parent', async () => {
  const calls = [];
  const harness = hookHarness(managerFile, 'MetadataReferenceManager', managerProps, managerMocks, { fetch: async (...args) => { calls.push(args); return Response.json({ ok: true }); }, window: { confirm: () => true } });
  let tree = harness.render();
  assert.equal(nodes(tree, node => node.type === creator.DeviceReferenceCreator).length, 1);
  assert.equal(button(tree, 'Save reference'), undefined);
  button(tree, 'Edit').props.onClick(); tree = harness.render();
  assert.equal(nodes(tree, node => node.type === creator.DeviceReferenceCreator).length, 0);
  const parent = nodes(tree, node => node.type === 'select' && node.props.value === 'brand')[0];
  assert.equal(parent.props.disabled, true);
  const checked = nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0]; assert.equal(checked.props.checked, true, 'edit uses raw status, not effective inactive');
  await button(tree, 'Save reference').props.onClick(); assert.equal(calls[0][1].method, 'PUT');
  assert.equal(JSON.parse(calls[0][1].body).id, reference.id);
});

test('all roles browse raw and effective device status; only owners get writes; type/mapping groups remain', () => {
  const { MetadataReferenceManager } = load(managerFile, managerMocks);
  for (const role of ['store_admin', 'store_viewer']) {
    const html = renderToStaticMarkup(React.createElement(MetadataReferenceManager, { ...managerProps, canEdit: role === 'store_owner' }));
    assert.match(html, /Saved model status: active/); assert.match(html, /Effective availability: inactive/); assert.match(html, /Device brand is inactive/);
    assert.doesNotMatch(html, />Edit<|>Save reference<|>Create device/);
  }
  const html = renderToStaticMarkup(React.createElement(MetadataReferenceManager, { ...managerProps, group: undefined, canEdit: false }));
  assert.match(html, /Product types/); assert.match(html, /Type attribute mappings/);
});

test('dedicated protected page reuses loader/managers, grants writes only to owner and falls back safely', async () => {
  for (const role of ['store_owner', 'store_admin', 'store_viewer']) {
    let reads = 0;
    const { default: Page } = load(pageFile, { 'next/link': { __esModule: true, default: 'a' }, '@/components/store-admin/MetadataReferenceManager': { MetadataReferenceManager: 'manager' }, '@/components/store-admin/SharedListManager': { SharedListManager: 'shared-manager' }, '@/lib/store-admin/shared-lists': { loadSharedSnapshot: async () => ({ brands, models: [reference], colours: [] }) }, '@/lib/store-admin/auth': { getStoreSession: async () => ({ role }) }, '@/lib/store-admin/product-metadata': { loadMetadataManagement: async () => { reads++; return management; } } });
    const tree = await Page(); assert.equal(reads, 1);
    const managers = nodes(tree, node => node.type === 'manager'); assert.equal(managers.length, 2);
    assert.deepEqual(managers.map(node => node.props.group), ['brands', 'models']); assert.ok(managers.every(node => node.props.canEdit === (role === 'store_owner')));
    const shared = nodes(tree, node => node.type === 'shared-manager'); assert.equal(shared.length, 1); assert.equal(shared[0].props.kind, 'models'); assert.equal(shared[0].props.canManage, role === 'store_owner');
  }
  const { default: Page } = load(pageFile, { 'next/link': { __esModule: true, default: 'a' }, '@/components/store-admin/MetadataReferenceManager': { MetadataReferenceManager: 'manager' }, '@/components/store-admin/SharedListManager': { SharedListManager: 'shared-manager' }, '@/lib/store-admin/shared-lists': { loadSharedSnapshot: async () => ({ brands, models: [reference], colours: [] }) }, '@/lib/store-admin/auth': { getStoreSession: async () => ({ role: 'store_owner' }) }, '@/lib/store-admin/product-metadata': { loadMetadataManagement: async () => { throw new Error('private DB detail'); } } });
  const html = renderToStaticMarkup(await Page()); assert.match(html, /Device references are unavailable/); assert.doesNotMatch(html, /private DB detail|<manager/);
  const shell = readFileSync('src/components/store-admin/StoreAdminShell.tsx', 'utf8'); assert.match(shell, /href: '\/store-admin\/device-models', label: 'Device models'/);
});

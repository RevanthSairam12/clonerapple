// Offline-only UI harness: all fetch/auth/router/backend boundaries are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const root = 'src/components/store-admin/';
const inlineFile = `${root}SharedListInlineCreator.tsx`, managerFile = `${root}SharedListManager.tsx`;
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} }, allowed = { react: React, 'react/jsx-runtime': jsx, ...mocks };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { module, exports: module.exports, Response, TextDecoder, ...globals, require(name) { if (name in allowed) return allowed[name]; throw new Error(`Unexpected offline import: ${name}`); } }, { filename: file });
  return module.exports;
}
const rules = load('src/lib/catalog/shared-list-rules.ts'), managerMocks = { '@/lib/catalog/shared-list-rules': rules };
let nextHarnessId = 0;
function harness(file, component, props, globals = {}, mocks = {}) {
  let cursor = 0; const slots = [];
  const hooks = { useId() { const index = cursor++; return slots[index] ??= `shared-test-${++nextHarnessId}`; }, useEffect() {}, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; }, useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; } };
  const Component = load(file, { ...mocks, react: { ...React, ...hooks } }, globals)[component];
  return { render() { cursor = 0; return Component(props); } };
}
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...React.Children.toArray(tree.props?.children).flatMap(child => nodes(child, predicate))]; }
const button = (tree, text) => nodes(tree, node => node.type === 'button' && React.Children.toArray(node.props.children).join('') === text)[0];
const inputs = tree => nodes(tree, node => node.type === 'input' && node.props.maxLength);
const change = (node, value) => node.props.onChange({ target: { value } });
const brand = { id: 'brand', name: 'Brand', isActive: true, sortOrder: 0 };
const model = { id: 'model', name: 'Model', brandId: 'brand', isActive: true, sortOrder: 0 };
const colour = { id: 'colour', name: 'Blue', hex: '#123ABC', isActive: true, sortOrder: 0 };
const snapshot = { brands: [brand, { ...brand, id: 'inactive', isActive: false }], models: [model], colours: [colour] };
const row = (status = 'new', patch = {}) => ({ row: 2, status, name: 'Blue', hex: '#123ABC', sortOrder: 0, isActive: true, reason: 'Review', suggestions: [], ...patch });
const preview = rows => ({ plan: { rows, counts: { new: rows.length, existing: 0, near: 0, invalid: 0 } }, token: 'server-preview-token' });
const creator = load(inlineFile);

test('inline creator fails closed, excludes inactive brands and never nests a form', () => {
  assert.equal(renderToStaticMarkup(React.createElement(creator.SharedListInlineCreator, { kind: 'models', brands: snapshot.brands, onCreated() {} })), '');
  const html = renderToStaticMarkup(React.createElement(creator.SharedListInlineCreator, { kind: 'models', brands: snapshot.brands, canCreate: true, onCreated() {} }));
  assert.match(html, /fieldset|Device model name/); assert.doesNotMatch(html, /<form|value="inactive"|New device brand/);
  assert.deepEqual(JSON.parse(JSON.stringify(creator.inlineSharedPayload('models', ' Model ', 'brand', snapshot.brands))), { name: 'Model', brandId: 'brand' });
  assert.deepEqual(JSON.parse(JSON.stringify(creator.inlineSharedPayload('colours', ' Blue ', '#123abc', []))), { name: 'Blue', hex: '#123ABC' });
  assert.throws(() => creator.inlineSharedPayload('models', 'Model', 'inactive', snapshot.brands));
  assert.throws(() => creator.inlineSharedPayload('colours', 'Blue', 'bad', []));
});

test('inline model narrow payload blocks double click, preserves conflict and reports busy', async () => {
  let finish; const calls = [], busy = [], saved = [];
  const h = harness(inlineFile, 'SharedListInlineCreator', { kind: 'models', brands: snapshot.brands, canCreate: true, onBusyChange: value => busy.push(value), onCreated: (...args) => saved.push(args) }, { fetch: async (...args) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); } });
  change(inputs(h.render())[0], 'Model'); change(nodes(h.render(), node => node.type === 'select')[0], 'brand');
  const create = button(h.render(), 'Create device model'); const first = create.props.onClick(); await create.props.onClick(); assert.equal(calls.length, 1);
  finish(Response.json({ error: 'Already exists' }, { status: 409 })); await first; assert.equal(inputs(h.render())[0].props.value, 'Model');
  const second = button(h.render(), 'Create device model').props.onClick(); finish(Response.json({ reference: model }, { status: 201 })); await second;
  assert.equal(calls[0][0], '/api/store-admin/catalog/shared/models/inline'); assert.deepEqual(JSON.parse(calls[0][1].body), { name: 'Model', brandId: 'brand' });
  assert.deepEqual(busy, [true, false, true, false]); assert.equal(saved[0][1].id, 'model'); assert.equal(inputs(h.render())[0].props.value, '');
});

test('ambiguous colour POST preserves input, forbids retries, recovers via reference-only GET', async () => {
  const calls = [], saved = [];
  const h = harness(inlineFile, 'SharedListInlineCreator', { kind: 'colours', brands: [], canCreate: true, onCreated: (...args) => saved.push(args) }, { fetch: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error('private detail'); return Response.json({ snapshot }); } });
  change(inputs(h.render())[0], 'Blue'); change(inputs(h.render())[1], '#123abc'); await button(h.render(), 'Create colour').props.onClick();
  assert.equal(inputs(h.render())[0].props.value, 'Blue'); assert.equal(button(h.render(), 'Create colour').props.disabled, true);
  await button(h.render(), 'Create colour').props.onClick(); assert.equal(calls.length, 1);
  await button(h.render(), 'Check saved shared list').props.onClick(); assert.equal(calls[1][0], '/api/store-admin/catalog/shared/colours'); assert.equal(calls[1][1].cache, 'no-store'); assert.equal(saved.length, 1);
});

test('single inline near match requires explicit acknowledgment and sends only optional narrow flag', async () => {
  const calls = [];
  const h = harness(inlineFile, 'SharedListInlineCreator', { kind: 'colours', brands: [], canCreate: true, onCreated() {} }, { fetch: async (...args) => { calls.push(args); return calls.length === 1 ? Response.json({ error: 'Near match: Blu', code: 'SHARED_NEAR_MATCH' }, { status: 409 }) : Response.json({ reference: colour }, { status: 201 }); } });
  change(inputs(h.render())[0], 'Blue'); change(inputs(h.render())[1], '#123ABC'); await button(h.render(), 'Create colour').props.onClick();
  assert.equal(button(h.render(), 'Create colour').props.disabled, true); await button(h.render(), 'Create colour').props.onClick(); assert.equal(calls.length, 1);
  nodes(h.render(), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  await button(h.render(), 'Create colour').props.onClick(); assert.deepEqual(JSON.parse(calls[1][1].body), { name: 'Blue', hex: '#123ABC', confirmNearMatch: true });
});

test('upload uses strict UTF-8 with BOM/header/newline accounting and two size checks', async () => {
  const { decodeSharedUpload } = load(managerFile, managerMocks);
  const file = bytes => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  assert.equal(await decodeSharedUpload(file(Buffer.from('﻿name,hex\r\nBlue,#123ABC\r\n'))), '﻿name,hex\r\nBlue,#123ABC\r\n');
  await assert.rejects(decodeSharedUpload(file(Uint8Array.from([0xc3, 0x28]))), /UTF-8/);
  await assert.rejects(decodeSharedUpload({ size: 262145, arrayBuffer() { assert.fail('must not read'); } }), /256 KiB/);
  await assert.rejects(decodeSharedUpload({ size: 0, arrayBuffer: async () => new ArrayBuffer(262145) }), /256 KiB/);
});

test('shared input has a stable explicit label after repeated entry and unique IDs across model/colour managers', () => {
  const ids = [];
  for (const kind of ['models', 'colours']) {
    const h = harness(managerFile, 'SharedListManager', { kind, snapshot, canManage: true }, {}, managerMocks);
    const check = () => {
      const tree = h.render();
      const input = nodes(tree, node => node.type === 'textarea')[0];
      const label = nodes(tree, node => node.type === 'label' && node.props.htmlFor === input.props.id)[0];
      assert.ok(input.props.id);
      assert.equal(label.props.children, 'Shared-list input');
      assert.equal(nodes(label, node => node.type === 'textarea').length, 0);
      const description = nodes(tree, node => node.props.id === input.props['aria-describedby'])[0];
      assert.ok(description, 'the input instructions remain associated with the control');
      assert.match(description.props.children, /preview it before confirming/);
      return input;
    };
    const id = check().props.id;
    for (const text of ['Blue #123ABC', 'Blu #456789', '']) {
      change(check(), text);
      assert.equal(check().props.id, id);
      assert.equal(check().props.value, text);
    }
    ids.push(id);
  }
  assert.equal(new Set(ids).size, 2);
});

test('read-only shared pages display named hex swatches without management controls', () => {
  const { SharedListManager } = load(managerFile, managerMocks);
  const html = renderToStaticMarkup(React.createElement(SharedListManager, { kind: 'colours', snapshot }));
  assert.match(html, /Blue.*#123ABC/); assert.match(html, /Browse only/); assert.doesNotMatch(html, /Download|Save shared reference|Confirm valid|<form/);
});

test('near match requires explicit acknowledgment and exact input/server token on confirmation', async () => {
  const calls = [];
  const h = harness(managerFile, 'SharedListManager', { kind: 'colours', snapshot, canManage: true }, { fetch: async (...args) => { calls.push(args); return calls.length === 1 ? Response.json(preview([row('near', { suggestions: ['Blu'] })])) : calls.length === 2 ? Response.json({ created: 1, existing: 0, invalid: 0, noop: false }) : Response.json({ snapshot }); } }, managerMocks);
  change(nodes(h.render(), node => node.type === 'textarea')[0], 'Blue #123ABC'); assert.equal(button(h.render(), 'Confirm valid new rows'), undefined);
  await button(h.render(), 'Preview shared list').props.onClick(); assert.equal(button(h.render(), 'Confirm valid new rows').props.disabled, true);
  nodes(h.render(), node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false)[0].props.onChange({ target: { checked: true } });
  await button(h.render(), 'Confirm valid new rows').props.onClick();
  assert.deepEqual(JSON.parse(calls[1][1].body), { input: { kind: 'colours', format: 'paste', text: 'Blue #123ABC' }, token: 'server-preview-token', acknowledgedRows: [2] });
  assert.equal(nodes(h.render(), node => node.type === 'textarea')[0].props.value, 'Blue #123ABC'); assert.equal(button(h.render(), 'Confirm valid new rows'), undefined);
});

test('edits invalidate preview; stale apply preserves input and requires fresh preview', async () => {
  let calls = 0;
  const h = harness(managerFile, 'SharedListManager', { kind: 'colours', snapshot, canManage: true }, { fetch: async () => { calls++; return calls < 3 ? Response.json(preview([row()])) : Response.json({ error: 'stale' }, { status: 409 }); } }, managerMocks);
  const textarea = () => nodes(h.render(), node => node.type === 'textarea')[0]; change(textarea(), 'Blue #123ABC'); await button(h.render(), 'Preview shared list').props.onClick();
  change(textarea(), 'Other #123ABC'); assert.equal(button(h.render(), 'Confirm valid new rows'), undefined); await button(h.render(), 'Preview shared list').props.onClick(); await button(h.render(), 'Confirm valid new rows').props.onClick();
  assert.equal(textarea().props.value, 'Other #123ABC'); assert.equal(button(h.render(), 'Confirm valid new rows'), undefined);
  assert.ok(nodes(h.render(), node => node.props.role === 'alert').some(node => /Refresh the preview/.test(node.props.children)));
});

test('deactivation paginates named uses before confirmed PUT without rewriting products', async () => {
  const calls = [];
  const h = harness(managerFile, 'SharedListManager', { kind: 'colours', snapshot, canManage: true }, { fetch: async (...args) => { calls.push(args); if (calls.length === 1) return Response.json({ rows: [{ productId: 'p', productName: 'Named product', label: 'Saved option', active: true }], nextCursor: 'next' }); if (calls.length === 2) return Response.json({ rows: [], nextCursor: null }); return Response.json(calls.length === 3 ? { ok: true } : { snapshot }); } }, managerMocks);
  button(h.render(), 'Edit Blue').props.onClick(); nodes(h.render(), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  await button(h.render(), 'Save shared reference').props.onClick(); assert.equal(calls.length, 1); assert.match(calls[0][0], /\/uses\?id=colour/);
  assert.ok(nodes(h.render(), node => node.type === 'li').some(node => String(node.props.children).includes('Named product')));
  await button(h.render(), 'Load more affected uses').props.onClick(); assert.match(calls[1][0], /cursor=next/);
  await button(h.render(), 'Confirm deactivation').props.onClick(); assert.equal(calls[2][1].method, 'PUT'); assert.equal(JSON.parse(calls[2][1].body).confirmDeactivation, true);
});

test('model edit keeps parent identity and owner near edits require acknowledgment reset on changes', async () => {
  const calls = [];
  const h = harness(managerFile, 'SharedListManager', { kind: 'models', snapshot, canManage: true }, { fetch: async (...args) => { calls.push(args); return calls.length === 1 ? Response.json({ error: 'Near match: Another', code: 'SHARED_NEAR_MATCH' }, { status: 409 }) : calls.length === 2 ? Response.json({ ok: true }) : Response.json({ snapshot }); } }, managerMocks);
  button(h.render(), 'Edit Model').props.onClick(); change(inputs(h.render())[0], 'Another model');
  await button(h.render(), 'Save shared reference').props.onClick(); assert.equal(JSON.parse(calls[0][1].body).brandId, 'brand');
  assert.equal(button(h.render(), 'Save shared reference').props.disabled, true);
  nodes(h.render(), node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false)[0].props.onChange({ target: { checked: true } });
  assert.equal(button(h.render(), 'Save shared reference').props.disabled, false);
  await button(h.render(), 'Save shared reference').props.onClick(); assert.equal(JSON.parse(calls[1][1].body).confirmNearMatch, true); assert.equal(JSON.parse(calls[1][1].body).brandId, 'brand');
});

test('download failure reports safely and preserves import input', async () => {
  const h = harness(managerFile, 'SharedListManager', { kind: 'colours', snapshot, canManage: true }, { fetch: async () => Response.json({ error: 'private backend detail' }, { status: 503 }) }, managerMocks);
  change(nodes(h.render(), node => node.type === 'textarea')[0], 'Blue #123ABC');
  await button(h.render(), 'Export shared list CSV').props.onClick();
  assert.equal(nodes(h.render(), node => node.type === 'textarea')[0].props.value, 'Blue #123ABC');
  const alert = nodes(h.render(), node => node.props.role === 'alert')[0]; assert.match(alert.props.children, /CSV download is unavailable/); assert.doesNotMatch(alert.props.children, /private backend detail/);
});

test('invalid/near CSV report delegates formula safety to central rules', () => {
  const { sharedErrorsCsv } = load(managerFile, managerMocks);
  const csv = sharedErrorsCsv([row('invalid', { name: '=DANGER', reason: '+BAD', suggestions: ['@BAD'] })]);
  assert.match(csv, /'=DANGER/); assert.match(csv, /'\+BAD/); assert.match(csv, /'@BAD/);
});

test('protected colours page checks session, owner-only management and safe unavailable state', async () => {
  const file = 'src/app/(store-admin)/store-admin/(protected)/colours/page.tsx';
  const mocks = role => ({ 'next/link': { __esModule: true, default: 'a' }, '@/components/store-admin/SharedListManager': { SharedListManager: 'manager' }, '@/lib/store-admin/auth': { getStoreSession: async () => role ? { role } : null } });
  for (const role of [null, 'store_owner', 'store_admin', 'store_viewer']) {
    let reads = 0;
    const { default: Page } = load(file, { ...mocks(role), '@/lib/store-admin/shared-lists': { loadSharedSnapshot: async () => { reads++; return snapshot; } } });
    const tree = await Page(), managers = nodes(tree, node => node.type === 'manager'); assert.equal(reads, role ? 1 : 0); assert.equal(managers.length, role ? 1 : 0); if (role) assert.equal(managers[0].props.canManage, role === 'store_owner');
  }
  const { default: Page } = load(file, { ...mocks('store_owner'), '@/lib/store-admin/shared-lists': { loadSharedSnapshot: async () => { throw new Error('private detail'); } } });
  const html = renderToStaticMarkup(await Page()); assert.match(html, /Shared colours are unavailable/); assert.doesNotMatch(html, /private detail/);
});

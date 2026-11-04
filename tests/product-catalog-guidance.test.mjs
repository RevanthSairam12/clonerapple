import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import vm from 'node:vm';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, URL, crypto: webcrypto, ...globals,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'next/navigation') return { useRouter: () => ({ push() {}, refresh() {} }) };
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
        return load(['.ts', '.tsx', ''].map(ext => base + ext).find(existsSync), mocks, globals);
      }
      return require(name);
    },
  }, { filename: file });
  return module.exports;
}
function harness(name, globals = {}, mocks = {}) {
  const states = [], dependencies = [], cleanups = [];
  let cursor = 0, changed = false, effects = [];
  const mockReact = { ...React, useId: () => 'test-id', useState(initial) {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => {
      const value = typeof next === 'function' ? next(states[index]) : next;
      if (!Object.is(value, states[index])) { states[index] = value; changed = true; }
    }];
  }, useEffect(effect, deps) {
    const index = cursor++;
    if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) {
      dependencies[index] = deps;
      effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
    }
  } };
  const component = load(path.resolve(`src/components/store-admin/${name}.tsx`), { ...mocks, react: mockReact }, {
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    document: { addEventListener() {}, removeEventListener() {} },
    ...globals,
  })[name];
  return { render(props) {
    let tree, attempts = 0;
    do {
      assert.ok(++attempts < 10, 'effects settle without remounting');
      cursor = 0; changed = false; effects = [];
      tree = component(props);
      effects.forEach(effect => effect());
    } while (changed);
    return tree;
  } };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const button = (tree, text) => nodes(tree, node => node.type === 'button' && node.props.children === text)[0];
const text = tree => {
  if (Array.isArray(tree)) return tree.map(text).join(' ').replace(/\s+/g, ' ');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
};
const attribute = { attributeId: 'watts', key: 'watts', label: 'Wattage', dataType: 'number', options: [], isRequired: true, sortOrder: 0, showInSpecs: true, showInFilters: false, showInSearch: false };
const productType = { id: 'charger', categoryId: 'power', name: 'Charger', requiresCompatibility: false, isActive: true, sortOrder: 0, attributes: [attribute] };
const brand = { id: 'device-brand', name: 'Device brand', isActive: true, sortOrder: 0 };
const model = { id: 'phone', brandId: brand.id, brandName: brand.name, name: 'Phone', isActive: true, sortOrder: 0 };
const empty = { types: [], brands: [], models: [] };
const references = { types: [productType], brands: [brand], models: [model] };
const draft = () => ({ productTypeId: null, deviceModelIds: [], attributeValues: {} });
const fieldProps = overrides => ({ references, categoryId: 'power', value: draft(), onChange() {}, ...overrides });
const fields = load(path.resolve('src/components/store-admin/ProductMetadataFields.tsx'));
const renderFields = props => renderToStaticMarkup(React.createElement(fields.ProductMetadataFields, fieldProps(props)));
const metadataNode = tree => nodes(tree, node => node.type?.name === 'ProductMetadataFields')[0];
const product = { catalogRevision: 1, id: 'charger', name: 'Charger', slug: 'charger', categoryId: 'power', pricePaise: 10000, isActive: false, images: [], variants: [], stock: null, description: '', highlights: [], specs: [], inTheBox: [], inventoryMode: 'product' };
const workflowProps = { categories: [{ id: 'power', name: 'Power' }], brands: [], conditions: [], metadataReferences: empty, product };

test('type guidance distinguishes missing category, unconfigured category and inactive category types', () => {
  assert.match(renderFields({ references: empty, categoryId: '' }), /Choose a category first/);
  assert.match(renderFields({}), /No type selected \(optional\)/);
  assert.doesNotMatch(renderFields({ references: empty }), /draft only|add one before publication|activate a suitable type before publication/);
  assert.match(renderFields({ references: empty }), /No product types are configured for this category/);
  assert.match(renderFields({ references: { ...references, types: [{ ...productType, isActive: false }] } }), /All product types for this category are inactive/);
  assert.doesNotMatch(renderFields({}), /No product types are configured|All product types.*inactive|Choose a category first/);
});

test('management links preserve the draft tab, scope category safely, and explain brand versus fit', () => {
  const h = harness('ProductMetadataFields');
  const tree = h.render(fieldProps({ categoryId: 'power & charging' }));
  const links = nodes(tree, node => node.type === 'a');
  assert.deepEqual(links.map(node => node.props.href), [
    '/store-admin/catalog?section=types&category=power%20%26%20charging',
    '/store-admin/catalog?section=devices',
    '/store-admin/catalog?section=details&category=power%20%26%20charging',
  ]);
  for (const link of links) { assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer'); }
  assert.match(text(tree), /Product type describes what you sell/);
  assert.match(text(tree), /Product brand is the accessory maker/);
  assert.match(text(tree), /Only an owner can change catalogue records/);
  assert.equal(button(tree, 'Reload catalogue choices').props.type, 'button');
});

test('device guidance separates no active models, search misses, and already selected matches', () => {
  const h = harness('ProductMetadataFields');
  let props = fieldProps({ value: { ...draft(), deviceModelIds: ['phone'] } });
  let tree = h.render(props);
  assert.match(text(tree), /All matching device models are already selected/);
  nodes(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.onChange({ target: { value: 'missing' } });
  tree = h.render(props);
  assert.match(text(tree), /No devices match your search/);
  assert.doesNotMatch(text(tree), /No active device models are available/);
  props = { ...props, references: { ...references, brands: [{ ...brand, isActive: false }] } };
  tree = h.render(props);
  assert.match(text(tree), /No active device models are available/);
  assert.match(text(tree), /device brand inactive or unavailable — review/);
  assert.equal(nodes(tree, node => node.type === 'optgroup').length, 0);
  assert.deepEqual(props.value.deviceModelIds, ['phone']);
});

test('explicit reload updates detail fields and parent references without touching selected IDs, edits, or clear requests', async () => {
  const requests = [], updates = [], edits = [];
  let release;
  const h = harness('ProductMetadataFields', { fetch: (url, init) => { requests.push([url, init]); return new Promise(resolve => { release = resolve; }); } });
  const value = { productTypeId: 'charger', deviceModelIds: ['phone', 'unknown'], attributeValues: { watts: 0, old: false, cleared: null } };
  const props = fieldProps({ references: empty, value, onChange: next => edits.push(next), onReferencesChange: next => updates.push(next) });
  let tree = h.render(props);
  const promise = button(tree, 'Reload catalogue choices').props.onClick();
  tree = h.render(props);
  assert.equal(button(tree, 'Reloading catalogue choices…').props.disabled, true);
  release({ ok: true, json: async () => ({ references, state: null }) });
  await promise;
  tree = h.render(props);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/store-admin/catalog/metadata/types');
  assert.equal(requests[0][1].method, 'GET'); assert.equal(requests[0][1].cache, 'no-store');
  assert.equal(requests[0][1].body, undefined);
  assert.equal(updates[0], references); assert.equal(edits.length, 0);
  assert.equal(nodes(tree, node => node.type?.name === 'ProductAttributes')[0].props.attributes[0], attribute);
  assert.equal(nodes(tree, node => node.type?.name === 'ProductAttributes')[0].props.changes, value.attributeValues);
  assert.match(text(tree), /Catalogue choices reloaded/);
  assert.match(text(tree), /unknown \(unavailable — review\)/);
  assert.deepEqual(value, { productTypeId: 'charger', deviceModelIds: ['phone', 'unknown'], attributeValues: { watts: 0, old: false, cleared: null } });
});

test('reload failures retain old choices and draft, expose retry, and never publish server error details', async () => {
  for (const response of [
    { ok: false, json: async () => ({ error: 'private error' }) },
    { ok: true, json: async () => ({ references: { types: [] } }) },
    { ok: true, json: async () => { throw new Error('private JSON error'); } },
    null,
  ]) {
    let calls = 0;
    const h = harness('ProductMetadataFields', { fetch: async () => { calls++; if (!response) throw new Error('private network error'); return response; } });
    const props = fieldProps({ value: { ...draft(), productTypeId: 'charger' }, onChange() { assert.fail('reload must not edit draft'); }, onReferencesChange() { assert.fail('failed reload must not replace references'); } });
    let tree = h.render(props);
    await button(tree, 'Reload catalogue choices').props.onClick();
    tree = h.render(props);
    assert.match(text(tree), /Could not reload catalogue choices/);
    assert.doesNotMatch(text(tree), /private/);
    assert.equal(nodes(tree, node => node.type?.name === 'ProductAttributes')[0].props.attributes[0], attribute);
    assert.equal(button(tree, 'Reload catalogue choices').props.disabled, false);
    await button(tree, 'Reload catalogue choices').props.onClick();
    assert.equal(calls, 2);
  }
});

test('new reference props synchronize choices but retain search, compatibility switch, and metadata draft', () => {
  const h = harness('ProductMetadataFields');
  const value = { productTypeId: 'charger', deviceModelIds: [], attributeValues: { watts: 30, old: false, cleared: null } };
  const props = fieldProps({ references: empty, value });
  let tree = h.render(props);
  nodes(tree, node => node.props?.role === 'switch')[0].props.onChange({ target: { checked: true } });
  tree = h.render(props);
  nodes(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.onChange({ target: { value: 'phone' } });
  tree = h.render({ ...props, references });
  assert.equal(nodes(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.value, 'phone');
  assert.equal(nodes(tree, node => node.props?.role === 'switch')[0].props.checked, true);
  assert.equal(nodes(tree, node => node.type?.name === 'ProductAttributes')[0].props.attributes[0], attribute);
  assert.equal(nodes(tree, node => node.type?.name === 'ProductAttributes')[0].props.changes, value.attributeValues);
});

test('workflow uses refreshed references for readiness, option labels and scoped save, retaining other unsaved edits', async () => {
  const requests = [];
  let refreshes = 0;
  const h = harness('ProductWorkflow', { fetch: async (url, init) => { requests.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ product: { id: product.id, catalogRevision: 9 } }) }; } }, {
    'next/navigation': { useRouter: () => ({ push() {}, refresh() { refreshes++; } }) },
  });
  let tree = h.render(workflowProps);
  nodes(tree, node => node.type === 'input' && node.props.value === 'Charger')[0].props.onChange({ target: { value: 'Unsaved charger' } });
  metadataNode(tree).props.onChange({ productTypeId: 'charger', deviceModelIds: ['phone'], attributeValues: { watts: 30, hidden: false, cleared: null } });
  tree = h.render(workflowProps);
  assert.match(text(tree), /Needs attention — Classification and compatibility/);
  metadataNode(tree).props.onReferencesChange(references);
  tree = h.render(workflowProps);
  assert.equal(refreshes, 0, 'reloading choices must not refresh or remount the product route');
  assert.match(text(tree), /Ready — Classification and compatibility/);
  assert.equal(nodes(tree, node => node.type === 'input' && node.props.value === 'Unsaved charger').length, 1);
  assert.equal(metadataNode(tree).props.value.attributeValues.hidden, false);
  const combineLabel = nodes(tree, node => node.type === 'label' && text(node).includes('Create a sub-item for each selected compatible device'))[0];
  nodes(combineLabel, node => node.type === 'input')[0].props.onChange({ target: { checked: true } });
  button(h.render(workflowProps), 'Generate options').props.onClick();
  tree = h.render(workflowProps);
  const preview = nodes(tree, node => node.type === 'fieldset' && text(node).includes('Review physical combinations'))[0];
  const candidate = nodes(preview, node => node.type === 'label' && text(node).trim() === 'Phone')[0];
  assert.ok(candidate, 'candidate preview uses reloaded model names');
  const selection = nodes(candidate, node => node.type === 'input' && node.props.type === 'checkbox')[0];
  assert.equal(selection.props.checked, false, 'preview does not implicitly add a physical option');
  selection.props.onChange({ target: { checked: true } });
  button(h.render(workflowProps), 'Add selected combinations').props.onClick();
  tree = h.render(workflowProps);
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/store-admin/catalog/products/draft');
  assert.deepEqual(requests[0][1].metadata, { productTypeId: 'charger', deviceModelIds: ['phone'], attributeValues: { watts: 30 } });
  assert.equal(requests[0][1].product.name, 'Unsaved charger');
  assert.equal(requests[0][1].product.pricePaise, 10000);
  assert.equal(requests[0][1].options[0].deviceModelId, 'phone');
  assert.equal(requests[0][1].options[0].pricePaise, undefined);
});

test('workflow reference prop changes update child choices without resetting the draft or dirty state', () => {
  const h = harness('ProductWorkflow');
  let tree = h.render(workflowProps);
  metadataNode(tree).props.onChange({ productTypeId: 'charger', deviceModelIds: ['phone'], attributeValues: { watts: 0, cleared: null } });
  tree = h.render({ ...workflowProps, metadataReferences: references });
  assert.equal(metadataNode(tree).props.references, references);
  assert.equal(metadataNode(tree).props.value.attributeValues.watts, 0);
  assert.equal(metadataNode(tree).props.value.attributeValues.cleared, null);
  assert.match(text(tree), /You have unsaved changes/);
});

test('inactive parent device brands cannot satisfy the workflow compatibility publication check', () => {
  const h = harness('ProductWorkflow');
  const refs = { ...references, types: [{ ...productType, requiresCompatibility: true }], brands: [{ ...brand, isActive: false }] };
  const props = { ...workflowProps, metadataReferences: refs };
  let tree = h.render(props);
  metadataNode(tree).props.onChange({ productTypeId: 'charger', deviceModelIds: ['phone'], attributeValues: { watts: 30 } });
  tree = h.render(props);
  assert.match(text(tree), /Select at least one active compatible device model/);
});

test('dirty-navigation guard allows management new tabs but still confirms same-tab exits', () => {
  let click, confirmations = 0;
  class Anchor {
    constructor(target) { this.target = target; this.href = 'https://example.test/store-admin/catalog?section=types'; }
    closest() { return this; }
  }
  const h = harness('ProductWorkflow', {
    Element: Anchor, HTMLAnchorElement: Anchor,
    window: { location: { href: 'https://example.test/store-admin/products/charger', origin: 'https://example.test', pathname: '/store-admin/products/charger', search: '' }, addEventListener() {}, removeEventListener() {}, confirm() { confirmations++; return false; } },
    document: { addEventListener(name, handler) { if (name === 'click') click = handler; }, removeEventListener() {} },
  });
  let tree = h.render(workflowProps);
  metadataNode(tree).props.onChange({ ...draft(), productTypeId: 'charger' });
  h.render(workflowProps);
  let prevented = false;
  const event = target => ({ target: new Anchor(target), defaultPrevented: false, preventDefault() { prevented = true; }, stopPropagation() {} });
  click(event('_blank'));
  assert.equal(confirmations, 0); assert.equal(prevented, false);
  click(event(''));
  assert.equal(confirmations, 1); assert.equal(prevented, true);
});

test('metadata puts optional type, mapped fields and setup links inside advanced disclosure', () => {
  const h = harness('ProductMetadataFields');
  const value = { productTypeId: 'charger', deviceModelIds: ['phone'], attributeValues: { watts: 0, other: false, cleared: null } };
  const tree = h.render(fieldProps({ value }));
  const disclosure = nodes(tree, node => node.type === 'details' && text(node).startsWith('Advanced: optional product type and detail fields'))[0];
  assert.ok(disclosure);
  assert.equal(nodes(disclosure, node => node.type === 'a').length, 3);
  assert.equal(nodes(disclosure, node => node.type?.name === 'ProductAttributes').length, 1);
  assert.match(text(disclosure), /Clear requested/);
  assert.equal(nodes(disclosure, node => node.props?.role === 'switch').length, 0);
  assert.equal(nodes(tree, node => node.type?.name === 'DeviceReferenceCreator').length, 0, 'owner management is opt-in');
});

test('owner model creator merges and reloads references without selecting a model or editing the product', async () => {
  let release;
  const updates = [], busy = [];
  const h = harness('ProductMetadataFields', { fetch: () => new Promise(resolve => { release = resolve; }) });
  const value = { productTypeId: 'charger', deviceModelIds: ['phone'], attributeValues: { watts: 0, other: false, cleared: null } };
  const props = fieldProps({ value, canManageDevices: true, canCreateShared: true, onChange() { assert.fail('creation must not edit product'); }, onReferencesChange: next => updates.push(next), onDeviceBusyChange: next => busy.push(next) });
  let tree = h.render(props);
  let creator = nodes(tree, node => node.type?.name === 'SharedListInlineCreator' && node.props.kind === 'models')[0];
  assert.equal(creator.props.kind, 'models'); assert.equal(creator.props.canCreate, true);
  creator.props.onBusyChange(true);
  tree = h.render(props);
  assert.equal(busy.at(-1), true);
  const created = { ...model, id: 'new-phone', name: 'New Phone' };
  creator = nodes(tree, node => node.type?.name === 'SharedListInlineCreator' && node.props.kind === 'models')[0];
  creator.props.onCreated('models', created);
  creator.props.onBusyChange(false);
  tree = h.render(props);
  assert.match(text(tree), /New Phone saved.*not selected/);
  assert.deepEqual(JSON.parse(JSON.stringify(updates[0].models.at(-1))), created);
  assert.equal(busy.at(-1), true, 'reload remains busy after creator POST settles');
  release({ ok: true, json: async () => ({ references }) }); // Even a stale read must not discard the validated creation.
  await new Promise(resolve => setImmediate(resolve));
  tree = h.render(props);
  assert.equal(busy.at(-1), false);
  assert.equal(updates.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(updates[1].models.at(-1))), created);
  assert.deepEqual(value.deviceModelIds, ['phone']);
  assert.deepEqual(value.attributeValues, { watts: 0, other: false, cleared: null });
  assert.match(text(tree), /Catalogue choices reloaded/);
  assert.equal(nodes(tree, node => node.type === 'form').length, 0);
});

test('successful model creation followed by reload failure keeps saved choice and is not a false creation failure', async () => {
  const h = harness('ProductMetadataFields', { fetch: async () => { throw new Error('private network error'); } });
  const props = fieldProps({ canManageDevices: true, canCreateShared: true, value: { ...draft(), deviceModelIds: ['phone'] }, onChange() { assert.fail('no auto selection'); } });
  let tree = h.render(props);
  nodes(tree, node => node.type?.name === 'SharedListInlineCreator' && node.props.kind === 'models')[0].props.onCreated('models', { ...model, id: 'new-phone', name: 'New Phone' });
  await new Promise(resolve => setImmediate(resolve));
  tree = h.render(props);
  assert.match(text(tree), /Device reference saved, but catalogue choices could not be reloaded/);
  assert.match(text(tree), /do not create it again/);
  assert.match(text(tree), /not selected/);
  assert.doesNotMatch(text(tree), /private network error/);
  assert.equal(nodes(tree, node => node.type === 'option' && node.props.value === 'new-phone').length, 1);
});

test('inline brand creation works from an empty catalogue and aggregates creator dirty and busy states', async () => {
  const busy = [], dirty = [];
  let refreshed;
  const h = harness('ProductMetadataFields', { fetch: async () => ({ ok: true, json: async () => ({ references: empty }) }) });
  const props = fieldProps({ references: empty, canManageDevices: true, canCreateShared: true, onReferencesChange: value => { refreshed = value; }, onDeviceBusyChange: value => busy.push(value), onDeviceDirtyChange: value => dirty.push(value), onChange() { assert.fail('must not edit product'); } });
  const creators = tree => nodes(tree, node => node.type?.name === 'DeviceReferenceCreator' || node.type?.name === 'SharedListInlineCreator');
  let tree = h.render(props);
  const brandCreator = creators(tree).find(node => node.props.kind === 'brands');
  brandCreator.props.onDirtyChange(true); brandCreator.props.onBusyChange(true);
  tree = h.render(props);
  assert.equal(dirty.at(-1), true); assert.equal(busy.at(-1), true);
  assert.equal(creators(tree).find(node => node.props.kind === 'models').props.disabled, true);
  brandCreator.props.onCreated('brands', brand);
  brandCreator.props.onDirtyChange(false); brandCreator.props.onBusyChange(false);
  await new Promise(resolve => setImmediate(resolve));
  tree = h.render(props);
  assert.equal(refreshed.brands[0].id, brand.id);
  assert.equal(creators(tree).find(node => node.props.kind === 'models').props.brands[0].id, brand.id);
  assert.equal(dirty.at(-1), false); assert.equal(busy.at(-1), false);
  assert.match(text(tree), /not selected for this product/);
});

test('advanced product settings explain legacy brand/material and display-only badge and ordering', () => {
  const { ProductWorkflow } = load(path.resolve('src/components/store-admin/ProductWorkflow.tsx'));
  const html = renderToStaticMarkup(React.createElement(ProductWorkflow, workflowProps));
  for (const guidance of [/Legacy free-text product brand label/, /does not fill or replace a material detail field/, /does not activate a sale/, /not its publication or stock status/, /Lower numbers appear first where manual product ordering is used/]) assert.match(html, guidance);
});

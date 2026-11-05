import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
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
        const target = ['.ts', '.tsx', ''].map(extension => base + extension).find(candidate => existsSync(candidate));
        return load(target, mocks, globals);
      }
      return require(name);
    },
  }, { filename: file });
  return module.exports;
}
const { ProductWorkflow } = load(path.resolve('src/components/store-admin/ProductWorkflow.tsx'));
const props = { categories: [{ id: 'power', name: 'Power' }], brands: [], conditions: [], metadataReferences: { types: [], brands: [], models: [] } };
const references = { types: [], brands: [{ id: 'brand', name: 'Brand', isActive: true }], models: [{ id: 'phone-a', brandId: 'brand', brandName: 'Brand', name: 'Phone A', isActive: true }, { id: 'phone-b', brandId: 'brand', brandName: 'Brand', name: 'Phone B', isActive: true }] };
function harness(relative, globals = {}) {
  const states = []; let cursor = 0;
  const mockReact = { ...React, useEffect() {}, useId: () => 'test-id', useState(initial) {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  } };
  const component = load(path.resolve(relative), { react: mockReact }, globals);
  return { render(name, input) { cursor = 0; return component[name](input); } };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function byLabel(tree, label) { return nodes(tree, node => node.props?.['aria-label'] === label)[0]; }
function button(tree, text) { return nodes(tree, node => node.type === 'button' && node.props.children === text)[0]; }
const productBase = { catalogRevision: 2, id: 'case', name: 'Case', slug: 'case', categoryId: 'power', pricePaise: 10000, isActive: false, images: [], variants: [], stock: null, description: '', highlights: [], specs: [], inTheBox: [], inventoryMode: 'product' };

test('shared inline capability is separate from owner-only brand management and never selects a reference', () => {
  for (const role of ['store_owner', 'store_admin', 'store_viewer']) {
    const h = harness('src/components/store-admin/ProductMetadataFields.tsx');
    let changed = 0;
    const tree = h.render('ProductMetadataFields', { references, categoryId: 'power', value: { productTypeId: null, deviceModelIds: [], attributeValues: {} }, onChange() { changed++; }, canCreateShared: role !== 'store_viewer', canManageDevices: role === 'store_owner' });
    const shared = nodes(tree, node => node.type?.name === 'SharedListInlineCreator');
    assert.equal(shared.length, role === 'store_viewer' ? 0 : 2);
    assert.deepEqual(shared.map(node => node.props.kind), role === 'store_viewer' ? [] : ['models', 'colours']);
    const ownerCreators = nodes(tree, node => node.type?.name === 'DeviceReferenceCreator');
    assert.equal(ownerCreators.length, role === 'store_owner' ? 1 : 0); if (ownerCreators.length) assert.equal(ownerCreators[0].props.kind, 'brands');
    if (shared.length) shared.find(node => node.props.kind === 'colours').props.onCreated('colours', { id: 'colour', name: 'Blue', hex: '#123ABC', isActive: true, sortOrder: 0 });
    assert.equal(changed, 0, 'shared reference creation must not select or rewrite controlled product draft');
  }
});

test('compatible-device switch reveals dropdown, adds selected device, and clears only after confirmation', () => {
  const h = harness('src/components/store-admin/ProductMetadataFields.tsx', { window: { confirm: () => true } });
  let value = { productTypeId: null, deviceModelIds: [], attributeValues: {} };
  const render = () => h.render('ProductMetadataFields', { references, categoryId: 'power', value, onChange: next => { value = next; } });
  let tree = render();
  assert.equal(nodes(tree, node => node.type === 'select').length, 1, 'only type dropdown while off');
  nodes(tree, node => node.props?.role === 'switch')[0].props.onChange({ target: { checked: true } });
  tree = render();
  const dropdown = nodes(tree, node => node.type === 'select')[1];
  assert.ok(dropdown);
  dropdown.props.onChange({ target: { value: 'phone-a' } });
  assert.deepEqual(Array.from(value.deviceModelIds), ['phone-a']);
  nodes(render(), node => node.props?.role === 'switch')[0].props.onChange({ target: { checked: false } });
  assert.equal(value.deviceModelIds.length, 0);
  assert.equal(nodes(render(), node => node.type === 'select').length, 1);
});

test('saved compatibility starts active, exposes saved selection and keeps it when clearing is cancelled', () => {
  const h = harness('src/components/store-admin/ProductMetadataFields.tsx', { window: { confirm: () => false } });
  let value = { productTypeId: null, deviceModelIds: ['phone-a'], attributeValues: {} };
  const render = () => h.render('ProductMetadataFields', { references, categoryId: 'power', value, onChange: next => { value = next; } });
  let tree = render();
  assert.equal(nodes(tree, node => node.type === 'select').length, 2);
  assert.equal(nodes(tree, node => node.props?.role === 'switch')[0].props.checked, true);
  nodes(tree, node => node.props?.role === 'switch')[0].props.onChange({ target: { checked: false } });
  assert.equal(value.deviceModelIds[0], 'phone-a');
  assert.equal(nodes(render(), node => node.type === 'select').length, 2);
});

test('model/color generator builds separate exact mappings and rejects missing compatibility or oversized combinations', () => {
  const { productOptionCombinations: generate } = load(path.resolve('src/lib/store-admin/product-option-combinations.ts'));
  const rows = generate('Colour', 'Black, Blue, Black', true, ['phone-a', 'phone-b'], references);
  assert.equal(rows.length, 4);
  assert.deepEqual(Array.from(rows, row => row.optionValue), ['Phone A / Black', 'Phone A / Blue', 'Phone B / Black', 'Phone B / Blue']);
  assert.equal(rows[2].deviceModelId, 'phone-b');
  assert.equal(generate('Model', '', true, ['phone-a'], references)[0].optionValue, 'Phone A');
  assert.throws(() => generate('Colour', 'Black', true, [], references), /Select active compatible/);
  assert.throws(() => generate('Colour', 'a'.repeat(60), true, ['phone-a'], references), /combined label/);
  assert.equal(generate('Colour', 'Black,Black', false, [], references).length, 1);
});

test('saved sub-item replacement preserves old identity, exposes editable label and stages zero stock in the coordinated save', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { window: { confirm: () => true }, fetch: async (url, init) => { requests.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 7 } }) }; } });
  const product = { ...productBase, inventoryMode: 'variant', variants: [{ id: 'original', sku: 'ORIGINAL', optionName: 'Colour', optionValue: 'Black', optionIdentity: 'black', isActive: true, isPurchasable: true, combinationKey: 'black', sortOrder: 0, stock: { onHand: 10, reserved: 2, trackInventory: true, lowStockThreshold: 1 } }] };
  const render = () => h.render('ProductWorkflow', { ...props, product });
  let tree = render();
  assert.equal(nodes(tree, node => node.type === 'input' && node.props.value === 'Black')[0].props.readOnly, true);
  button(tree, 'Archive and replace').props.onClick();
  tree = render();
  const labels = nodes(tree, node => node.type === 'input' && node.props.value === 'Black');
  assert.equal(labels.length, 2);
  assert.equal(labels[1].props.readOnly, false);
  labels[1].props.onChange({ target: { value: 'Blue' } });
  tree = render();
  assert.equal(byLabel(tree, 'Active Blue').props.checked, false, 'replacement requires explicit review/activation');
  byLabel(tree, 'Active Blue').props.onChange({ target: { checked: true } });
  tree = render();
  byLabel(tree, 'In stock for Blue').props.onChange({ target: { value: '4' } });
  await submit(render());
  assert.equal(requests.length, 0, 'replacement receipts require explicit confirmation');
  nodes(render(), node => node.type === 'label' && String(node.props.children?.[1]).includes('Confirm new stock received'))[0].props.children[0].props.onChange({ target: { checked: true } });
  await nodes(render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  // The handler starts save synchronously and awaits the injected fetch response.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/store-admin/catalog/products/draft');
  const [original, replacement] = requests[0][1].options;
  assert.equal(original.id, 'original'); assert.equal(original.isActive, false);
  assert.equal(replacement.id, undefined); assert.equal(replacement.optionValue, 'Blue');
  assert.notEqual(replacement.sku, 'ORIGINAL');
  assert.equal(replacement.stock.onHand, 4); assert.equal(replacement.stock.trackInventory, true);
  assert.equal(replacement.pricePaise, undefined, 'an untouched blank price writes nothing');
  assert.equal(replacement.salePricePaise, undefined, 'an untouched blank sale writes nothing');
});

test('new workflow renders confirmed six-step order, progress, draft default and one coordinated save form', () => {
  const html = renderToStaticMarkup(React.createElement(ProductWorkflow, props));
  const labels = ['1. Basics', '2. Photos', '3. Price and options', '4. Stock', '5. Description', '6. Review and publish'];
  let previous = -1;
  for (const label of labels) { const index = html.indexOf(label); assert.ok(index > previous); previous = index; }
  assert.match(html, /<progress/);
  assert.match(html, /Step 1 of 6/);
  assert.equal((html.match(/<form/g) ?? []).length, 1);
  assert.match(html, /All six sections save together/);
});
test('view-only edit renders every section, stock guide and the editable options table without save action', () => {
  const product = { id: 'case', name: 'Case', slug: 'case', categoryId: 'power', pricePaise: 10000, isActive: false, images: [], variants: [], stock: null, description: '', highlights: [], specs: [], inTheBox: [], inventoryMode: 'product' };
  const html = renderToStaticMarkup(React.createElement(ProductWorkflow, { ...props, product, canEdit: false }));
  assert.equal((html.match(/<section/g) ?? []).length, 6);
  assert.match(html, /fieldset disabled/);
  assert.match(html, /Stock is not limited, so this can be sold without end/);
  assert.match(html, /Limit my stock/);
  assert.match(html, /Ready to publish/);
  assert.doesNotMatch(html, />Save changes</);
  assert.match(html, /Options, price and stock/);
  assert.doesNotMatch(html, /Option prices are read-only/);
});
test('the photo picker renders Media selection, main photo, ordering and the legacy URL fallback', () => {
  const photos = [{ id: 'photo', key: 'photo-1', url: '/fixture.svg', alt: 'Blue case', role: 'primary', sortOrder: 0, colourId: null }];
  const h = harness('src/components/store-admin/ProductPhotoPicker.tsx');
  let tree = h.render('ProductPhotoPicker', { photos, onChange() {}, colours: [], canEdit: true });
  assert.ok(nodes(tree, node => node.type === 'select' && node.props['aria-label'] === 'Photo 1 from Media').length === 1, 'existing Media can be chosen');
  assert.ok(nodes(tree, node => node.type === 'input' && node.props['aria-label'] === 'Photo 1 description').length === 1, 'alt text is editable');
  nodes(tree, node => node.type === 'button' && node.props.children === 'Add photos from Media')[0].props.onClick();
  tree = h.render('ProductPhotoPicker', { photos, onChange() {}, colours: [], canEdit: true });
  assert.equal(nodes(tree, node => node.type === 'summary' && node.props.children === 'Advanced: paste an image URL').length, 1, 'a legacy pasted URL remains available alongside Media');
  assert.equal(nodes(tree, node => node.type === 'button' && [].concat(node.props.children ?? []).join('') === 'Remove photo 1').length, 1);
  const viewerHarness = harness('src/components/store-admin/ProductPhotoPicker.tsx');
  const renderViewer = () => viewerHarness.render('ProductPhotoPicker', { photos, onChange() {}, colours: [], canEdit: false });
  nodes(renderViewer(), node => node.type === 'button' && node.props.children === 'Add photos from Media')[0].props.onClick();
  assert.match(JSON.stringify(renderViewer()), /Only an owner or admin can upload files/, 'viewers cannot upload');
});

test('an options product hides the shared stock box and offers only a guided move from shared stock', () => {
  const product = { ...productBase, stock: { onHand: 10, reserved: 2, trackInventory: true, lowStockThreshold: 0 }, variants: [{ id: 'black', sku: 'BLACK', optionName: 'Colour', optionValue: 'Black', optionIdentity: 'black', isActive: true, isPurchasable: true, combinationKey: 'black', sortOrder: 0, stock: null }] };
  const tree = harness('src/components/store-admin/ProductWorkflow.tsx').render('ProductWorkflow', { ...props, product });
  assert.equal(field(tree, 'In stock'), undefined, 'a product sold by options never shows the shared In stock box');
  assert.equal(nodes(tree, node => node.type === 'legend' && node.props.children === 'Move existing stock into the options').length, 1);
  const move = byLabel(tree, 'Move shared stock to Black');
  assert.ok(move);
  assert.equal(move.props.disabled, true, 'moving shared units is a deliberate activation step, never automatic');
  assert.match(nodes(tree, node => node.type === 'p' && String(node.props.children ?? '').includes('stay in shared stock')).map(node => String(node.props.children)).join(' '), /stay in shared stock/);
});

test('viewers get a read-only options table while admins and owners can edit prices and sales', () => {
  const product = { ...productBase, variants: [{ id: 'black', sku: 'BLACK', optionName: 'Colour', optionValue: 'Black', optionIdentity: 'black', isActive: true, isPurchasable: true, combinationKey: 'black', sortOrder: 0, stock: null }] };
  const viewer = harness('src/components/store-admin/ProductWorkflow.tsx').render('ProductWorkflow', { ...props, product, canEdit: false });
  assert.equal(byLabel(viewer, 'Price for Black').props.readOnly, true);
  assert.equal(byLabel(viewer, 'Sale price for Black').props.readOnly, true);
  assert.ok(nodes(viewer, node => node.type === 'fieldset' && node.props.disabled === true).length > 0, 'the whole form is disabled for a viewer');
  assert.equal(button(viewer, 'Save changes'), undefined, 'a viewer never gets a save action');
  const editor = harness('src/components/store-admin/ProductWorkflow.tsx').render('ProductWorkflow', { ...props, product, canEdit: true });
  assert.equal(byLabel(editor, 'Price for Black').props.readOnly, false);
  assert.equal(byLabel(editor, 'Sale price for Black').props.readOnly, false);
});

test('ordinary edit keeps the coordinated payload and untouched prices unchanged after rendering help', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async (url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 7 } }) }; } });
  const product = { ...productBase, stock: { onHand: 10, reserved: 2, lowStockThreshold: 3, trackInventory: true }, shortDescription: 'Useful case', descriptionSections: [] };
  const render = () => h.render('ProductWorkflow', { ...props, product });
  const before = render();
  const originalName = nodes(before, node => node.type === 'input' && node.props.value === 'Case')[0];
  originalName.props.onChange({ target: { value: 'Clear case' } });
  const tree = render();
  await nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  const payload = requests[0];
  assert.equal(payload.id, 'case');
  assert.equal(payload.product.name, 'Clear case');
  assert.equal(payload.product.pricePaise, 10000);
  assert.equal(payload.product.isActive, false);
  assert.equal(payload.product.trackInventory, true);
  assert.equal(payload.product.initialOnHand, 0);
  assert.equal(payload.stock, undefined, 'unchanged stock emits no adjustment');
  assert.deepEqual(payload.metadata, { productTypeId: null, attributeValues: {} });
  assert.deepEqual(payload.options, []);
  assert.deepEqual(payload.gallery, []);
  assert.equal(payload.descriptionSections, undefined, 'untouched canonical sections are omitted');
  assert.equal(payload.shortDescription, undefined, 'untouched summary is omitted');
  assert.equal(payload.expectedRevision, 2);
  assert.equal(payload.activateVariantInventory, undefined);
});

async function submit(tree) {
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
}
function field(tree, label) { return nodes(tree, node => node.props?.label === label)[0]; }

test('preview selects nothing and only reviewed combinations become sellable', () => {
  const h = harness('src/components/store-admin/ProductWorkflow.tsx');
  const render = () => h.render('ProductWorkflow', { ...props, product: productBase, metadataReferences: references });
  let tree = render();
  field(tree, 'Option type').props.children.props.onChange({ target: { value: 'Colour' } });
  field(tree, 'Option values').props.children.props.onChange({ target: { value: 'Black, BLUE, black' } });
  button(render(), 'Generate options').props.onClick();
  tree = render();
  const preview = nodes(tree, node => node.type === 'fieldset' && node.props.children?.[0]?.props?.children === 'Review physical combinations')[0];
  const choices = nodes(preview, node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(choices.length, 2); assert.ok(choices.every(node => node.props.checked === false));
  assert.equal(byLabel(tree, 'Active Black'), undefined);
  choices[0].props.onChange({ target: { checked: true } });
  button(render(), 'Add selected combinations').props.onClick();
  tree = render();
  assert.equal(byLabel(tree, 'Active Black').props.checked, true);
  assert.equal(byLabel(tree, 'Active BLUE'), undefined);
});

test('semantic duplicates use stable model ID and ignore model display renames', () => {
  const { productOptionCombinations: generate, optionSemanticKey: key } = load(path.resolve('src/lib/store-admin/product-option-combinations.ts'));
  const original = generate('Colour', 'Black', true, ['phone-a'], references)[0];
  const renamed = generate('Colour', ' BLACK ', true, ['phone-a'], { ...references, models: references.models.map(model => ({ ...model, name: 'Renamed' })) })[0];
  assert.equal(key(original), key(renamed));
  const other = generate('Colour', 'Black', true, ['phone-b'], references)[0];
  assert.notEqual(key(original), key(other));
  const collisionRefs = { ...references, models: references.models.map((model, index) => ({ ...model, name: 'Same', brandName: `Brand ${index}` })) };
  const distinct = generate('Colour', 'Black', true, ['phone-a', 'phone-b'], collisionRefs);
  assert.notEqual(distinct[0].optionValue, distinct[1].optionValue);
});

test('same-label replacement starts inactive tracked zero and cancellation restores source state', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { window: { confirm: () => true }, fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 9 } }) }; } });
  const product = { ...productBase, variants: [{ id: 'old', sku: 'OLD', optionName: 'Colour', optionValue: 'Black', optionIdentity: 'black', isActive: true, isPurchasable: true, combinationKey: 'old', sortOrder: 0, stock: { onHand: 12, reserved: 3, trackInventory: false, lowStockThreshold: 2 } }] };
  const render = () => h.render('ProductWorkflow', { ...props, product });
  button(render(), 'Archive and replace').props.onClick();
  let tree = render();
  const toggles = nodes(tree, node => node.props?.['aria-label'] === 'Active Black');
  assert.equal(toggles[0].props.disabled, true); assert.equal(toggles[1].props.checked, false);
  button(tree, 'Cancel replacement').props.onClick();
  assert.equal(byLabel(render(), 'Active Black').props.checked, true);
  button(render(), 'Archive and replace').props.onClick();
  await submit(render());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options[1].optionValue, 'Black');
  assert.equal(requests[0].options[1].isActive, false);
  assert.equal(requests[0].options[1].stock, undefined);
  assert.equal(requests[0].options[1].replacesVariantId, 'old');
});

test('retired history is locked, omitted from writes and does not replace variant mode with parent inputs', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 6 } }) }; } });
  const product = { ...productBase, inventoryMode: 'variant', variants: [{ id: 'old', sku: 'OLD', optionName: 'Colour', optionValue: 'Black', isActive: false, isPurchasable: true, combinationKey: 'old', retiredAt: '2026-11-04', sortOrder: 0, stock: null }] };
  const render = () => h.render('ProductWorkflow', { ...props, product });
  const tree = render();
  assert.equal(byLabel(tree, 'Active Black').props.disabled, true);
  assert.equal(button(tree, 'Archive and replace'), undefined);
  assert.equal(field(tree, 'In stock'), undefined, 'no parent editor even with no active variants');
  await submit(tree);
  assert.deepEqual(requests[0].options, []); assert.equal(requests[0].stock, undefined);
});

test('saved non-null SKU is locked even on a display-only option', () => {
  const h = harness('src/components/store-admin/ProductWorkflow.tsx');
  const product = { ...productBase, variants: [{ id: 'display', sku: 'SAVED', optionName: 'Colour', optionValue: 'Black', isActive: true, isPurchasable: false, sortOrder: 0, stock: null }] };
  const tree = h.render('ProductWorkflow', { ...props, product });
  assert.equal(field(tree, 'SKU').props.children.props.disabled, true);
});

test('conflict retains draft and token and never retries the rejected save', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: false, status: 409, json: async () => ({ code: 'CATALOG_REVISION_CONFLICT', error: 'Changed elsewhere' }) }; } });
  const render = () => h.render('ProductWorkflow', { ...props, product: productBase });
  field(render(), 'Product name').props.children.props.onChange({ target: { value: 'Unsaved name' } });
  await submit(render());
  assert.equal(field(render(), 'Product name').props.children.props.value, 'Unsaved name');
  assert.equal(requests[0].expectedRevision, 2);
  await submit(render()); assert.equal(requests.length, 1);
  assert.ok(button(render(), 'Reload saved product'));
});

test('ambiguous success and transport failure block blind retry while preserving draft', async () => {
  for (const response of [async () => { throw new Error('connection lost'); }, async () => ({ ok: false, status: 503, json: async () => ({ error: 'Service unavailable' }) }), async () => ({ ok: true, json: async () => ({ product: { id: 'case' } }) })]) {
    let requests = 0;
    const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async () => { requests++; return response(); } });
    const render = () => h.render('ProductWorkflow', { ...props, product: productBase });
    await submit(render()); await submit(render());
    assert.equal(requests, 1); assert.ok(button(render(), 'Reload saved product'));
  }
});

test('successful save accepts revision jumps and locks stale identity baseline until remount', async () => {
  let requests = 0;
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async () => { requests++; return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 300 } }) }; } });
  const render = () => h.render('ProductWorkflow', { ...props, product: productBase });
  await submit(render()); await submit(render()); assert.equal(requests, 1);
});

test('untyped publication needs no setup and unchanged legacy content is not adopted', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 8 } }) }; } });
  const product = { ...productBase, isActive: true, description: 'Legacy overview', specs: [{ label: 'Material', value: 'Silicone' }], descriptionSections: null, shortDescription: null };
  await submit(h.render('ProductWorkflow', { ...props, product }));
  assert.equal(requests.length, 1); assert.equal(requests[0].product.isActive, true);
  assert.equal(requests[0].descriptionSections, undefined); assert.equal(requests[0].shortDescription, undefined);
});

test('Basics specs and Description share the same state and explicit edits adopt converted content only once', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 8 } }) }; } });
  const render = () => h.render('ProductWorkflow', { ...props, product: { ...productBase, description: 'Keep overview', descriptionSections: null } });
  let tree = render();
  const specs = nodes(tree, node => node.type?.name === 'ProductSpecificationsEditor')[0];
  specs.props.onChange({ ...specs.props.value, sections: [...specs.props.value.sections, { id: 'new-specs', type: 'specs', title: 'Specifications', hidden: false, rows: [{ label: 'Material', value: 'Silicone' }] }] });
  tree = render();
  const description = nodes(tree, node => node.type?.name === 'ProductDescriptionEditor')[0];
  assert.equal(description.props.value.sections.at(-1).id, 'new-specs');
  await submit(tree);
  assert.equal(requests[0].descriptionSections[0].id, 'legacy-overview');
  assert.equal(requests[0].descriptionSections.at(-1).rows[0].value, 'Silicone');
});

test('activation transfers parent units without also entering them as destination stock', async () => {
  const requests = [];
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 8 } }) }; } });
  const product = { ...productBase, stock: { onHand: 10, reserved: 0, trackInventory: true, lowStockThreshold: 0 }, variants: [{ id: 'black', sku: 'BLACK', optionName: 'Colour', optionValue: 'Black', optionIdentity: 'black', isActive: true, isPurchasable: true, combinationKey: 'black', sortOrder: 0, stock: null }] };
  const render = () => h.render('ProductWorkflow', { ...props, product });
  let tree = render();
  const activation = nodes(tree, node => node.type === 'label' && String(node.props.children?.[1]).includes('Use these options at checkout'))[0];
  activation.props.children[0].props.onChange({ target: { checked: true } });
  tree = render();
  byLabel(tree, 'Move shared stock to Black').props.onChange({ target: { value: '4' } });
  field(tree, 'Stock note (optional)').props.children.props.onChange({ target: { value: 'Allocate physical black units' } });
  byLabel(tree, 'In stock for Black').props.onChange({ target: { value: '4' } });
  await submit(render());
  assert.equal(requests.length, 0, 'transfer must not silently discard a staged destination count edit');
  assert.match(nodes(render(), node => node.props?.role === 'alert')[0].props.children, /Restore destination counts/);
  byLabel(render(), 'In stock for Black').props.onChange({ target: { value: '0' } });
  await submit(render());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options[0].stock.onHand, 0);
  assert.equal(requests[0].activateVariantInventory.allocations[0].quantity, 4);
  assert.equal(requests[0].stock, undefined);
});

test('unsaved inline reference fields block product save until explicitly reset or created', async () => {
  let requests = 0;
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { fetch: async () => { requests++; return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 8 } }) }; } });
  const render = () => h.render('ProductWorkflow', { ...props, product: productBase, canManageDevices: true });
  const metadata = () => nodes(render(), node => node.type?.name === 'ProductMetadataFields')[0];
  metadata().props.onDeviceDirtyChange(true);
  await submit(render());
  assert.equal(requests, 0);
  assert.match(nodes(render(), node => node.props?.role === 'alert')[0].props.children, /Create or reset/);
  metadata().props.onDeviceDirtyChange(false);
  await submit(render());
  assert.equal(requests, 1);
});

test('legacy replacement requires explicit semantic input rather than guessing from a saved label', async () => {
  let requests = 0;
  const h = harness('src/components/store-admin/ProductWorkflow.tsx', { window: { confirm: () => true }, fetch: async () => { requests++; return { ok: true, json: async () => ({ product: { id: 'case', catalogRevision: 8 } }) }; } });
  const product = { ...productBase, variants: [{ id: 'legacy', sku: 'LEGACY', optionName: 'Colour', optionValue: 'Phone A / Black', isActive: true, isPurchasable: true, sortOrder: 0 }] };
  const render = () => h.render('ProductWorkflow', { ...props, product });
  button(render(), 'Archive and replace').props.onClick();
  assert.equal(field(render(), 'Option value identity').props.children.props.value, '');
  await submit(render());
  assert.equal(requests, 0);
  field(render(), 'Option value identity').props.children.props.onChange({ target: { value: 'black' } });
  await submit(render());
  assert.equal(requests, 1);
});

test('workflow stages one endpoint, uses shared paise parser and guards in-app and full-page exits', async () => {
  const source = await readFile(path.resolve('src/components/store-admin/ProductWorkflow.tsx'), 'utf8');
  assert.equal((source.match(/await fetch\(/g) ?? []).length, 1);
  assert.match(source, /parseRupeesToPaise\(value\)/);
  assert.doesNotMatch(source, /Math\.round\(Number\(value\) \* 100\)/);
  assert.match(source, /addEventListener\('beforeunload'/);
  assert.match(source, /document\.addEventListener\('click', warnLink, true\)/);
  assert.match(source, /event\.preventDefault\(\); event\.stopPropagation\(\)/);
});

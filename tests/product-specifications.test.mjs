import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import vm from 'node:vm';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, URL,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
        return load(['.ts', '.tsx', ''].map(ext => base + ext).find(existsSync), mocks);
      }
      return require(name);
    },
  }, { filename: file });
  return module.exports;
}
const file = path.resolve('src/components/store-admin/ProductSpecificationsEditor.tsx');
const components = load(file);
function harness(name) {
  const states = [];
  let cursor = 0;
  const component = load(file, { react: { ...React, useState(initial) {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  } } })[name];
  return { render(props) { cursor = 0; return component(props); } };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const content = value => Array.isArray(value) ? value.map(content).join('') : value && typeof value === 'object' ? content(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
const button = (tree, text) => nodes(tree, node => node.type === 'button' && content(node.props.children) === text)[0];
const rowFragments = tree => nodes(tree, node => node.type?.name === 'ProductSpecificationRows');
const specs = (id, hidden = false) => ({ id, title: id, hidden, type: 'specs', rows: [{ label: 'Material', value: 'Silicone' }, { label: 'Warranty', value: '1 year' }] });
const narrative = { id: 'overview', title: 'Overview', hidden: false, type: 'text', blocks: [{ type: 'paragraph', content: [{ text: 'Original', bold: true }] }] };

test('specifications editor exposes every specs section including hidden without mutating or flattening the description', () => {
  const h = harness('ProductSpecificationsEditor');
  const value = { shortDescription: null, sections: [specs('first'), narrative, specs('hidden', true)] };
  const snapshot = JSON.stringify(value);
  let changed;
  const tree = h.render({ value, onChange: next => { changed = next; } });
  const fragments = rowFragments(tree);
  assert.equal(fragments.length, 2);
  assert.equal(changed, undefined, 'mounting is a no-op');
  assert.equal(fragments[1].props.value, value.sections[2].rows);
  fragments[1].props.onChange([{ label: 'Capacity', value: '100 ml' }]);
  assert.equal(changed.shortDescription, null);
  assert.equal(changed.sections[0], value.sections[0]);
  assert.equal(changed.sections[1], narrative);
  assert.equal(changed.sections[2].id, 'hidden');
  assert.equal(changed.sections[2].hidden, true);
  assert.deepEqual(changed.sections[2].rows, [{ label: 'Capacity', value: '100 ml' }]);
  assert.equal(JSON.stringify(value), snapshot);
  const html = renderToStaticMarkup(React.createElement(components.ProductSpecificationsEditor, { value, onChange() {} }));
  assert.match(html, /hidden — Hidden/);
  assert.doesNotMatch(html, /<form/);
});

test('null and explicit empty sections remain unchanged until explicit add and use collision-free IDs', () => {
  for (const sections of [null, []]) {
    let changed;
    const value = { shortDescription: null, sections };
    const tree = harness('ProductSpecificationsEditor').render({ value, onChange: next => { changed = next; } });
    assert.equal(changed, undefined);
    assert.equal(value.sections, sections);
    button(tree, 'Add specifications section').props.onClick();
    assert.equal(changed.sections.length, 1);
    assert.equal(changed.sections[0].type, 'specs');
    assert.equal(changed.shortDescription, null);
  }
  const value = { shortDescription: '', sections: [{ ...narrative, id: 'section-1' }, specs('section-2')] };
  let changed;
  button(harness('ProductSpecificationsEditor').render({ value, onChange: next => { changed = next; } }), 'Add specifications section').props.onClick();
  assert.equal(changed.sections[2].id, 'section-3');
  assert.equal(changed.sections[0], value.sections[0]);
  assert.equal(changed.sections[1], value.sections[1]);
});

test('controlled specification rows explicitly add, edit, remove and undo removals in original positions', () => {
  const h = harness('ProductSpecificationRows');
  const original = specs('s').rows;
  let value = original;
  const render = () => h.render({ value, onChange: next => { value = next; } });
  let tree = render();
  nodes(tree, node => node.type === 'input' && node.props.value === 'Silicone')[0].props.onChange({ target: { value: 'Leather' } });
  assert.equal(value[0].value, 'Leather');
  assert.equal(original[0].value, 'Silicone');
  button(render(), 'Add specification').props.onClick();
  assert.equal(value.length, 3);
  assert.equal(value[2].label, ''); assert.equal(value[2].value, '');
  button(render(), 'Remove specification 1').props.onClick();
  assert.equal(value.length, 2);
  assert.equal(value[0].label, 'Warranty');
  button(render(), 'Remove specification 1').props.onClick();
  assert.equal(value.length, 1);
  button(render(), 'Undo specification removal').props.onClick();
  assert.equal(value[0].label, 'Warranty');
  button(render(), 'Undo specification removal').props.onClick();
  assert.equal(value[0].value, 'Leather');
  assert.equal(value[1].label, 'Warranty');
  assert.equal(value.length, 3);
  assert.equal(button(render(), 'Undo specification removal'), undefined);
});

test('disabled editors cannot mutate controlled description or rows, and respect collection limits', () => {
  const reject = () => assert.fail('disabled/limit editor must not emit changes');
  const tree = harness('ProductSpecificationsEditor').render({ value: { shortDescription: null, sections: [specs('s')] }, disabled: true, onChange: reject });
  button(tree, 'Add specifications section').props.onClick();
  rowFragments(tree)[0].props.onChange([]);
  const rows = harness('ProductSpecificationRows').render({ value: specs('s').rows, disabled: true, onChange: reject });
  button(rows, 'Add specification').props.onClick();
  button(rows, 'Remove specification 1').props.onClick();
  nodes(rows, node => node.type === 'input')[0].props.onChange({ target: { value: 'blocked' } });
  const full = harness('ProductSpecificationsEditor').render({ value: { shortDescription: '', sections: Array.from({ length: 24 }, (_, i) => specs(`s${i}`)) }, onChange: reject });
  assert.equal(button(full, 'Add specifications section').props.disabled, true);
  button(full, 'Add specifications section').props.onClick();
  const fullRows = harness('ProductSpecificationRows').render({ value: Array.from({ length: 100 }, () => ({ label: '', value: '' })), onChange: reject });
  assert.equal(button(fullRows, 'Add specification').props.disabled, true);
  button(fullRows, 'Add specification').props.onClick();
});

test('Description renders the identical shared controlled rows fragment', () => {
  const states = [];
  let cursor = 0;
  const mockReact = { ...React, useState(initial) { const i = cursor++; states[i] ??= initial; return [states[i], next => { states[i] = next; }]; } };
  const { ProductDescriptionEditor } = load(path.resolve('src/components/store-admin/ProductDescriptionEditor.tsx'), { react: mockReact });
  const value = { shortDescription: '', sections: [specs('s')] };
  let changed;
  const tree = ProductDescriptionEditor({ value, onChange: next => { changed = next; } });
  const fragment = rowFragments(tree)[0];
  assert.ok(fragment);
  assert.equal(fragment.props.value, value.sections[0].rows);
  fragment.props.onChange([]);
  assert.equal(changed.sections[0].id, 's');
  assert.equal(changed.sections[0].rows.length, 0);
  for (const node of nodes(tree, node => node.type === 'button')) assert.equal(node.props.type, 'button');
});

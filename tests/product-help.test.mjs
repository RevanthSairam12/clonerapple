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
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.tsx`));
      if (name.startsWith('@/')) {
        const base = path.resolve('src', name.slice(2));
        return load(['.tsx', '.ts'].map(ext => base + ext).find(existsSync));
      }
      return require(name);
    },
  });
  return module.exports;
}
const { ProductHelp, ProductGuide, productHelpText } = load(path.resolve('src/components/store-admin/ProductHelp.tsx'));
const { ProductField } = load(path.resolve('src/components/store-admin/ProductField.tsx'));
const render = node => renderToStaticMarkup(node);

test('help is a native uncontrolled disclosure, available in disabled forms without submit controls', () => {
  const html = render(React.createElement('fieldset', { disabled: true }, React.createElement(ProductHelp, { label: 'Stock limit' }, 'A clear explanation.')));
  assert.match(html, /fieldset disabled=""/);
  assert.match(html, /<details class="sa-product-help"><summary aria-label="Help for Stock limit"/);
  assert.doesNotMatch(html, /<button|role="tooltip"|title=|<details[^>]*open/);
  assert.match(html, /A clear explanation/);
});

test('field associates explicit label and help while preserving existing descriptions and readonly state', () => {
  const html = render(React.createElement(ProductField, { label: 'Product price', help: 'Enter rupees.' }, React.createElement('input', { id: 'price', readOnly: true, 'aria-describedby': 'existing-error', className: 'sa-input', defaultValue: '499' })));
  assert.match(html, /for="price"/);
  assert.match(html, /id="price"/);
  assert.match(html, /aria-describedby="existing-error ([^"]+)-help"/);
  assert.match(html, /sa-input sa-input-readonly/);
  assert.match(html, /readOnly=""/);
  assert.doesNotMatch(html, /<label[^>]*>[\s\S]*<details[\s\S]*<\/label>/);
});

test('repeated fields have unique help IDs and descriptions refer to rendered text', () => {
  const html = render(React.createElement(ProductGuide, null, ['Black', 'Blue'].map(name => React.createElement('label', { key: name }, name, React.createElement('input', { defaultValue: name, 'aria-describedby': 'existing' })))));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.ok(html.includes(`aria-describedby="existing ${id}"`));
  assert.equal((html.match(/Help for /g) ?? []).length, 2);
  assert.doesNotMatch(html, /<label[^>]*>[^<]*<details/);
});

test('guide preserves control handlers, values and disabled state; help adds no state callbacks', () => {
  let calls = 0;
  const input = React.createElement('input', { 'aria-label': 'In stock for Black', value: '10', disabled: true, onChange: () => calls++ });
  // Inspect returned annotation without executing a hook outside React.
  const html = render(React.createElement(ProductGuide, null, React.createElement('fieldset', { disabled: true }, input, React.createElement('button', { type: 'button', disabled: true, onClick: () => calls++ }, 'Save changes'))));
  assert.match(html, /value="10"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Help for In stock for Black/);
  assert.match(html, /Help for Save changes/);
  assert.equal(calls, 0);
});

test('guide leaves summary and existing help untouched, handles fragments and preserves valid table structure', () => {
  const html = render(React.createElement(ProductGuide, null, React.createElement(React.Fragment, null,
    React.createElement('details', null, React.createElement('summary', null, 'More settings'), React.createElement('button', { type: 'button' }, 'Add photo')),
    React.createElement('table', null, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, 'Stock')))),
    React.createElement('p', null, 'Not limited. ', React.createElement('button', { type: 'button' }, 'Turn on')))));
  assert.match(html, /<summary>More settings<\/summary>/);
  assert.match(html, /<tr><th><span>Stock<\/span><details/);
  assert.match(html, /Help for Add photo/);
  assert.doesNotMatch(html, /<p[^>]*>[\s\S]*<details/);
});

test('help guidance distinguishes stock holds, exact options, sale prices and replacement stock', () => {
  assert.match(productHelpText('Held in checkouts'), /not a count of every pending payment/);
  assert.match(productHelpText('Archive and replace'), /zero stock/);
  // Sale prices are editable per option now; the help explains the rule, not a lock.
  assert.match(productHelpText('Sale price'), /lower than the regular price on the same row/);
  assert.doesNotMatch(productHelpText('Sale price'), /read-only|remains locked/);
  assert.match(productHelpText('Internal cost ₹'), /internal purchase cost/);
  assert.match(productHelpText('Active Black'), /archives it/);
  assert.match(productHelpText('Search title'), /search results/);
  assert.match(productHelpText('Add photo'), /empty photo row/);
  assert.match(productHelpText('Remove photo 1'), /current draft/);
});

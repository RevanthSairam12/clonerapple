import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);

// The same TypeScript+JSX loader the product-workflow tests use. jiti cannot
// transpile this component's JSX, so the helpers and the table are loaded here.
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      URL,
      crypto: webcrypto,
      ...globals,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('.') || name.startsWith('@/')) {
          const base = name.startsWith('@/')
            ? path.resolve('src', name.slice(2))
            : path.resolve(path.dirname(file), name);
          const target = ['.ts', '.tsx', '']
            .map((extension) => base + extension)
            .find((candidate) => existsSync(candidate));
          return load(target, mocks, globals);
        }
        return require(name);
      },
    },
    { filename: file },
  );
  return module.exports;
}

const rules = load(path.resolve('src/lib/store-admin/price-history-rules.ts'));
const { PriceHistoryTable } = load(path.resolve('src/components/store-admin/PriceHistoryTable.tsx'));

const stamp = '2026-11-05T10:00:00.000Z';
const row = (overrides = {}) => ({
  id: 1,
  variantId: null,
  oldPricePaise: 129900,
  newPricePaise: 139900,
  oldSalePricePaise: null,
  newSalePricePaise: null,
  changeGroup: null,
  priceKind: 'regular',
  cleared: false,
  currency: 'INR',
  source: 'store_admin',
  reason: '',
  changedBy: 'staff',
  changedAt: stamp,
  ...overrides,
});

test('a cleared sale is labelled and never shown as zero', () => {
  assert.equal(rules.normalizePriceKind('sale_cleared'), 'sale_cleared');
  assert.equal(rules.normalizePriceKind('option_sale_cleared'), 'sale_cleared', 'legacy kinds stay readable');
  assert.equal(rules.normalizePriceKind('regular'), 'regular');
  assert.equal(rules.normalizePriceKind(null), 'regular');
  assert.equal(rules.priceHistoryKindLabel('regular'), 'Regular price');
  assert.equal(rules.priceHistoryKindLabel('sale'), 'Sale price');
  assert.equal(rules.priceHistoryKindLabel('sale_cleared'), 'Sale cleared');
  assert.equal(rules.priceHistoryIsCleared('sale_cleared'), true);
  assert.equal(rules.priceHistoryAmount(0), null, 'a stored 0 is a sentinel, never a price');
  assert.equal(rules.priceHistoryAmount(null), null);
  assert.equal(rules.priceHistoryAmount(129900), 129900);
  assert.equal(rules.priceHistoryScopeLabel('variant-1'), 'Option');
  assert.equal(rules.priceHistoryScopeLabel(null), 'Product');
});

test('the product history table shows Sale cleared with an em dash', () => {
  const cleared = row({
    id: 2,
    priceKind: 'sale_cleared',
    cleared: true,
    oldSalePricePaise: 99900,
    newSalePricePaise: 0,
    variantId: 'variant-1',
    reason: 'option_sale_cleared',
  });
  const html = renderToStaticMarkup(React.createElement(PriceHistoryTable, { rows: [row(), cleared] }));
  assert.match(html, /Sale cleared/);
  assert.match(html, /Option/);
  assert.doesNotMatch(html, /₹0\.00/);
  assert.doesNotMatch(html, />0\.00</);
  assert.match(html, /₹999\.00/, 'the old sale remains visible');
});

test('an unknown or zero row still cannot render as a real zero price', () => {
  const zero = row({ id: 3, priceKind: 'regular', newPricePaise: 0 });
  const legacy = row({ id: 4, priceKind: 'option_sale_cleared', cleared: false, newSalePricePaise: 0 });
  const html = renderToStaticMarkup(React.createElement(PriceHistoryTable, { rows: [zero, legacy] }));
  assert.doesNotMatch(html, /₹0\.00/);
  assert.match(html, /Sale cleared/, 'legacy kinds are read as a cleared sale even without the mapped flag');
});

test('the history table handles an empty product', () => {
  const html = renderToStaticMarkup(React.createElement(PriceHistoryTable, { rows: [] }));
  assert.match(html, /No price history/);
});

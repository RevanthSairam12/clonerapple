import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createJiti } from 'jiti';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(import.meta.dirname, '..');
const nativeRequire = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const option = await jiti.import(path.join(root, 'src/lib/storefront/option-selection.ts'));
const rules = await jiti.import(path.join(root, 'src/lib/storefront/availability-rules.ts'));

function load(file) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, console, require(name) {
    if (name === 'react/jsx-runtime') return nativeRequire(name);
    if (name === 'react') return nativeRequire(name);
    if (name === '@/lib/storefront/option-selection') return option;
    if (name === '@/lib/storefront/availability-rules') return rules;
    throw new Error(`Unexpected dependency: ${name}`);
  } }, { filename });
  return module.exports;
}
const { OptionSelector } = load('src/components/shop/OptionSelector.tsx');

const RED = { colourId: 'red', colourName: 'Red', colourHex: '#FF3B30' };
const BLACK = { colourId: 'black', colourName: 'Black', colourHex: '#1D1D1F' };
const PHONE = { deviceModelId: 'iphone16', deviceModelName: 'iPhone 16' };
const PRO = { deviceModelId: 'iphone16pro', deviceModelName: 'iPhone 16 Pro' };
const variant = (id, model, colour, pricePaise, extra = {}) => ({
  id, sku: `SKU-${id}`, label: `${model.deviceModelName} / ${colour.colourName}`,
  ...model, ...colour, pricePaise, regularPricePaise: pricePaise, inStock: true, ...extra,
});
const VARIANTS = [
  variant('red', PHONE, RED, 10000),
  variant('black', PHONE, BLACK, 12000),
  variant('pro-red', PRO, RED, 20000),
];

test('only rows the catalogue supplied are offered, model first and then its colours', () => {
  const steps = option.optionSteps(VARIANTS);
  assert.equal(steps.showModel, true);
  assert.equal(steps.showColour, true);
  assert.equal(steps.modelLabel, 'Model');
  assert.deepEqual(steps.models.map(model => [model.key, model.label]), [
    ['iphone16', 'iPhone 16'], ['iphone16pro', 'iPhone 16 Pro'],
  ]);
  assert.deepEqual(steps.models[0].colours.map(colour => colour.label), ['Red', 'Black']);
  assert.deepEqual(steps.models[1].colours.map(colour => colour.label), ['Red']);
  // iPhone 16 Pro never offers Black because no such row exists.
  assert.equal(steps.models[1].colours.some(colour => colour.key === 'black'), false);
});

test('model-only and colour-only products show only the step they have', () => {
  const modelOnly = option.optionSteps([
    { id: 'a', deviceModelId: 'iphone16', deviceModelName: 'iPhone 16', pricePaise: 100 },
    { id: 'b', deviceModelId: 'iphone16pro', deviceModelName: 'iPhone 16 Pro', pricePaise: 200 },
  ]);
  assert.equal(modelOnly.showModel, true);
  assert.equal(modelOnly.showColour, false);

  const colourOnly = option.optionSteps([
    { id: 'a', colourId: 'red', colourName: 'Red', optionName: 'Colour', pricePaise: 100 },
    { id: 'b', colourId: 'blue', colourName: 'Blue', optionName: 'Colour', pricePaise: 100 },
  ]);
  assert.equal(colourOnly.showModel, false);
  assert.equal(colourOnly.showColour, true);
  assert.deepEqual(colourOnly.colours.map(colour => colour.label), ['Red', 'Blue']);

  // A by-another-option product names its own first step.
  const wattage = option.optionSteps([
    { id: 'a', optionName: 'Wattage', optionValue: '20W', pricePaise: 100 },
    { id: 'b', optionName: 'Wattage', optionValue: '35W', pricePaise: 200 },
  ]);
  assert.equal(wattage.showModel, true);
  assert.equal(wattage.modelLabel, 'Wattage');
  assert.equal(wattage.showColour, false);
});

test('the exact row is resolved and no sibling or nonexistent combination substitutes', () => {
  assert.equal(option.resolveOptionVariant(VARIANTS, { modelKey: 'iphone16', colourKey: 'red' })?.id, 'red');
  assert.equal(option.resolveOptionVariant(VARIANTS, { modelKey: 'iphone16', colourKey: 'black' })?.id, 'black');
  assert.equal(option.resolveOptionVariant(VARIANTS, { modelKey: 'iphone16pro', colourKey: 'red' })?.id, 'pro-red');
  // iPhone 16 Pro + Black does not exist; never fall back to iPhone 16 Black.
  assert.equal(option.resolveOptionVariant(VARIANTS, { modelKey: 'iphone16pro', colourKey: 'black' }), undefined);
  // A partial choice never completes itself.
  assert.equal(option.resolveOptionVariant(VARIANTS, { modelKey: 'iphone16', colourKey: null }), undefined);
  assert.equal(option.resolveOptionVariant(VARIANTS, { modelKey: null, colourKey: null }), undefined);
  // Resolution is always exact; a single row is completed by the default
  // selection, never by treating an empty selection as that row.
  const single = [VARIANTS[0]];
  assert.equal(option.resolveOptionVariant(single, { modelKey: null, colourKey: null }), undefined);
  assert.equal(option.resolveOptionVariant(single, option.defaultOptionSelection(single))?.id, 'red');
});

test('changing the model clears a colour that does not belong to it', () => {
  const keep = option.selectModel(VARIANTS, { modelKey: 'iphone16', colourKey: 'red' }, 'iphone16');
  assert.deepEqual(keep, { modelKey: 'iphone16', colourKey: 'red' });
  const shared = option.selectModel(VARIANTS, { modelKey: 'iphone16', colourKey: 'red' }, 'iphone16pro');
  assert.deepEqual(shared, { modelKey: 'iphone16pro', colourKey: 'red' }, 'a colour both models offer is kept');
  assert.deepEqual(option.selectModel(VARIANTS, { modelKey: 'iphone16', colourKey: 'black' }, 'iphone16pro'),
    { modelKey: 'iphone16pro', colourKey: 'red' }, 'a one-colour model completes itself');
  const twoColours = [...VARIANTS,
    variant('pro-blue', PRO, { colourId: 'blue', colourName: 'Blue', colourHex: '#0071E3' }, 21000)];
  assert.deepEqual(option.selectModel(twoColours, { modelKey: 'iphone16', colourKey: 'black' }, 'iphone16pro'),
    { modelKey: 'iphone16pro', colourKey: null }, 'a colour the new model lacks is cleared, not guessed');
  const singleColour = option.selectModel(VARIANTS, { modelKey: null, colourKey: null }, 'iphone16pro');
  assert.deepEqual(singleColour, { modelKey: 'iphone16pro', colourKey: 'red' }, 'a one-colour model has no dead end');
});

test('before a choice the headline is the cheapest row, never a "From" range', () => {
  // Red (₹100) is the cheapest exact row, so that is the amount first shown.
  assert.deepEqual(option.optionPrice(VARIANTS, { modelKey: null, colourKey: null }),
    { unitPaise: 10000, regularPaise: null, onSale: false });
  const black = option.optionPrice(VARIANTS, { modelKey: 'iphone16', colourKey: 'black' });
  assert.deepEqual(black, { unitPaise: 12000, regularPaise: null, onSale: false });
  assert.equal('from' in black, false, 'there is no From state to display');

  // Equal prices show that price as the headline.
  const equal = VARIANTS.map(entry => ({ ...entry, pricePaise: 10000, regularPricePaise: 10000 }));
  assert.deepEqual(option.optionPrice(equal, { modelKey: null, colourKey: null }),
    { unitPaise: 10000, regularPaise: null, onSale: false });

  // The strike-through is the selected row's own regular price while on sale.
  const sale = VARIANTS.map(entry => entry.id === 'black'
    ? { ...entry, pricePaise: 9000, regularPricePaise: 12000, onSale: true } : entry);
  assert.deepEqual(option.optionPrice(sale, { modelKey: 'iphone16', colourKey: 'black' }),
    { unitPaise: 9000, regularPaise: 12000, onSale: true });
  assert.equal(option.optionPrice(sale, { modelKey: 'iphone16', colourKey: 'red' }).onSale, false);

  // A sale on the cheapest row headlines its sale amount with its own
  // strike-through, even before a choice.
  const cheapestOnSale = VARIANTS.map(entry => entry.id === 'red'
    ? { ...entry, pricePaise: 8000, regularPricePaise: 10000, onSale: true } : entry);
  assert.deepEqual(option.optionPrice(cheapestOnSale, { modelKey: null, colourKey: null }),
    { unitPaise: 8000, regularPaise: 10000, onSale: true });

  assert.equal(option.optionPrice([], { modelKey: null, colourKey: null }, 5500).unitPaise, 5500);
});

test('shown price equals the price the exact row is charged', () => {
  for (const entry of VARIANTS) {
    const selection = { modelKey: option.optionModelKey(entry), colourKey: option.optionColourKey(entry) };
    const shown = option.optionPrice(VARIANTS, selection);
    const row = option.resolveOptionVariant(VARIANTS, selection);
    assert.equal(row.id, entry.id);
    assert.equal(shown.unitPaise, row.pricePaise, `${entry.id} charges what it showed`);
  }
});

test('normal mode disables a sold-out row; sale mode never disables or marks unavailable', () => {
  const soldOut = [{ ...VARIANTS[0], inStock: false }, VARIANTS[1]];
  assert.deepEqual(option.optionStock(soldOut[0], false),
    { blocked: true, selectable: false, low: false, label: rules.STOCK_NOT_AVAILABLE });
  assert.deepEqual(option.optionStock(soldOut[0], true),
    { blocked: false, selectable: true, low: false, label: null });
  assert.equal(option.optionStock(undefined, false).blocked, false);
  // The refusal names the exact option only after a purchase attempt.
  assert.match(option.optionStockMessage(soldOut[0]), /Out of stock for this option/);
  assert.equal(option.optionStockMessage(undefined), rules.STOCK_NOT_AVAILABLE);
  // Exact counts are deliberately absent from the storefront payload.
  assert.equal(option.isLowOptionStock(soldOut[0]), false);
});

test('the gallery follows the colour, keeps defaults when it has no photos, and never shows hover', () => {
  const photos = [
    { url: '/default-a.png', alt: 'Default A', colourId: null, role: 'primary', sortOrder: 0 },
    { url: '/default-b.png', alt: 'Default B', colourId: '', role: 'gallery', sortOrder: 1 },
    { url: '/red-side.png', alt: 'Red side', colourId: 'red', role: 'gallery', sortOrder: 5 },
    { url: '/red-main.png', alt: 'Red main', colourId: 'red', role: 'primary', sortOrder: 9 },
    { url: '/red-hover.png', alt: 'Red hover', colourId: 'red', role: 'hover', sortOrder: 0 },
    { url: '/black-main.png', alt: 'Black main', colourId: 'black', role: 'primary', sortOrder: 0 },
  ];
  const red = option.galleryForSelection(photos, ['/fallback.png'], { modelKey: 'iphone16', colourKey: 'red' },
    'iPhone 16', 'Red');
  assert.deepEqual(red.map(photo => photo.url), ['/red-main.png', '/red-side.png']);
  assert.deepEqual(red.map(photo => photo.alt), ['Red main', 'Red side']);

  const blue = option.galleryForSelection(photos, ['/fallback.png'], { modelKey: 'iphone16', colourKey: 'blue' },
    'iPhone 16', 'Blue');
  assert.deepEqual(blue.map(photo => photo.url), ['/default-a.png', '/default-b.png'], 'a colour with no photos keeps the defaults');

  const none = option.galleryForSelection(photos, ['/fallback.png'], { modelKey: null, colourKey: null }, 'iPhone 16');
  assert.deepEqual(none.map(photo => photo.url), ['/default-a.png', '/default-b.png']);

  const fallback = option.galleryForSelection([], ['/fallback.png', '/fallback.png'], { modelKey: null, colourKey: null },
    'iPhone 16', 'Red');
  assert.deepEqual(fallback, [{ url: '/fallback.png', alt: 'iPhone 16 — Red' }]);
  assert.equal(option.galleryForSelection(photos, ['/fallback.png'], { modelKey: null, colourKey: 'red' }, 'iPhone 16')
    .some(photo => photo.url.includes('hover')), false);
});

test('the URL round trip restores the selection and photos; unknown values fall back', () => {
  const selected = { modelKey: 'iphone16', colourKey: 'black' };
  const query = option.optionQuery(selected);
  assert.equal(query, 'model=iphone16&colour=black');
  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, `?${query}`), selected);
  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, query), selected);

  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, '?model=ghost&colour=black'),
    { modelKey: null, colourKey: null }, 'an unknown model falls back and drops its colour');

  // A colour-only link restores the unique model that offers it.
  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, '?colour=black'),
    { modelKey: 'iphone16', colourKey: 'black' });
  // A colour offered by two models cannot pick one.
  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, '?colour=red'),
    { modelKey: null, colourKey: 'red' });

  // A partial link stays partial: it must not silently complete a row.
  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, '?model=iphone16'),
    { modelKey: 'iphone16', colourKey: null });

  // No link uses the default: two models, so nothing is pre-chosen.
  assert.deepEqual(option.optionSelectionFromSearch(VARIANTS, ''), { modelKey: null, colourKey: null });
  assert.deepEqual(option.defaultOptionSelection([VARIANTS[0]]),
    { modelKey: 'iphone16', colourKey: 'red' }, 'a single row is already chosen');
});

function render(props) {
  return renderToStaticMarkup(OptionSelector({ onChange: () => {}, saleLive: false, ...props }));
}

test('the selector announces structure, names every colour and blocks sold-out rows in normal mode', () => {
  const variants = [{ ...VARIANTS[0], inStock: false }, VARIANTS[1]];
  const html = render({ variants, selection: { modelKey: 'iphone16', colourKey: 'black' } });
  assert.equal((html.match(/role="radiogroup"/g) ?? []).length, 2, 'model group then colour group');
  assert.match(html, /<legend[^>]*>Model/);
  assert.match(html, /iPhone 16/);
  // The sold-out colour stays visible, disabled, and says why.
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Red — Stock not available"/);
  assert.match(html, /<span>Red<\/span>/);
  assert.match(html, /Stock not available/);
  // The chosen colour is checked and named as text, never colour alone.
  assert.match(html, /aria-checked="true"[^>]*>.*?Black/s);
  assert.match(html, /<legend[^>]*>Colour<span[^>]*> — Black<\/span>/);
  // A live region announces the exact row, its price and its stock.
  assert.match(html, /aria-live="polite">iPhone 16, Black, ₹120\.00, in stock/);
  // The swatch carries its hex as decoration only.
  assert.match(html, /background-color:#1D1D1F/);
  assert.match(html, /aria-hidden="true"/);
});

test('sale mode never disables or marks a sold-out colour unavailable', () => {
  const variants = [{ ...VARIANTS[0], inStock: false }, VARIANTS[1]];
  const html = render({ variants, selection: { modelKey: 'iphone16', colourKey: 'red' }, saleLive: true });
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /Stock not available/);
  assert.match(html, /aria-checked="true"[^>]*>.*?Red/s);
  assert.match(html, /aria-live="polite">iPhone 16, Red, ₹100\.00, in stock/);
});

test('a model is disabled only when every one of its colours is unavailable', () => {
  const variants = [
    { ...VARIANTS[0], inStock: false },
    { ...VARIANTS[1], inStock: false },
    VARIANTS[2],
  ];
  const html = render({ variants, selection: { modelKey: 'iphone16pro', colourKey: 'red' } });
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="iPhone 16 — Stock not available"/);
  assert.match(html, /aria-checked="true"[^>]*>.*?iPhone 16 Pro/s);
});

test('before a model is chosen the colour step waits and the headline is the cheapest amount', () => {
  const html = render({ variants: VARIANTS, selection: { modelKey: null, colourKey: null } });
  assert.equal((html.match(/role="radiogroup"/g) ?? []).length, 1, 'only the model step');
  assert.match(html, /Choose a model to see its colours and stock\./);
  assert.match(html, /Choose a model, ₹100\.00/, 'the announcement states the cheapest amount, not a range');
});

test('the page reserves gallery space, preloads the next photo and syncs the URL', () => {
  const source = readFileSync(path.join(root, 'src/components/shop/ProductDetailPage.tsx'), 'utf8');
  // The main image keeps the same box while photos differ in size.
  assert.match(source, /aspect-square|aspect-\[1\/1\]/);
  assert.match(source, /new window\.Image\(\)/);
  assert.match(source, /history\.replaceState\(null, '', /);
  assert.match(source, /role="group" aria-label="Product photos"/);
  assert.match(source, /aria-label=\{`Show photo \$\{index \+ 1\}: \$\{photo\.alt\}`\}/);
  assert.match(source, /alt=\{activePhoto\.alt\}/);
});

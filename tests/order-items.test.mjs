import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

import { buildCartLineId } from '../src/lib/cart/cart-id.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// jiti resolves the `@/` alias that catalog.ts and orders.ts rely on; plain
// node --test cannot. moduleCache is off so each import reflects the file.
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const { resolveCartItems, getProductFromCatalog, getProductImage } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'catalog.ts'),
);
const { buildOrderItemLines } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'orders.ts'),
);

const BASE_IDS = [
  'iphone18pro-max-clear-magsafe',
  'iphone17-silicone-black',
  'pa-gadzio-20w-usbc',
  'pa-gadzio-35w-dual',
  'we-gadzio-pulse-usbc',
  'we-gadzio-pulse-35mm',
  'cpc-gadzio-silicone-organizer',
  'cpc-gadzio-charger-shell-20w',
  'ac-gadzio-silicone-pro3',
  'ac-gadzio-silicone-pro2',
  'mc-gadzio-silicone-17promax',
  'mc-gadzio-clear-17pro',
];

// The line-id shapes each add-to-bag entry point actually produces.
// - shop detail page: color + model (selected size)
// - accessory detail page: color + model (compatibility[0])
// - cases-protection product card: color + model
// - accessory product card: color + model
// - collection product card: color only
// - collection featured tile: no variant
// - search-suggestion quick adds (bag flyout / cart page): no variant
// - checkout ?productId= deep link: plain base id
const ENTRY_POINT_SHAPES = [
  { label: 'shop detail page (color + model)', color: 'Midnight', model: 'iPhone 17' },
  { label: 'accessory detail page (color + compatibility)', color: 'Midnight', model: 'iPhone 17' },
  { label: 'cases product card (color + model)', color: 'Black', model: 'iPhone 17 Pro Max' },
  { label: 'accessory product card (color + model)', color: 'White', model: 'iPhone 17' },
  { label: 'collection product card (color only)', color: 'Blue' },
  { label: 'collection featured tile (no variant)' },
  { label: 'search suggestion quick add (no variant)' },
  { label: 'checkout deep link (plain id)', plain: true },
];

function lineIdFor(baseId, shape) {
  if (shape.plain) return baseId;
  return buildCartLineId({ productId: baseId, color: shape.color, model: shape.model });
}

test('resolveCartItems + buildOrderItemLines accept plain ids for all 12 products', () => {
  const input = BASE_IDS.map((id) => ({ id, quantity: 1 }));
  const cart = resolveCartItems(input);
  assert.equal(cart.items.length, BASE_IDS.length);
  assert.deepEqual(cart.items.map((i) => i.id), BASE_IDS);

  const lines = buildOrderItemLines(cart.items, BASE_IDS);
  assert.equal(lines.length, BASE_IDS.length);
  lines.forEach((line, index) => {
    assert.equal(line.lineNumber, index + 1);
    assert.equal(line.productId, BASE_IDS[index]);
    assert.equal(line.currency, 'INR');
    assert.ok(line.unitPricePaise > 0);
    assert.equal(line.lineTotalPaise, line.unitPricePaise * line.quantity);
  });
  // The persisted paise total equals the resolved rupee total — no drift.
  const paiseTotal = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  assert.equal(paiseTotal, Math.round(cart.totalAmount * 100));
});

test('resolveCartItems + buildOrderItemLines reduce composite ids from every entry point to base ids', () => {
  for (const shape of ENTRY_POINT_SHAPES) {
    for (const baseId of BASE_IDS) {
      const lineId = lineIdFor(baseId, shape);
      const cart = resolveCartItems([{ id: lineId, quantity: 2 }]);
      assert.equal(cart.items.length, 1, `${shape.label}: resolved one line for ${lineId}`);
      assert.equal(cart.items[0].id, baseId, `${shape.label}: snapshot id is the base id`);

      const lines = buildOrderItemLines(cart.items, BASE_IDS);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].productId, baseId, `${shape.label}: order_items id is the base id`);
      assert.equal(lines[0].quantity, 2);
      assert.equal(lines[0].lineTotalPaise, lines[0].unitPricePaise * 2);
      assert.equal(Math.round(cart.totalAmount * 100), lines[0].lineTotalPaise);
    }
  }
});

test('every catalog lookup after cart resolution works with composite ids', () => {
  for (const baseId of BASE_IDS) {
    const composite = buildCartLineId({ productId: baseId, color: 'Midnight', model: 'iPhone 17' });
    assert.ok(getProductFromCatalog(composite), `getProductFromCatalog(${composite})`);
    assert.ok(getProductImage(composite), `getProductImage(${composite})`);
    assert.ok(getProductFromCatalog(baseId), `getProductFromCatalog(${baseId})`);
  }
});

test('the failing id is named when a product cannot be resolved', () => {
  assert.throws(
    () => resolveCartItems([{ id: 'ghost-product-xyz::Midnight::iPhone 17', quantity: 1 }]),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /ghost-product-xyz::Midnight::iPhone 17/);
      assert.match(error.message, /not found in catalog/);
      return true;
    },
  );
});

test('a prefix or underscore variant of a real id is rejected and named', () => {
  for (const id of [
    'pa-gadzio-20w-usbc-extra',
    'pa-gadzio-20w-usbc_',
    'pa-gadzio-20w-usbc-black',
  ]) {
    assert.throws(
      () => resolveCartItems([{ id, quantity: 1 }]),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(id), `message names ${id}`);
        assert.match(error.message, /not found in catalog/);
        return true;
      },
    );
  }
});

test('case changes still resolve to the canonical id', () => {
  const cart = resolveCartItems([{ id: 'PA-GADZIO-20W-USBC::Black::iPhone 17', quantity: 2 }]);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].id, 'pa-gadzio-20w-usbc');
  assert.equal(cart.items[0].quantity, 2);
});

test('buildOrderItemLines never trusts caller prices', () => {
  const cart = resolveCartItems([{ id: 'pa-gadzio-20w-usbc', quantity: 3 }]);
  const [resolved] = cart.items;
  const [line] = buildOrderItemLines([resolved], BASE_IDS);
  const catalogPrice = getProductFromCatalog('pa-gadzio-20w-usbc').price;
  assert.equal(resolved.unitPrice, catalogPrice);
  assert.equal(line.unitPricePaise, Math.round(catalogPrice * 100));
});

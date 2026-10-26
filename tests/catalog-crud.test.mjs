import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  checkPricePair,
  createsCategoryCycle,
  isManualStockReason,
  stockAvailable,
  validateCategoryInput,
  validateConditionInput,
  validateNewProductInput,
  validatePricePatch,
  validateStockAdjustment,
  validateStockSettings,
  validateVariantInput,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'catalog-crud-rules.ts'));

/* ------------------------------------------------------------ categories */

test('a category needs a name and derives its slug', () => {
  const named = validateCategoryInput({ name: 'Charging Cables' });
  assert.equal(named.ok, true);
  assert.equal(named.value.slug, 'charging-cables');

  assert.equal(validateCategoryInput({ name: '' }).ok, false);
  assert.equal(validateCategoryInput({ name: 'x'.repeat(81) }).ok, false);
});

test('a category slug must be lowercase and hyphenated', () => {
  assert.equal(validateCategoryInput({ name: 'Cables', slug: 'Charging Cables' }).ok, false);
  assert.equal(validateCategoryInput({ name: 'Cables', slug: 'cables' }).ok, true);
});

test('a category cannot be its own parent', () => {
  const result = validateCategoryInput({ id: 'cables', name: 'Cables', parentId: 'cables' });
  assert.equal(result.ok, false);
});

test('re-parenting detects loops at any depth', () => {
  const tree = new Map([
    ['root', null],
    ['mid', 'root'],
    ['leaf', 'mid'],
  ]);
  assert.equal(createsCategoryCycle(tree, 'root', 'leaf'), true);
  assert.equal(createsCategoryCycle(tree, 'mid', 'leaf'), true);
  assert.equal(createsCategoryCycle(tree, 'leaf', 'root'), false);
  assert.equal(createsCategoryCycle(tree, 'leaf', null), false);
});

test('sort order is bounded', () => {
  assert.equal(validateCategoryInput({ name: 'Cables', sortOrder: -1 }).ok, false);
  assert.equal(validateCategoryInput({ name: 'Cables', sortOrder: 10000 }).ok, false);
  assert.equal(validateCategoryInput({ name: 'Cables', sortOrder: 10 }).ok, true);
});

/* ------------------------------------------------------------ conditions */

test('a condition needs a label within bounds', () => {
  const ok = validateConditionInput({ label: 'Open box' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.label, 'Open box');
  assert.equal(validateConditionInput({ label: '   ' }).ok, false);
});

/* -------------------------------------------------------------- products */

function product(overrides = {}) {
  return {
    name: 'GaN Charger 65W',
    categoryId: 'power',
    pricePaise: 349900,
    ...overrides,
  };
}

test('a new product needs a name, category and price', () => {
  assert.equal(validateNewProductInput(product()).ok, true);
  assert.equal(validateNewProductInput(product({ name: '' })).ok, false);
  assert.equal(validateNewProductInput(product({ categoryId: '' })).ok, false);
  assert.equal(validateNewProductInput(product({ pricePaise: 0 })).ok, false);
  assert.equal(validateNewProductInput(product({ pricePaise: 100000001 })).ok, false);
});

test('the product id is the slug', () => {
  const result = validateNewProductInput(product({ name: 'USB-C Hub', slug: 'usb-c-hub' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'usb-c-hub');
});

test('a compare-at price cannot sit below the selling price', () => {
  assert.equal(
    validateNewProductInput(product({ pricePaise: 1000, compareAtPaise: 900 })).ok,
    false,
  );
  assert.equal(
    validateNewProductInput(product({ pricePaise: 1000, compareAtPaise: 1200 })).ok,
    true,
  );
  assert.equal(checkPricePair(1000, 1000), null);
  assert.notEqual(checkPricePair(1000, 999), null);
});

test('opening stock is a whole number and tracking is opt-in', () => {
  const result = validateNewProductInput(
    product({ trackInventory: true, initialOnHand: 12 }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.initialOnHand, 12);
  assert.equal(result.value.trackInventory, true);
  assert.equal(validateNewProductInput(product({ initialOnHand: -1 })).ok, false);
  assert.equal(validateNewProductInput(product({ initialOnHand: 1.5 })).ok, false);
});

/* ---------------------------------------------------------------- prices */

test('a price patch needs at least one field', () => {
  assert.equal(validatePricePatch({}).ok, false);
  assert.equal(validatePricePatch({ pricePaise: 1999 }).ok, true);
  assert.equal(validatePricePatch({ compareAtPaise: null }).ok, true);
  assert.equal(validatePricePatch({ pricePaise: 0 }).ok, false);
});

test('a compare-at price can be cleared with null or an empty string', () => {
  const fromNull = validatePricePatch({ compareAtPaise: null });
  assert.equal(fromNull.ok, true);
  assert.equal(fromNull.value.compareAtPaise, null);
  const fromEmpty = validatePricePatch({ compareAtPaise: '' });
  assert.equal(fromEmpty.ok, true);
  assert.equal(fromEmpty.value.compareAtPaise, null);
});

/* -------------------------------------------------------------- variants */

test('a variant needs an option value and uppercases the SKU', () => {
  const result = validateVariantInput({ optionValue: 'Midnight', sku: 'gad-20w-blk' });
  assert.equal(result.ok, true);
  assert.equal(result.value.sku, 'GAD-20W-BLK');
  assert.equal(result.value.optionName, 'Colour');
  assert.equal(validateVariantInput({ optionValue: '' }).ok, false);
});

test('a variant SKU only accepts letters, numbers and dashes', () => {
  assert.equal(validateVariantInput({ optionValue: 'Black', sku: 'GAD 20W' }).ok, false);
  assert.equal(validateVariantInput({ optionValue: 'Black', sku: 'GAD_20W' }).ok, false);
});

test('a variant colour must be a hex value', () => {
  assert.equal(validateVariantInput({ optionValue: 'Black', optionHex: '#1f2937' }).ok, true);
  assert.equal(validateVariantInput({ optionValue: 'Black', optionHex: 'black' }).ok, false);
  const lower = validateVariantInput({ optionValue: 'Black', optionHex: '#1F2937' });
  assert.equal(lower.value.optionHex, '#1f2937');
});

test('a variant price override must be a positive whole number of paise', () => {
  assert.equal(validateVariantInput({ optionValue: 'Black', priceOverridePaise: 0 }).ok, false);
  assert.equal(validateVariantInput({ optionValue: 'Black', priceOverridePaise: 249900 }).ok, true);
});

/* ----------------------------------------------------------------- stock */

test('only receipt, adjustment and damage are manual reasons', () => {
  assert.equal(isManualStockReason('receipt'), true);
  assert.equal(isManualStockReason('damage'), true);
  assert.equal(isManualStockReason('sale'), false);
  assert.equal(isManualStockReason('seed'), false);
});

test('an adjustment cannot be zero and needs a known reason', () => {
  assert.equal(validateStockAdjustment({ delta: 0, reason: 'receipt' }).ok, false);
  assert.equal(validateStockAdjustment({ delta: 5, reason: 'sale' }).ok, false);
  assert.equal(validateStockAdjustment({ delta: -3, reason: 'damage' }).ok, true);
  assert.equal(validateStockAdjustment({ delta: 100001, reason: 'receipt' }).ok, false);
});

test('stock settings default to untracked', () => {
  const result = validateStockSettings({ lowStockThreshold: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.value.trackInventory, false);
  assert.equal(validateStockSettings({ lowStockThreshold: -1 }).ok, false);
});

test('available stock never goes negative', () => {
  assert.equal(stockAvailable(5, 2), 3);
  assert.equal(stockAvailable(2, 5), 0);
  assert.equal(stockAvailable(0, 0), 0);
});

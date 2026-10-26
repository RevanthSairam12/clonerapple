import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCartLineId, normalizeCartLineId } from '../src/lib/cart/cart-id.ts';

const productIds = [
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

const PRODUCT_PAGE_SIZES = [
  'iPhone 18 Pro Max',
  'iPhone 18 Pro',
  'iPhone 18',
  'iPhone 17 Pro Max',
  'iPhone 17 Pro',
  'iPhone 17',
  'iPhone 16 Pro Max',
  'iPhone 16 Pro',
];

// The line-id shapes each add-to-bag entry point actually produces.
const ENTRY_POINT_SHAPES = [
  { label: 'collection quick-add (colour only)', color: 'Blue' },
  { label: 'collection featured tile (no variant)' },
  { label: 'cases product card (colour + model)', color: 'Black', model: 'iPhone 17 Pro Max' },
  { label: 'accessory product card (colour + model)', color: 'White', model: 'iPhone 17' },
  { label: 'shop detail page (colour + size)', color: 'Midnight', model: 'iPhone 17' },
  {
    label: 'accessory detail page (colour + compatibility)',
    color: 'Midnight',
    model: 'iPhone 17',
  },
  { label: 'search quick-add (plain id)', plain: true },
  { label: 'flyout suggestion quick-add (plain id)', plain: true },
  { label: 'checkout deep link (plain id)', plain: true },
];

test('normalizes the real base ids used by category, search, and flyout adds', () => {
  for (const id of productIds) {
    assert.equal(normalizeCartLineId(id, productIds).baseId, id);
  }
});

test('every real entry point shape resolves to its exact base id', () => {
  for (const shape of ENTRY_POINT_SHAPES) {
    for (const baseId of productIds) {
      const lineId = shape.plain
        ? baseId
        : buildCartLineId({ productId: baseId, color: shape.color, model: shape.model });
      const result = normalizeCartLineId(lineId, productIds);

      assert.equal(result.baseId, baseId, `${shape.label}: ${lineId}`);
      assert.equal(result.color, shape.plain ? undefined : shape.color || undefined);
      assert.equal(result.model, shape.plain ? undefined : shape.model);
    }
  }
});

test('product detail sizes keep the model as a separate display field', () => {
  for (const baseId of productIds) {
    for (const size of PRODUCT_PAGE_SIZES) {
      const lineId = buildCartLineId({ productId: baseId, color: 'Midnight', model: size });
      const result = normalizeCartLineId(lineId, productIds);

      assert.equal(result.baseId, baseId);
      assert.equal(result.color, 'Midnight');
      assert.equal(result.model, size);
      assert.equal(result.variantLabel, `Midnight • ${size}`);
    }
  }
});

test('colour and model stay separate; they never change the base id', () => {
  assert.deepEqual(normalizeCartLineId('iphone17-silicone-black::Midnight::iPhone 17', productIds), {
    rawId: 'iphone17-silicone-black::Midnight::iPhone 17',
    baseId: 'iphone17-silicone-black',
    color: 'Midnight',
    model: 'iPhone 17',
    variantLabel: 'Midnight • iPhone 17',
  });
  assert.equal(
    buildCartLineId({ productId: 'IPHONE17-SILICONE-BLACK', color: 'Midnight', model: 'iPhone 17' }),
    'iphone17-silicone-black::Midnight::iPhone 17',
  );
});

test('case changes resolve to the canonical catalogue id', () => {
  assert.equal(normalizeCartLineId('PA-GADZIO-20W-USBC', productIds).baseId, 'pa-gadzio-20w-usbc');
  assert.equal(
    normalizeCartLineId('Iphone17-Silicone-Black::Midnight::iPhone 17', productIds).baseId,
    'iphone17-silicone-black',
  );
  assert.equal(buildCartLineId({ productId: 'PA-GADZIO-20W-USBC' }), 'pa-gadzio-20w-usbc::::');
});

test('leading and trailing whitespace is trimmed', () => {
  const result = normalizeCartLineId(
    '  iphone17-silicone-black  ::  Midnight  ::  iPhone 17  ',
    productIds,
  );
  assert.equal(result.baseId, 'iphone17-silicone-black');
  assert.equal(result.color, 'Midnight');
  assert.equal(result.model, 'iPhone 17');
});

test('no lenient prefix matching: id-extra and id_ are not the base id', () => {
  for (const value of [
    'pa-gadzio-20w-usbc-extra',
    'pa-gadzio-20w-usbc_',
    'pa-gadzio-20w-usbc-black',
    'iphone17-silicone-black-extra',
    'iphone17-silicone-black_',
  ]) {
    assert.equal(normalizeCartLineId(value, productIds).baseId, null, value);
  }

  const composite = normalizeCartLineId('pa-gadzio-20w-usbc-extra::Black::iPhone 17', productIds);
  assert.equal(composite.baseId, null);
  assert.equal(composite.color, 'Black');
  assert.equal(composite.model, 'iPhone 17');
});

test('an unknown id is never invented as a catalogue id', () => {
  for (const value of ['ghost-product-xyz', 'savings-1', 'iphone17-clear-magsafe']) {
    assert.equal(normalizeCartLineId(value, productIds).baseId, null, value);
  }
});

test('rejects empty, whitespace and non-string ids without inventing a catalogue id', () => {
  for (const value of [null, undefined, '', '   ', '::Black::iPhone 17', 42, {}, []]) {
    assert.equal(normalizeCartLineId(value, productIds).baseId, null);
  }
});

test('without a catalogue the base id is still parsed and lowercased for cart building', () => {
  assert.equal(normalizeCartLineId('PA-GADZIO-20W-USBC').baseId, 'pa-gadzio-20w-usbc');
  assert.equal(
    normalizeCartLineId('iphone17-silicone-black::Midnight::iPhone 17').baseId,
    'iphone17-silicone-black',
  );
});

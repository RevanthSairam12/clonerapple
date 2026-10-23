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

test('normalizes the real base ids used by category, search, and flyout adds', () => {
  for (const id of productIds) {
    assert.equal(normalizeCartLineId(id, productIds).baseId, id);
  }
});

test('normalizes product detail variant line ids without changing the base id', () => {
  const result = normalizeCartLineId(
    'iphone17-silicone-black::Midnight::iPhone 17',
    productIds,
  );
  assert.deepEqual(result, {
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

test('recognizes old separator suffixes using the longest known base id', () => {
  const result = normalizeCartLineId('pa-gadzio-20w-usbc-black', productIds);
  assert.equal(result.baseId, 'pa-gadzio-20w-usbc');
  assert.equal(result.variantLabel, 'black');
});

test('rejects malformed ids without inventing a catalog id', () => {
  for (const value of [null, undefined, '', '   ', '::Black::iPhone 17', 42, {}, []]) {
    assert.equal(normalizeCartLineId(value, productIds).baseId, null);
  }
});

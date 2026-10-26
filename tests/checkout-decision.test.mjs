import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decideCheckoutView,
  parseCheckoutQuantity,
} from '../src/lib/checkout/checkout-decision.ts';

const base = {
  isHydrated: true,
  bagItemCount: 0,
  productId: undefined,
  initialItemCount: 0,
  productUnavailable: false,
};

test('waits for hydration before deciding anything', () => {
  for (const input of [
    { ...base, isHydrated: false },
    { ...base, isHydrated: false, bagItemCount: 2 },
    { ...base, isHydrated: false, productId: 'old-id', productUnavailable: true },
    { ...base, isHydrated: false, productId: 'pa-gadzio-20w-usbc', initialItemCount: 1 },
  ]) {
    assert.deepEqual(decideCheckoutView(input), {
      view: 'loading',
      clearProductQueryFromUrl: false,
    });
  }
});

test('a non-empty bag always wins, with or without a productId', () => {
  assert.deepEqual(decideCheckoutView({ ...base, bagItemCount: 1 }), {
    view: 'bag',
    clearProductQueryFromUrl: false,
  });

  for (const productUnavailable of [true, false]) {
    assert.deepEqual(
      decideCheckoutView({
        ...base,
        bagItemCount: 2,
        productId: 'iphone17-clear-magsafe',
        productUnavailable,
      }),
      { view: 'bag', clearProductQueryFromUrl: true },
    );
  }
});

test('the unavailable panel shows only for a productId with an empty bag', () => {
  assert.deepEqual(
    decideCheckoutView({
      ...base,
      productId: 'iphone17-clear-magsafe',
      productUnavailable: true,
    }),
    { view: 'unavailable', clearProductQueryFromUrl: false },
  );

  // A productId that resolves still checks out that product when the bag is empty.
  assert.deepEqual(
    decideCheckoutView({
      ...base,
      productId: 'pa-gadzio-20w-usbc',
      initialItemCount: 1,
    }),
    { view: 'product', clearProductQueryFromUrl: false },
  );

  // No productId at all is an empty bag, not an unavailable product.
  assert.deepEqual(decideCheckoutView(base), {
    view: 'empty',
    clearProductQueryFromUrl: false,
  });

  // A productUnavailable flag without a productId is not enough to show the panel.
  assert.deepEqual(decideCheckoutView({ ...base, productUnavailable: true }), {
    view: 'empty',
    clearProductQueryFromUrl: false,
  });
});

test('a stale productId is discarded once the bag hydrates with items', () => {
  // Not hydrated: still loading, even though the URL names a dead product.
  assert.equal(
    decideCheckoutView({
      ...base,
      isHydrated: false,
      bagItemCount: 1,
      productId: 'old-id',
      productUnavailable: true,
    }).view,
    'loading',
  );

  // Hydrated with an item: the bag wins and the URL is cleared.
  assert.deepEqual(
    decideCheckoutView({
      ...base,
      bagItemCount: 1,
      productId: 'old-id',
      productUnavailable: true,
    }),
    { view: 'bag', clearProductQueryFromUrl: true },
  );
});

test('?qty= parses as an integer, clamps to 1..50 and treats NaN or missing as 1', () => {
  const cases = [
    [undefined, 1],
    [null, 1],
    ['', 1],
    ['   ', 1],
    ['abc', 1],
    ['NaN', 1],
    ['0', 1],
    ['-4', 1],
    ['1', 1],
    ['50', 50],
    ['51', 50],
    ['100000', 50],
    ['2.9', 2],
    [' 7 ', 7],
    ['3abc', 3],
  ];

  for (const [input, expected] of cases) {
    assert.equal(parseCheckoutQuantity(input), expected, String(input));
  }
});

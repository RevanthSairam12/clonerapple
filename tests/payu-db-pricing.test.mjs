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

const { priceCartLines } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'db-pricing.ts'),
);

const ROWS = [
  {
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    subtitle: 'Titanium.',
    price_paise: 11990000,
    image_url: '/images/iphone.png',
  },
  {
    id: 'usb-c-cable',
    name: 'USB-C Cable',
    subtitle: '',
    price_paise: 190000,
    image_url: null,
  },
];

test('the database price, not a cart price, determines the PayU amount', () => {
  const cart = [{ id: 'iphone-16-pro', quantity: 2 }];

  const before = priceCartLines(cart, ROWS);
  assert.equal(before.totalPaise, 23980000);
  assert.equal(before.totalAmount, 239800);

  // Simulate an audited price change in products.price_paise. The same cart
  // must now produce a different amount with no client input at all.
  const after = priceCartLines(cart, [
    { ...ROWS[0], price_paise: 10990000 },
    ROWS[1],
  ]);
  assert.equal(after.totalPaise, 21980000);
  assert.equal(after.totalAmount, 219800);
  assert.notEqual(after.totalAmount, before.totalAmount);
});

test('composite cart line ids resolve to the base catalogue row', () => {
  const priced = priceCartLines(
    [{ id: 'iphone-16-pro::Natural Titanium::256 GB', quantity: 1 }],
    ROWS,
  );
  assert.equal(priced.items[0].id, 'iphone-16-pro');
  assert.equal(priced.items[0].unitPrice, 119900);
  assert.equal(priced.items[0].quantity, 1);
});

test('unknown or inactive ids fail closed instead of using a display price', () => {
  assert.throws(
    () => priceCartLines([{ id: 'retired-product', quantity: 1 }], ROWS),
    /not found in catalog/,
  );
});

test('quantities outside 1-50 are rejected', () => {
  for (const quantity of [0, -1, 1.5, 51, Number.NaN]) {
    assert.throws(
      () => priceCartLines([{ id: 'usb-c-cable', quantity }], ROWS),
      /Invalid quantity/,
    );
  }
});

test('lines are summed in integer paise, without per-line rounding drift', () => {
  const priced = priceCartLines(
    [
      { id: 'usb-c-cable', quantity: 3 },
      { id: 'iphone-16-pro', quantity: 1 },
    ],
    ROWS,
  );
  assert.equal(priced.totalPaise, 3 * 190000 + 11990000);
  assert.equal(priced.totalAmount, 125600);
  assert.equal(priced.items.length, 2);
  assert.ok(priced.productSummary.length <= 90);
});

test('an empty cart is rejected', () => {
  assert.throws(() => priceCartLines([], ROWS), /Cart is empty/);
});

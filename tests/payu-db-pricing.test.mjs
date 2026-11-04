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

const { priceCartLines, SelectionUnavailableError, MAX_CHECKOUT_VARIANT_ID_LENGTH } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'db-pricing.ts'),
);

test('variant pricing requires exact identity and preserves immutable selection', () => {
  const rows = [{id:'case',name:'Case',variant_id:'pro',variant_sku:'SKU-PRO',variant_label:'iPhone Pro',price_paise:25000},
    {id:'case',name:'Case',variant_id:'max',variant_sku:'SKU-MAX',variant_label:'iPhone Max',price_paise:35000}];
  const cart=priceCartLines([{id:'case',variantId:'pro',quantity:1},{id:'case',variantId:'max',quantity:2}],rows);
  assert.equal(cart.totalPaise,95000);
  assert.equal(cart.items[0].variantId,'pro');
  assert.equal(cart.items[1].variantSku,'SKU-MAX');
  assert.throws(()=>priceCartLines([{id:'case',quantity:1}],rows),/no longer available/);
  assert.throws(()=>priceCartLines([{id:'case',variantId:'wrong',quantity:1}],rows),/no longer available/);
});

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
    SelectionUnavailableError,
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

test('price changes identify the exact option and missing expectations are not zero', () => {
  const rows = [
    { id: 'case', variant_id: 'pro', name: 'Case', price_paise: 25000 },
    { id: 'case', variant_id: 'max', name: 'Case', price_paise: 35000 },
  ];
  const result = priceCartLines([
    { id: 'case', variantId: 'pro', quantity: 1, expectedUnitPaise: 25000 },
    { id: 'case', variantId: 'max', quantity: 1, expectedUnitPaise: 30000 },
  ], rows);
  assert.deepEqual(result.priceChanges, [{ id: 'case', variantId: 'max', name: 'Case -', expectedPaise: 30000, actualPaise: 35000 }]);
  assert.equal(result.totalPaise, 60000);
  assert.deepEqual(priceCartLines([{ id: 'case', variantId: 'pro', quantity: 1, expectedUnitPaise: null }], rows).priceChanges, []);
});

test('an empty cart is rejected', () => {
  assert.throws(() => priceCartLines([], ROWS), /Cart is empty/);
});

test('malformed variant values never coerce to a parent selection', () => {
  for (const variantId of [false, 0, 1, {}, [], '', '   ', 'v'.repeat(MAX_CHECKOUT_VARIANT_ID_LENGTH + 1)]) {
    assert.throws(() => priceCartLines([{ id: 'usb-c-cable', variantId, quantity: 1 }], ROWS), /Invalid variant id/);
  }
  for (const variantId of [null, undefined]) {
    assert.equal(priceCartLines([{ id: 'usb-c-cable', variantId, quantity: 1 }], ROWS).totalPaise, 190000);
  }
});

test('legacy text variant IDs are accepted exactly, without normalization or substitution', () => {
  const legacy = 'long-legacy-product-id-c-0-natural-titanium'.repeat(2);
  const row = { id: 'case', inventory_mode: 'variant', variant_id: legacy, name: 'Case', price_paise: 10000 };
  assert.equal(priceCartLines([{ id: 'case', variantId: legacy, quantity: 1 }], [row]).items[0].variantId, legacy);
  for (const variantId of [undefined, null, ` ${legacy}`, legacy.toUpperCase(), 'foreign']) {
    assert.throws(() => priceCartLines([{ id: 'case', variantId, quantity: 1 }], [row]), SelectionUnavailableError);
  }
});

test('a foreign product variant cannot use another product or parent row', () => {
  const rows = [ROWS[1], { id: 'other', variant_id: 'foreign', name: 'Other', price_paise: 1 }];
  assert.throws(() => priceCartLines([{ id: 'usb-c-cable', variantId: 'foreign', quantity: 1 }], rows), (error) => {
    assert.ok(error instanceof SelectionUnavailableError);
    assert.deepEqual(error.selection, { id: 'usb-c-cable', variantId: 'foreign' });
    return true;
  });
});

test('bounded selection conflict and cart size never expose a catalogue or invalid price', () => {
  const error = new SelectionUnavailableError('p'.repeat(1000), 'v'.repeat(1000));
  assert.equal(error.selection.id.length, 256);
  assert.equal(error.selection.variantId.length, MAX_CHECKOUT_VARIANT_ID_LENGTH);
  assert.throws(() => priceCartLines(Array.from({ length: 51 }, () => ({ id: 'usb-c-cable', quantity: 1 })), ROWS), /too many/);
  assert.equal(priceCartLines(Array.from({ length: 50 }, () => ({ id: 'usb-c-cable', quantity: 1 })), ROWS).items.length, 50);
  assert.throws(() => priceCartLines([{ id: 'broken', quantity: 1 }], [{ id: 'broken', name: 'Broken', price_paise: NaN }]), error => !(error instanceof SelectionUnavailableError));
});

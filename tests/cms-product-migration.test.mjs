import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  cmsImageRowId,
  isCmsProductCollectionKey,
  isSafeImageUrl,
  parseCmsProductItems,
  parseRupeePrice,
  planCmsItemMigration,
  resolveCmsItemProduct,
} = await jiti.import(
  path.join(root, 'src', 'lib', 'admin', 'cms-product-migration.ts'),
);

function product(overrides = {}) {
  return {
    id: 'iphone17-case',
    price_paise: 129900,
    name: 'iPhone 17 Case',
    subtitle: '',
    description: '',
    badge: null,
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    path: 'products[0]',
    id: '',
    sku: '',
    name: '',
    subtitle: '',
    description: '',
    badge: '',
    image: '',
    pricePaise: null,
    priceLabel: '',
    ...overrides,
  };
}

/* --------------------------------------------------------------- key scope */

test('only cases.* blocks can carry products', () => {
  assert.equal(isCmsProductCollectionKey('cases.category_links'), true);
  assert.equal(isCmsProductCollectionKey('cases.protection'), true);
  for (const key of ['apple.hero_tiles', 'oppo.products', 'edu.shelf_savings', 'cases']) {
    assert.equal(isCmsProductCollectionKey(key), false, key);
  }
  assert.deepEqual(parseCmsProductItems('apple.hero_tiles', { items: [{ id: 'p' }] }), []);
});

/* ------------------------------------------------------------------ prices */

test('rupee prices become paise', () => {
  assert.equal(parseRupeePrice(1299), 129900);
  assert.equal(parseRupeePrice('₹1,29,900.00'), 12990000);
  assert.equal(parseRupeePrice(' Rs. 499 '), 49900);
  assert.equal(parseRupeePrice('0'), 0);
});

test('an unreadable price is never guessed', () => {
  for (const value of ['', '   ', 'from ₹499', 'abc', -1, NaN, Infinity, null, undefined]) {
    assert.equal(parseRupeePrice(value), null, String(value));
  }
});

/* ---------------------------------------------------------------- parsing */

test('product items are read from products/items with their paths', () => {
  const items = parseCmsProductItems('cases.protection', {
    heading: 'Protection',
    products: [
      { id: 'p1', name: 'One', price: '₹499' },
      {},
    ],
    items: [
      { sku: 'SKU-2', title: 'Two', priceDisplay: '₹1,299.00', badge: 'New' },
    ],
  });

  assert.equal(items.length, 2);
  const [first, second] = items;
  assert.equal(first.path, 'products[0]');
  assert.equal(first.id, 'p1');
  assert.equal(first.pricePaise, 49900);
  assert.equal(first.priceLabel, '₹499');
  assert.equal(second.path, 'items[0]');
  assert.equal(second.sku, 'SKU-2');
  assert.equal(second.name, 'Two');
  assert.equal(second.badge, 'New');
  assert.equal(second.pricePaise, 129900);
});

test('values already stored as paise are not multiplied', () => {
  const [entry] = parseCmsProductItems('cases.protection', {
    products: [{ id: 'p1', pricePaise: 129900 }],
  });
  assert.equal(entry.pricePaise, 129900);
});

/* --------------------------------------------------------------- matching */

const PRODUCTS = [
  product(),
  product({ id: 'iphone-17-pro-case', name: 'Pro Case' }),
];
const VARIANTS = [
  { sku: 'MG-CLEAR-17', product_id: 'iphone17-case' },
  { sku: null, product_id: 'iphone-17-pro-case' },
];

test('items match a product by id, case-insensitively as a fallback', () => {
  assert.equal(
    resolveCmsItemProduct(item({ id: 'iphone-17-pro-case' }), PRODUCTS, VARIANTS),
    'iphone-17-pro-case',
  );
  assert.equal(
    resolveCmsItemProduct(item({ id: 'IPHONE17-CASE' }), PRODUCTS, VARIANTS),
    'iphone17-case',
  );
});

test('items fall back to a variant SKU', () => {
  assert.equal(
    resolveCmsItemProduct(item({ sku: 'MG-CLEAR-17' }), PRODUCTS, VARIANTS),
    'iphone17-case',
  );
});

test('an item is never matched by name alone', () => {
  assert.equal(
    resolveCmsItemProduct(item({ name: 'iPhone 17 Case' }), PRODUCTS, VARIANTS),
    null,
  );
  assert.equal(resolveCmsItemProduct(item({ id: 'missing' }), PRODUCTS, VARIANTS), null);
  assert.equal(resolveCmsItemProduct(item({ sku: 'unknown' }), PRODUCTS, VARIANTS), null);
});

/* -------------------------------------------------------------- DB wins */

test('empty database fields are filled from the CMS', () => {
  const plan = planCmsItemMigration(
    item({ subtitle: 'Clear case', description: 'Slim shell', badge: 'New' }),
    product(),
    [],
  );
  assert.deepEqual(plan.fills, {
    subtitle: 'Clear case',
    description: 'Slim shell',
    badge: 'New',
  });
  assert.deepEqual(plan.kept, []);
});

test('a non-empty database value is kept even when the CMS disagrees', () => {
  const plan = planCmsItemMigration(
    item({ subtitle: 'CMS subtitle', description: 'CMS body', badge: 'Sale' }),
    product({ subtitle: 'Database subtitle', description: 'Database body', badge: 'New' }),
    ['/images/current.jpg'],
  );
  assert.deepEqual(plan.fills, {});
  assert.deepEqual(plan.kept.sort(), ['badge', 'description', 'subtitle']);
});

test('price is reported but never written', () => {
  const plan = planCmsItemMigration(
    item({ pricePaise: 99900, priceLabel: '₹999' }),
    product({ price_paise: 129900 }),
    [],
  );
  assert.equal('price' in plan.fills, false);
  assert.equal('pricePaise' in plan.fills, false);
  assert.deepEqual(plan.kept, ['price']);
  assert.match(plan.notes.join('\n'), /price differs/i);
  assert.match(plan.notes.join('\n'), /database kept/i);
});

test('name drift is noted, not renamed', () => {
  const plan = planCmsItemMigration(item({ name: 'Old name' }), product(), []);
  assert.equal('name' in plan.fills, false);
  assert.match(plan.notes.join('\n'), /name differs/i);
});

/* ---------------------------------------------------------------- images */

test('an image is added only when the product has no live image', () => {
  const plan = planCmsItemMigration(
    item({ image: '/images/cases/iphone17.jpg' }),
    product(),
    [],
  );
  assert.equal(plan.addImage, '/images/cases/iphone17.jpg');
  assert.equal(plan.imageRowId, 'cms_iphone17-case');

  const withImage = planCmsItemMigration(
    item({ image: '/images/cases/iphone17.jpg' }),
    product(),
    ['/images/live.jpg'],
  );
  assert.equal(withImage.addImage, null);
  assert.equal(withImage.imageRowId, null);
  assert.deepEqual(withImage.kept, ['image']);
});

test('unsafe image URLs are refused', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,AAAA',
    '//evil.example/x.jpg',
    'http://insecure.example/x.jpg',
    '',
  ]) {
    assert.equal(isSafeImageUrl(url), false, url);
  }
  assert.equal(isSafeImageUrl('/local.jpg'), true);
  assert.equal(isSafeImageUrl('https://cdn.example/x.jpg'), true);

  const plan = planCmsItemMigration(
    item({ image: 'javascript:alert(1)' }),
    product(),
    [],
  );
  assert.equal(plan.addImage, null);
});

test('the image row id is deterministic so reruns cannot duplicate it', () => {
  assert.equal(cmsImageRowId('p1'), 'cms_p1');
  assert.equal(cmsImageRowId('p1'), cmsImageRowId('p1'));
  assert.notEqual(cmsImageRowId('p1'), cmsImageRowId('p2'));
});

/* ------------------------------------------------------------ idempotence */

test('planning again after the writes is a no-op', () => {
  const original = item({
    subtitle: 'Clear case',
    description: 'Slim shell',
    badge: 'New',
    image: '/images/cases/iphone17.jpg',
    pricePaise: 129900,
  });
  const before = product();
  const first = planCmsItemMigration(original, before, []);
  assert.equal(Object.keys(first.fills).length, 3);
  assert.ok(first.addImage);

  // Apply the plan's effects, then re-plan against the same CMS row.
  const after = product({
    ...first.fills,
    badge: first.fills.badge ?? null,
  });
  const second = planCmsItemMigration(
    original,
    after,
    first.addImage ? [first.addImage] : [],
  );
  assert.deepEqual(second.fills, {});
  assert.equal(second.addImage, null);
  assert.equal(second.notes.filter((note) => note.startsWith('price differs')).length, 0);
});

/* ------------------------------------------------------------------ script */

test('the migration script is dry-run by default', async () => {
  const source = await readFile(
    path.join(root, 'scripts', 'migrate-cms-products.mjs'),
    'utf8',
  );
  assert.match(source, /--commit/);
  // The commit transaction only runs behind the flag.
  assert.match(source, /if\s*\(!commit\b/);
  assert.match(source, /if\s*\(commit\s*&&/);
  assert.match(source, /max:\s*1/);
});

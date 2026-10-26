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
  findCommerceFields,
  validateLegacyContentWrite,
  isCommerceFieldName,
  isExemptCollectionKey,
} = await jiti.import(path.join(root, 'src', 'lib', 'admin', 'boundary.ts'));
const { COLLECTIONS, THEME_FIELDS } = await jiti.import(
  path.join(root, 'src', 'lib', 'admin', 'collections.ts'),
);

function lastToken(input) {
  const matches = String(input).match(/[A-Za-z_][A-Za-z0-9_]*/g);
  return matches?.length ? matches[matches.length - 1] : String(input);
}

/* ------------------------------------------------------------ detection */

test('design and marketing value shapes pass', () => {
  for (const [key, value] of [
    ['apple.hero_tiles', { heroTiles: [{ headline: 'Hi', href: '/', imageSrc: '/a.png' }] }],
    ['apple.nav', { items: [{ label: 'Store', href: '/store' }] }],
    ['cases.page_header', { title: 'Cases & Protection', sortLabel: 'Sort by' }],
    ['cases.category_links', { items: [{ label: 'All', href: '/all' }] }],
    ['oppo.hot_sale', { badge: 'AI Phone', title: 'Find X9s', image: '/x.jpg', buyLabel: 'Buy now' }],
    ['oppo.products', { items: [{ title: 'F33', image: '/f33.jpg', buyHref: '#' }] }],
  ]) {
    assert.equal(validateLegacyContentWrite(key, value).ok, true, key);
  }
});

test('commerce fields are rejected wherever they are nested', () => {
  const result = validateLegacyContentWrite('cases.category_links', {
    items: [{ label: 'Case', href: '/case', price: 129900 }],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot store commerce data/i);
  assert.match(result.error, /items\[0\]\.price/);
  assert.deepEqual(result.fields.map((hit) => hit.field), ['price']);
});

test('every commerce-shaped key is caught', () => {
  for (const field of [
    'price_paise',
    'compare_at_paise',
    'cost_paise',
    'sku',
    'variants',
    'product_id',
    'stock_status',
    'in_stock',
    'inventory',
    'quantity',
    'discount',
    'order_id',
    'customer_id',
    'shipping_method',
    'payment_method',
    'total_paise',
  ]) {
    const hits = findCommerceFields({ [field]: 1 });
    assert.equal(hits.length, 1, `${field} must be detected`);
    assert.equal(isCommerceFieldName(field), true);
  }
});

test('marketing copy may mention a price without storing one', () => {
  for (const value of [
    { text: 'Save on every price this week' },
    { text: 'price' },
    { buyLabel: 'Buy now', learnLabel: 'Learn more' },
  ]) {
    assert.equal(findCommerceFields(value).length, 0);
  }
});

test('Education Store keys are exempt by rule', () => {
  assert.equal(isExemptCollectionKey('edu.shelf_savings'), true);
  const result = validateLegacyContentWrite('edu.shelf_savings', {
    cards: [{ price: 'From ₹137900.00', stock: 1 }],
  });
  assert.equal(result.ok, true);
});

/* ------------------------------------------------------------- registry */

test('no non-Education legacy collection exposes a commerce field', () => {
  for (const collection of COLLECTIONS) {
    if (isExemptCollectionKey(collection.key)) continue;
    const paths = [
      ...collection.fields.map((field) => field.path),
      ...(collection.lists ?? []).flatMap((list) => [
        list.path,
        ...list.itemFields.map((field) => field.path),
      ]),
    ];
    for (const fieldPath of paths) {
      assert.equal(
        isCommerceFieldName(lastToken(fieldPath)),
        false,
        `${collection.key} exposes ${fieldPath}`,
      );
    }
  }
});

test('theme settings stay design-only', () => {
  for (const field of THEME_FIELDS) {
    assert.equal(isCommerceFieldName(field.path), false, field.path);
  }
});

/* ------------------------------------------------------------- save route */

test('the legacy content route calls the shared boundary validator', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'admin', 'content', 'route.ts'),
    'utf8',
  );
  assert.match(source, /validateLegacyContentWrite\s*\(/);
  assert.doesNotMatch(source, /delete\s+from\s+content_blocks/i);
});

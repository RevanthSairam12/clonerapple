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
  COLLECTION_CACHE_TAG,
  chooseCollectionMembership,
  cleanFallbackIds,
  isValidCollectionKey,
  orderCollectionRows,
} = await jiti.import(path.join(root, 'src', 'lib', 'storefront', 'collections-rules.ts'));
const {
  MAX_COLLECTION_PRODUCTS,
  validateCollectionKey,
  validateMembershipInput,
  validateProductId,
  validateReorderInput,
} = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'collection-rules.ts'),
);

/* --------------------------------------------------------------- ordering */

test('rows are filtered, ordered and de-duplicated', () => {
  const ids = orderCollectionRows([
    { product_id: 'b', position: 2, is_active: true },
    { product_id: 'a', position: 1, is_active: true },
    { product_id: 'z', position: 1, is_active: true },
    { product_id: 'c', position: 0, is_active: false },
    { product_id: 'a', position: 5, is_active: true },
  ]);
  // Position first, then product id as a deterministic tie-break; the
  // duplicate `a` keeps its first (position 1) appearance.
  assert.deepEqual(ids, ['a', 'z', 'b']);
});

test('inactive or malformed rows never render', () => {
  assert.deepEqual(
    orderCollectionRows([
      { product_id: 'a', position: 0, is_active: false },
      { product_id: 'b', position: 0, is_active: true },
    ]),
    ['b'],
  );
  assert.deepEqual(orderCollectionRows([]), []);
});

/* --------------------------------------------------------------- fallback */

test('database membership wins whole over the fallback', () => {
  assert.deepEqual(chooseCollectionMembership(['db1', 'db2'], ['old1', 'old2']), [
    'db1',
    'db2',
  ]);
});

test('an empty collection falls back to the coded/CMS list', () => {
  assert.deepEqual(chooseCollectionMembership([], ['old1', 'old2']), ['old1', 'old2']);
  assert.deepEqual(chooseCollectionMembership([], []), []);
});

test('fallback ids are cleaned without changing their order', () => {
  assert.deepEqual(cleanFallbackIds([' a ', '', 'b', 'a', '  ']), ['a', 'b']);
});

/* ----------------------------------------------------------- key/product */

test('collection keys are lowercase slugs', () => {
  assert.equal(isValidCollectionKey('homepage.featured'), true);
  assert.equal(isValidCollectionKey('homepage_featured-2'), true);
  // Keys are normalised (trimmed and lowercased) before validation.
  assert.equal(isValidCollectionKey('  HOMEPAGE.Featured  '), true);
  assert.equal(isValidCollectionKey(''), false);
  assert.equal(isValidCollectionKey('a'.repeat(65)), false);
  assert.equal(isValidCollectionKey('../etc/passwd'), false);
  assert.equal(isValidCollectionKey('_leading'), false);

  assert.deepEqual(validateCollectionKey(' Homepage.Featured '), {
    ok: true,
    value: 'homepage.featured',
  });
  assert.deepEqual(validateCollectionKey('homepage.featured'), {
    ok: true,
    value: 'homepage.featured',
  });
  assert.equal(validateCollectionKey('bad key').ok, false);
});

test('product ids and membership payloads are validated', () => {
  assert.deepEqual(validateProductId(' iphone17-clear-magsafe '), {
    ok: true,
    value: 'iphone17-clear-magsafe',
  });
  assert.equal(validateProductId('').ok, false);
  assert.equal(validateProductId('bad id').ok, false);

  const membership = validateMembershipInput({
    collectionKey: 'homepage.featured',
    productId: 'p1',
  });
  assert.equal(membership.ok, true);
  assert.deepEqual(membership.value, {
    collectionKey: 'homepage.featured',
    productId: 'p1',
  });
});

test('reorder accepts a unique ordered list and rejects duplicates', () => {
  const good = validateReorderInput({
    collectionKey: 'homepage.featured',
    productIds: ['b', 'a'],
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.productIds, ['b', 'a']);

  const duplicate = validateReorderInput({
    collectionKey: 'homepage.featured',
    productIds: ['a', 'a'],
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /appears twice/i);

  const tooMany = validateReorderInput({
    collectionKey: 'homepage.featured',
    productIds: Array.from({ length: MAX_COLLECTION_PRODUCTS + 1 }, (_, i) => `p${i}`),
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /at most/i);
});

/* -------------------------------------------------------------- migration */

test('migration 0033 is additive, idempotent and RLS-enabled', async () => {
  const sql = await readFile(
    path.join(root, 'migrations', '0033_storefront_collections.sql'),
    'utf8',
  );
  assert.match(sql, /create table if not exists product_collections/i);
  assert.match(sql, /alter table product_collections enable row level security/i);
  assert.match(sql, /alter table content_blocks\s+add column if not exists archived_at/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
});

test('the storefront read layer selects explicit columns only', async () => {
  const source = await readFile(
    path.join(root, 'src', 'lib', 'storefront', 'collections.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /select\s+\*/i);
  assert.match(source, /revalidate:\s*30/);
  assert.equal(COLLECTION_CACHE_TAG, 'storefront-collections');
});

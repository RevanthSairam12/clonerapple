/**
 * Sale boundary on the storefront display.
 *
 * The catalogue snapshot is cached for 30 seconds. The sale switch used to be
 * read when that entry was filled, so starting or ending a sale could show the
 * old price and sale badge for up to 30 seconds. These tests pin the fix:
 *
 * - the cached snapshot holds the regular price with `onSale: false`;
 * - the sale switch is read on every request and applied afterwards;
 * - the pure `applySaleDisplay` is the only place that turns a switch into a
 *   displayed price and badge;
 * - the source wiring cannot reintroduce a cached sale flag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; the integration test stays skipped.
  }
}

function connectionDetails() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    isPooler: url.hostname.includes('pooler') && url.port === '6543',
    transactionPooler: url.port === '6543',
  };
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  const { isPooler } = connectionDetails();
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    connection: { search_path: 'pg_catalog' },
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { applySaleDisplay, snapshotFromLoad } = await jiti.import(
  path.join(root, 'src', 'lib', 'catalog', 'storefront.ts'),
);

const sourceCache = new Map();
async function source(file) {
  if (!sourceCache.has(file)) {
    sourceCache.set(file, await readFile(path.join(root, file), 'utf8'));
  }
  return sourceCache.get(file);
}

/** A product sketch with only the fields `applySaleDisplay` reads. */
function product(overrides = {}) {
  return {
    id: 'p1',
    name: 'Adapter',
    regularPricePaise: 99900,
    salePricePaise: 79900,
    price: 999,
    pricePaise: 99900,
    priceDisplay: '₹999.00',
    onSale: false,
    ...overrides,
  };
}

/* ------------------------------------------------------- pure resolution */

test('the cached snapshot price is the regular price, never the sale price', () => {
  const off = applySaleDisplay(product(), false);
  assert.equal(off.pricePaise, 99900);
  assert.equal(off.priceDisplay, '₹999.00');
  assert.equal(off.onSale, false);

  const on = applySaleDisplay(product(), true);
  assert.equal(on.pricePaise, 79900, 'live sale charges the sale price');
  assert.equal(on.priceDisplay, '₹799.00');
  assert.equal(on.onSale, true);
  assert.equal(on.regularPricePaise, 99900, 'the struck-through price stays');
});

test('the same cached row flips both ways with only the switch changing', () => {
  const row = product();
  const before = applySaleDisplay(row, false);
  const during = applySaleDisplay(row, true);
  const after = applySaleDisplay(row, false);

  assert.equal(before.pricePaise, after.pricePaise);
  assert.equal(before.onSale, after.onSale);
  assert.notEqual(during.pricePaise, before.pricePaise);
  assert.equal(row.onSale, false, 'the source row is not mutated');
  assert.equal(row.pricePaise, 99900);
});

test('a sale price is ignored when it is not a genuine discount', () => {
  const noSalePrice = applySaleDisplay(product({ salePricePaise: null }), true);
  assert.equal(noSalePrice.pricePaise, 99900);
  assert.equal(noSalePrice.onSale, false);

  const aboveRegular = applySaleDisplay(product({ salePricePaise: 120000 }), true);
  assert.equal(aboveRegular.pricePaise, 99900);
  assert.equal(aboveRegular.onSale, false);
});

test('normalized unchanged snapshots retain identity without discarding raw provenance', () => {
  const row = product();
  const normalized = applySaleDisplay(row, false);
  assert.equal(normalized.parentPricePaise, 99900);
  assert.equal(normalized.parentSalePricePaise, 79900);
  assert.equal(applySaleDisplay(normalized, false), normalized);
  assert.ok(!('parentPricePaise' in row), 'normalization never mutates input');
  const live = applySaleDisplay(normalized, true);
  assert.equal(applySaleDisplay(live, true), live);
  const variants = snapshotFromLoad({ categories: [], images: [], attributes: [], deviceModels: [],
    products: [{ id: 'p', inventory_mode: 'variant', price_paise: 1000, sale_price_paise: 800 }],
    variants: [{ id: 'v', product_id: 'p', sku: 'SKU', combination_key: 'key', is_active: true, is_purchasable: true, price_paise_override: 2000 }],
    stock: [{ product_id: 'p', variant_id: 'v', track_inventory: false }],
  }).products[0];
  assert.equal(variants.pricePaise, 2000);
  assert.equal(variants.parentPricePaise, 1000);
  assert.equal(applySaleDisplay(variants, false), variants);
  assert.equal(applySaleDisplay(variants, true), variants, 'parent sale cannot discount an override');
});

/* -------------------------------------------------------- source wiring */

test('the cached catalogue read applies the sale switch OFF', async () => {
  const sourceFile = await source('src/lib/catalog/storefront.ts');
  const start = sourceFile.indexOf('export async function readStorefrontCatalog');
  assert.ok(start > -1, 'readStorefrontCatalog exists');
  const body = sourceFile.slice(start, sourceFile.indexOf('\n}', start));
  assert.match(body, /return snapshotFromLoad\(load\)/);
  assert.doesNotMatch(body, /readSaleState|sale\.live/, 'the cache fill must not read the switch');

  const snapshot = sourceFile.indexOf('export function snapshotFromLoad');
  const snapshotBody = sourceFile.slice(snapshot, sourceFile.indexOf('\n}', snapshot));
  assert.match(snapshotBody, /mapAll\(load, false\)/, 'snapshot is regular-priced');
});

test('every cached display path re-resolves the sale state per request', async () => {
  const catalog = await source('src/lib/storefront/catalog.ts');
  assert.match(catalog, /const getSaleState = cache\(async \(\) => readSaleState\(\)\)/);
  assert.match(catalog, /getSaleState\(\)/);
  assert.match(catalog, /applySaleDisplay\(row, saleLive\)/, 'categories pass the live switch');
  assert.match(catalog, /applySaleDisplay\(state\.product, sale\.live\)/, 'detail re-resolves');
  assert.match(catalog, /applySaleDisplay\(product, sale\.live\)/, 'refs re-resolve');
  // The catalogue readers must not call the switch inside the unstable_cache
  // entry; the only switch read is the per-request one.
  const cachedFills = catalog.slice(0, catalog.indexOf('const getSaleState'));
  assert.doesNotMatch(cachedFills, /readSaleState\(/, 'cache fills never read the switch');
});

test('the sale write path revalidates so a price edit is not delayed by the cache', async () => {
  const route = await source('src/app/api/store-admin/sale/route.ts');
  assert.match(route, /revalidateCatalog\(\)/);
});

/* -------------------------------------------------- database behaviour */

const TABLES = [
  'categories',
  'products',
  'product_images',
  'product_facets',
  'product_specs',
  'product_variants',
  'stock',
  'sale_settings',
  'attributes',
  'attribute_options',
  'product_attribute_values',
];

function fixtureName() {
  return `itest_sale_boundary_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

/** Build a throwaway schema with one product carrying a sale price. */
async function makeSchema(sql, schema) {
  await createFixtureSchema(sql, schema, TABLES);
  // The real storefront now reads type-scoped metadata. Install its actual
  // additive migration locally instead of allowing any public-schema fallback.
  await sql.unsafe(await readFile(path.join(root, 'migrations/0051_product_types_compatibility.sql'), 'utf8'));

  await sql`insert into sale_settings (id) values ('default')`;
  await sql`insert into categories (id, slug, name) values ('c1', 'c1', 'Category')`;
  await sql`
    insert into products (id, category_id, slug, name, price_paise, sale_price_paise)
    values ('p1', 'c1', 'p1', 'Sale product', 99900, 79900)
  `;
  await sql`
    insert into stock (id, product_id, variant_id, on_hand, track_inventory)
    values ('s1', 'p1', null, 5, true)
  `;
  return schema;
}

async function snapshotFromDatabase(sql) {
  const { loadCatalogUsing } = await jiti.import(
    path.join(root, 'src', 'lib', 'catalog', 'storefront.ts'),
  );
  return snapshotFromLoad(await loadCatalogUsing(sql));
}

/** The switch read inside the throwaway schema, on its connection. */
async function saleStateFromDatabase(sql) {
  const { readSaleStateUsing } = await jiti.import(
    path.join(root, 'src', 'lib', 'storefront', 'sale-state.ts'),
  );
  return readSaleStateUsing(sql);
}

test('a database read caches the regular price even while a sale is live', { skip }, async () => {
  const sql = client();
  const schema = fixtureName();
  try {
    await makeSchema(sql, schema);
    await sql`
      update sale_settings
      set enabled = true,
          starts_at = now() - interval '1 hour',
          ends_at = now() + interval '1 hour'
      where id = 'default'
    `;

    const snapshot = await snapshotFromDatabase(sql);
    const row = snapshot.products.find((entry) => entry.id === 'p1');
    assert.equal(row.pricePaise, 99900, 'the cacheable row holds the regular price');
    assert.equal(row.onSale, false);
    assert.equal(row.salePricePaise, 79900, 'the sale price travels with the row');
    assert.equal(row.regularPricePaise, 99900);

    // The switch is applied later, per request, from the same row.
    const live = applySaleDisplay(row, true);
    assert.equal(live.pricePaise, 79900);
    assert.equal(live.onSale, true);
  } finally {
    await cleanup(sql, schema);
  }
});

test('turning the sale on and off is visible from the next request, with no wait', { skip }, async () => {
  const sql = client();
  const schema = fixtureName();
  try {
    await makeSchema(sql, schema);

    const offSnapshot = await snapshotFromDatabase(sql);
    const offRow = offSnapshot.products.find((entry) => entry.id === 'p1');
    assert.equal(applySaleDisplay(offRow, false).pricePaise, 99900);

    // Sale starts. The snapshot is re-read only because this is a new request;
    // the price still stored in it is the regular one either way.
    await sql`
      update sale_settings
      set enabled = true,
          starts_at = now() - interval '1 minute',
          ends_at = now() + interval '1 hour'
      where id = 'default'
    `;
    const startState = await saleStateFromDatabase(sql);
    assert.equal(startState.live, true);

    // Same cached row, new switch: the display flips on this request.
    const duringRow = (await snapshotFromDatabase(sql)).products.find((entry) => entry.id === 'p1');
    assert.equal(applySaleDisplay(duringRow, startState.live).pricePaise, 79900);
    assert.equal(applySaleDisplay(duringRow, startState.live).onSale, true);

    // Sale ends (window moved into the past). The very next read is off.
    await sql`
      update sale_settings
      set starts_at = now() - interval '2 hours',
          ends_at = now() - interval '1 hour'
      where id = 'default'
    `;
    const endState = await saleStateFromDatabase(sql);
    assert.equal(endState.live, false);
    const afterRow = (await snapshotFromDatabase(sql)).products.find((entry) => entry.id === 'p1');
    assert.equal(applySaleDisplay(afterRow, endState.live).pricePaise, 99900);
    assert.equal(applySaleDisplay(afterRow, endState.live).onSale, false);
  } finally {
    await cleanup(sql, schema);
  }
});

test('a sale window that has not started yet is off on the first request', { skip }, async () => {
  const sql = client();
  const schema = fixtureName();
  try {
    await makeSchema(sql, schema);
    await sql`
      update sale_settings
      set enabled = true,
          starts_at = now() + interval '1 hour',
          ends_at = now() + interval '2 hours'
      where id = 'default'
    `;

    const state = await saleStateFromDatabase(sql);
    assert.equal(state.status, 'scheduled');
    assert.equal(state.live, false);

    const row = (await snapshotFromDatabase(sql)).products.find((entry) => entry.id === 'p1');
    assert.equal(applySaleDisplay(row, state.live).pricePaise, 99900);
    assert.equal(applySaleDisplay(row, state.live).onSale, false);
  } finally {
    await cleanup(sql, schema);
  }
});

async function cleanup(sql, schema) {
  try {
    await dropFixtureSchema(sql, schema);
  } catch (error) {
    console.warn('[sale-boundary] cleanup did not finish:', error?.message ?? error);
  }
  await sql.end({ timeout: 5 });
}

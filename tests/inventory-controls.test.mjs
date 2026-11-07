/**
 * Inventory controls: starting to track a product that has never had a stock
 * row requires a real opening count, and that count is written as an
 * append-only movement. Turning tracking off leaves the count alone.
 *
 * Runs against a throwaway schema cloned from the real tables. Skipped when
 * DATABASE_URL is unset or the connection is a transaction pooler.
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
    // No .env.local; the test stays skipped.
  }
}

function fixtureConnectionUrl() {
  return (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
}

function connectionDetails() {
  const url = new URL(fixtureConnectionUrl());
  return {
    isPooler: url.hostname.includes('pooler') && url.port === '6543',
    transactionPooler: url.port === '6543',
  };
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !fixtureConnectionUrl()
  ? 'DATABASE_MIGRATION_URL / DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  const { isPooler, transactionPooler } = connectionDetails();
  if (transactionPooler) throw new Error('Requires a session connection, not port 6543.');
  return postgres(fixtureConnectionUrl(), {
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
const { updateStockSettingsUsing } = await jiti.import(
  path.join(root, 'src/lib/store-admin/catalog-crud.ts'),
);

const TABLES = ['categories', 'products', 'stock', 'stock_movements', 'store_admin_audit'];

test('inventory controls are rendered on the product, stock and product-list pages', async () => {
  const productPage = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/products/[id]/page.tsx'),
    'utf8',
  );
  assert.match(productPage, /<Product(?:InventoryCard|Workflow)/);

  const card = await readFile(
    path.join(root, 'src/components/store-admin/ProductInventoryCard.tsx'),
    'utf8',
  );
  assert.match(card, /Limit my stock/);
  assert.match(card, /Warn me when below/);
  assert.match(card, /Add or remove stock/);
  assert.match(card, /Held in checkouts/);
  assert.match(card, /Available to buy/);
  assert.match(card, /can be oversold/i);
  assert.match(card, /window\.confirm/);

  const stockPage = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/stock/page.tsx'),
    'utf8',
  );
  assert.match(stockPage, /filter=tracking-off/);
  assert.match(stockPage, /Limit my stock/);
  assert.match(stockPage, />\s*Add or remove stock\s*</);

  const productsPage = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/products/page.tsx'),
    'utf8',
  );
  assert.match(productsPage, /catalogStockLabel\(product\)/);
  assert.match(productsPage, /Set stock/);
  assert.match(productsPage, /stockStatus/);
  const catalog = await readFile(path.join(root, 'src/lib/store-admin/catalog.ts'), 'utf8');
  assert.match(catalog, /export function catalogStockLabel\(/);
  for (const label of ['Not limited', 'Out of stock', 'Stock setup needed', 'Mixed stock limits']) {
    assert.ok(catalog.includes(label), `catalog stock label includes ${label}`);
  }
});

test('stock terminology is consistent across inventory, CSV help, sale and POS displays', async () => {
  const source = async (file) => readFile(path.join(root, file), 'utf8');
  for (const file of [
    'src/components/store-admin/StockControls.tsx',
    'src/components/store-admin/VariantEditor.tsx',
    'src/app/(store-admin)/store-admin/(protected)/low-stock/page.tsx',
  ]) {
    const text = await source(file);
    assert.match(text, /Warn me when below/, file);
    assert.doesNotMatch(text, /Track inventory|On hand|Reserved|Low-stock threshold|Adjust stock/, file);
  }
  const help = await source('src/components/store-admin/CatalogTransfer.tsx');
  assert.match(help, /Units held in checkouts are never imported/);
  assert.match(help, /<code>confirm_tracking<\/code>/);
  assert.match(help, /<code>inventory_variants<\/code>/);
  assert.match(await source('src/app/(store-admin)/store-admin/(protected)/sale/page.tsx'), /Available to buy/);
  assert.match(await source('src/components/store-admin/PosTill.tsx'), /Not limited/);
});

test('stock writes stay behind the admin guards', async () => {
  const route = await readFile(
    path.join(root, 'src/app/api/store-admin/stock/[productId]/route.ts'),
    'utf8',
  );
  assert.match(route, /requireStoreRole\('store_admin'\)/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /catalog\.stock\.settings/);
});

test('tracking on without a stock row needs an opening count and records it', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_${suffix}`;
  const categoryId = `itestcat${suffix}`;
  const productId = `itestprod${suffix}`;
  const sql = client();

  try {
    await createFixtureSchema(sql, schema, TABLES);
    const pinned = await sql`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is not pinned');

    await sql`
      insert into categories (id, slug, name)
      values (${categoryId}, ${categoryId}, 'Inventory test category')
    `;
    await sql`
      insert into products (id, category_id, slug, name, price_paise)
      values (${productId}, ${categoryId}, ${productId}, 'Inventory test product', 49900)
    `;

    const missing = await updateStockSettingsUsing(sql, {
      productId,
      settings: { trackInventory: true, lowStockThreshold: 0, onHand: null },
      staffId: 'integration-owner',
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'invalid-input');
    const noRows = await sql`select id from stock where product_id = ${productId}`;
    assert.equal(noRows.length, 0, 'nothing is created without a count');

    const opened = await updateStockSettingsUsing(sql, {
      productId,
      settings: { trackInventory: true, lowStockThreshold: 2, onHand: 7 },
      staffId: 'integration-owner',
    });
    assert.equal(opened.ok, true);
    assert.equal(opened.data.after.onHand, 7);
    assert.equal(opened.data.inStock, true);
    assert.ok(opened.data.movementId > 0, 'the opening count is a movement');

    const stockRows = await sql`
      select on_hand, reserved, track_inventory, low_stock_threshold
      from stock where product_id = ${productId} and variant_id is null
    `;
    assert.equal(stockRows.length, 1);
    assert.equal(Number(stockRows[0].on_hand), 7);
    assert.equal(Number(stockRows[0].reserved), 0);
    assert.equal(Boolean(stockRows[0].track_inventory), true);
    assert.equal(Number(stockRows[0].low_stock_threshold), 2);

    const movements = await sql`
      select delta, reason, note from stock_movements where product_id = ${productId}
    `;
    assert.equal(movements.length, 1);
    assert.equal(Number(movements[0].delta), 7);
    assert.equal(String(movements[0].reason), 'receipt');
    assert.match(String(movements[0].note), /opening count/i);

    const audits = await sql`
      select actor_id, action, entity_id, before, after
      from store_admin_audit where entity_id = ${productId} order by id
    `;
    assert.equal(audits.length, 1, 'the opening balance and its audit commit together');
    assert.equal(audits[0].actor_id, 'integration-owner');
    assert.equal(audits[0].action, 'catalog.stock.settings');
    assert.deepEqual(audits[0].before, { onHand: 0, reserved: 0, trackInventory: false });
    assert.deepEqual(audits[0].after, {
      onHand: 7, reserved: 0, trackInventory: true, lowStockThreshold: 2,
    });

    const productRows = await sql`select in_stock from products where id = ${productId}`;
    assert.equal(Boolean(productRows[0].in_stock), true);

    // A later save never rewrites the count: only adjustments may move it.
    const updated = await updateStockSettingsUsing(sql, {
      productId,
      settings: { trackInventory: true, lowStockThreshold: 3, onHand: 99 },
      staffId: 'integration-owner',
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.data.after.onHand, 7);
    assert.equal(updated.data.movementId, 0);
    const afterRows = await sql`
      select on_hand from stock where product_id = ${productId} and variant_id is null
    `;
    assert.equal(Number(afterRows[0].on_hand), 7);

    // Turning tracking off warns in the UI; on the server it only flips the
    // flag and makes the product purchasable again.
    const off = await updateStockSettingsUsing(sql, {
      productId,
      settings: { trackInventory: false, lowStockThreshold: 3, onHand: null },
      staffId: 'integration-owner',
    });
    assert.equal(off.ok, true);
    assert.equal(off.data.after.trackInventory, false);
    assert.equal(off.data.inStock, true);
    const offRows = await sql`select in_stock from products where id = ${productId}`;
    assert.equal(Boolean(offRows[0].in_stock), true);
  } finally {
    try {
      await dropFixtureSchema(sql, schema);
    } catch (error) {
      console.warn('[inventory-controls] cleanup did not finish:', error?.message ?? error);
    }
    await sql.end({ timeout: 5 });
  }
});

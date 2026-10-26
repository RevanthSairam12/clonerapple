/**
 * Sale pricing.
 *
 * One resolver decides whether a stored sale price applies, and it is the only
 * place that turns `sale_price_paise` into a charged amount. Timing is decided
 * against a `now()` supplied by the caller, which every caller reads from
 * PostgreSQL — never the browser clock.
 *
 * The write-side tests run against a throwaway schema cloned from the real
 * tables; they are skipped when DATABASE_URL is unset or is a transaction
 * pooler (temporary-schema isolation needs a session connection).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

if (!process.env.DATABASE_URL) {
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

const skip = !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  const { isPooler } = connectionDetails();
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { discountPercent, resolveEffectivePrice } = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'pricing.ts'),
);
const { isSaleLive, saleStatusAt } = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'sale.ts'),
);
const { checkSalePrice, validatePricePatch } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'catalog-crud-rules.ts'),
);
const {
  EXPORT_COLUMNS,
  IMPORT_COLUMNS,
  templateCsv,
  validateImportRows,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'catalog-csv.ts'));
const { updateProductPricingUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'catalog-crud.ts'),
);

/* --------------------------------------------------------------- resolver */

test('the resolver charges the regular price while sale mode is off', () => {
  const price = resolveEffectivePrice({ pricePaise: 49900, salePricePaise: 39900 }, false);
  assert.equal(price.unitPaise, 49900);
  assert.equal(price.regularPaise, 49900);
  assert.equal(price.salePaise, 39900);
  assert.equal(price.onSale, false);
});

test('the resolver charges the sale price only when it is a lower positive amount', () => {
  const live = { pricePaise: 49900, salePricePaise: 39900 };
  assert.equal(resolveEffectivePrice(live, true).unitPaise, 39900);
  assert.equal(resolveEffectivePrice(live, true).onSale, true);

  for (const salePricePaise of [null, undefined, 0, -1, 49900, 59900]) {
    const price = resolveEffectivePrice({ pricePaise: 49900, salePricePaise }, true);
    assert.equal(price.unitPaise, 49900, `sale ${salePricePaise} must be ignored`);
    assert.equal(price.onSale, false);
  }
});

test('a regular price of zero is never discounted into a paid sale', () => {
  const price = resolveEffectivePrice({ pricePaise: 0, salePricePaise: 100 }, true);
  assert.equal(price.unitPaise, 0);
  assert.equal(price.onSale, false);
});

test('discountPercent is a floored whole percent', () => {
  assert.equal(discountPercent(50000, 40000), 20);
  assert.equal(discountPercent(50000, 49999), 0);
  assert.equal(discountPercent(0, 100), 0);
  assert.equal(discountPercent(50000, 60000), 0);
});

/* ------------------------------------------------------------ sale window */

const T = (value) => new Date(value).toISOString();

test('with no window the toggle alone decides', () => {
  const window = { enabled: true, startsAt: null, endsAt: null };
  assert.equal(saleStatusAt(window, T('2026-10-27T10:00:00Z')), 'live');
  assert.equal(isSaleLive(window, T('2026-10-27T10:00:00Z')), true);
  assert.equal(saleStatusAt({ ...window, enabled: false }, T('2026-10-27T10:00:00Z')), 'off');
});

test('starts_at is inclusive and ends_at is exclusive', () => {
  const window = {
    enabled: true,
    startsAt: T('2026-10-27T00:00:00Z'),
    endsAt: T('2026-10-28T00:00:00Z'),
  };
  assert.equal(saleStatusAt(window, T('2026-10-26T23:59:59Z')), 'scheduled');
  assert.equal(saleStatusAt(window, T('2026-10-27T00:00:00Z')), 'live');
  assert.equal(saleStatusAt(window, T('2026-10-27T23:59:59Z')), 'live');
  assert.equal(saleStatusAt(window, T('2026-10-28T00:00:00Z')), 'off');
});

test('an off switch beats a window that covers now', () => {
  const window = {
    enabled: false,
    startsAt: T('2026-10-01T00:00:00Z'),
    endsAt: T('2026-11-01T00:00:00Z'),
  };
  assert.equal(saleStatusAt(window, T('2026-10-27T10:00:00Z')), 'off');
});

test('an unparseable clock or window is off, never accidentally live', () => {
  const window = { enabled: true, startsAt: 'soon', endsAt: null };
  assert.equal(saleStatusAt(window, 'not-a-time'), 'off');
  assert.equal(saleStatusAt(window, T('2026-10-27T10:00:00Z')), 'live');
  assert.equal(saleStatusAt({ ...window, startsAt: 'soon' }, T('2026-10-27T10:00:00Z')), 'live');
});

/* ----------------------------------------------------- admin validation */

test('a sale price must be positive and lower than the selling price', () => {
  assert.equal(checkSalePrice({ salePaise: 39900, regularPaise: 49900, costPaise: null }).error, null);
  assert.match(
    checkSalePrice({ salePaise: 49900, regularPaise: 49900, costPaise: null }).error,
    /lower/,
  );
  assert.match(
    checkSalePrice({ salePaise: 59900, regularPaise: 49900, costPaise: null }).error,
    /lower/,
  );
  assert.match(
    checkSalePrice({ salePaise: 0, regularPaise: 49900, costPaise: null }).error,
    /positive/,
  );
});

test('below cost warns but does not block', () => {
  const result = checkSalePrice({ salePaise: 20000, regularPaise: 49900, costPaise: 30000 });
  assert.equal(result.error, null);
  assert.match(result.warning, /below cost/i);
  assert.equal(checkSalePrice({ salePaise: null, regularPaise: 49900, costPaise: 30000 }).warning, null);
});

test('the price patch accepts a sale price and a clear, but not zero', () => {
  const set = validatePricePatch({ salePricePaise: 39900 });
  assert.equal(set.ok, true);
  assert.equal(set.value.salePricePaise, 39900);

  const cleared = validatePricePatch({ salePricePaise: null });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.value.salePricePaise, null);

  const empty = validatePricePatch({ salePricePaise: '' });
  assert.equal(empty.ok, true);
  assert.equal(empty.value.salePricePaise, null);

  assert.equal(validatePricePatch({ salePricePaise: 0 }).ok, false);
  assert.equal(validatePricePatch({ salePricePaise: -1 }).ok, false);
});

/* ---------------------------------------------------------------- the CSV */

function csvRow(values) {
  return IMPORT_COLUMNS.map((column) => (values[column] === undefined ? '' : String(values[column])));
}

const CSV_CONTEXT = {
  categories: [{ id: 'cat_power', slug: 'power', name: 'Power' }],
  brands: [],
  conditions: [],
  existing: new Map(),
};

test('the CSV carries a sale price column in export and template', () => {
  assert.ok(IMPORT_COLUMNS.includes('sale_price'));
  assert.ok(EXPORT_COLUMNS.includes('sale_price'));
  assert.match(templateCsv().split('\r\n')[0], /(^|,)sale_price(,|$)/);
});

test('a sale price in a CSV row is parsed and validated per row', () => {
  const good = validateImportRows(
    [...IMPORT_COLUMNS],
    [csvRow({ name: 'Charger', category: 'Power', price: '3499', sale_price: '2999' })],
    CSV_CONTEXT,
  );
  assert.deepEqual(good.errors, []);
  assert.equal(good.rows[0].salePricePaise, 299900);

  const blank = validateImportRows(
    [...IMPORT_COLUMNS],
    [csvRow({ name: 'Charger', category: 'Power', price: '3499' })],
    CSV_CONTEXT,
  );
  assert.deepEqual(blank.errors, []);
  assert.equal(blank.rows[0].salePricePaise, null);

  const notLower = validateImportRows(
    [...IMPORT_COLUMNS],
    [csvRow({ name: 'Charger', category: 'Power', price: '3499', sale_price: '3499' })],
    CSV_CONTEXT,
  );
  assert.equal(notLower.errors.length, 1);
  assert.equal(notLower.errors[0].column, 'sale_price');
  assert.match(notLower.errors[0].message, /lower/);

  const negative = validateImportRows(
    [...IMPORT_COLUMNS],
    [csvRow({ name: 'Charger', category: 'Power', price: '3499', sale_price: '-1' })],
    CSV_CONTEXT,
  );
  assert.equal(negative.errors[0].column, 'sale_price');
});

test('CSV import keeps a per-row error and does not fail the whole validation pass', () => {
  const result = validateImportRows(
    [...IMPORT_COLUMNS],
    [
      csvRow({ name: 'Good', category: 'Power', price: '1000', sale_price: '900' }),
      csvRow({ name: 'Bad', category: 'Power', price: '1000', sale_price: '1000' }),
    ],
    CSV_CONTEXT,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].rowNumber, 3);
});

/* ------------------------------------------------- shared resolver guard */

test('every charged price goes through the one resolver', async () => {
  for (const file of [
    'src/lib/catalog/storefront.ts',
    'src/lib/payu/db-catalog.ts',
    'src/lib/store-admin/pos.ts',
  ]) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.match(source, /resolveEffectivePrice/, `${file} must use the resolver`);
  }

  // Any file that reads the sale column must be on this list. The three
  // customer-facing readers resolve it; the admin readers only display it.
  const allowed = new Set([
    'src/lib/catalog/storefront.ts',
    'src/lib/payu/db-catalog.ts',
    'src/lib/store-admin/catalog.ts',
    'src/lib/store-admin/catalog-crud.ts',
    'src/lib/store-admin/catalog-transfer.ts',
    'src/lib/store-admin/pos.ts',
  ]);
  const files = await findFiles(path.join(root, 'src'));
  const readers = files.filter((file) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    return source_cache.get(file)?.includes('sale_price_paise');
  });
  for (const file of readers) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    assert.ok(allowed.has(relative), `${relative} reads sale_price_paise outside the resolver set`);
  }
});

/** Source cache filled by findFiles, so the guard reads each file once. */
const source_cache = new Map();

async function findFiles(dir) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      source_cache.set(full, await readFile(full, 'utf8'));
      files.push(full);
    }
  }
  return files;
}

test('the database clock decides the sale, not the browser', async () => {
  const source = await readFile(path.join(root, 'src/lib/storefront/sale-state.ts'), 'utf8');
  assert.match(source, /now\(\) as db_now/);
  assert.match(source, /saleStatusAt\(/);
  assert.match(source, /return \{ \.\.\.SALE_OFF \}/);
  assert.match(source, /catch/);

  // A client bundle cannot contain a sale decision: the module refuses to load.
  assert.match(source, /typeof window !== 'undefined'/);
});

test('the sale badge and price UI read the resolved fields', async () => {
  const editor = await readFile(
    path.join(root, 'src/components/store-admin/ProductPriceEditor.tsx'),
    'utf8',
  );
  assert.match(editor, /Sale price/);
  assert.match(editor, /salePricePaise:\s*saleValue/);
  assert.match(editor, /body\.warnings/);

  const list = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/products/page.tsx'),
    'utf8',
  );
  assert.match(list, /Sale price/);
  assert.match(list, /salePricePaise/);

  const detail = await readFile(
    path.join(root, 'src/components/shop/ProductDetailPage.tsx'),
    'utf8',
  );
  assert.match(detail, /wasPriceDisplay|regularPrice/);
});

/* ---------------------------------------------------------- price writes */

const TABLES = ['categories', 'products', 'price_history'];

test('sale price writes append marked history rows and require a lower price', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_sale_${suffix}`;
  const categoryId = `itestcat${suffix}`;
  const productId = `itestprod${suffix}`;
  const sql = client();

  try {
    await sql.unsafe(`create schema "${schema}"`);
    for (const table of TABLES) {
      await sql.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
    }
    await sql.unsafe(`set search_path to "${schema}"`);
    const pinned = await sql`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is not pinned');

    await sql`
      insert into categories (id, slug, name)
      values (${categoryId}, ${categoryId}, 'Sale test category')
    `;
    await sql`
      insert into products (id, category_id, slug, name, price_paise, cost_paise)
      values (${productId}, ${categoryId}, ${productId}, 'Sale test product', 50000, 30000)
    `;

    const setSale = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: 40000 },
      'test sale',
      'integration-owner',
    );
    assert.equal(setSale.ok, true);
    assert.equal(setSale.data.changed, true);
    assert.deepEqual(setSale.data.warnings, []);

    let rows = await sql`
      select price_paise, sale_price_paise from products where id = ${productId}
    `;
    assert.equal(Number(rows[0].price_paise), 50000, 'the regular price is untouched');
    assert.equal(Number(rows[0].sale_price_paise), 40000);

    let history = await sql`
      select old_price_paise, new_price_paise, price_kind
      from price_history where product_id = ${productId} order by id
    `;
    assert.equal(history.length, 1);
    assert.equal(history[0].price_kind, 'sale');
    assert.equal(history[0].old_price_paise, null);
    assert.equal(Number(history[0].new_price_paise), 40000);

    const lower = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: 35000 },
      'test sale',
      'integration-owner',
    );
    assert.equal(lower.ok, true);
    history = await sql`
      select old_price_paise, new_price_paise, price_kind
      from price_history where product_id = ${productId} order by id
    `;
    assert.equal(history.length, 2);
    assert.equal(history[1].price_kind, 'sale');
    assert.equal(Number(history[1].old_price_paise), 40000);
    assert.equal(Number(history[1].new_price_paise), 35000);

    const tooHigh = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: 50000 },
      'test sale',
      'integration-owner',
    );
    assert.equal(tooHigh.ok, false);
    assert.equal(tooHigh.reason, 'invalid-input');
    assert.match(tooHigh.error, /lower/);

    const belowCost = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: 25000 },
      'test sale',
      'integration-owner',
    );
    assert.equal(belowCost.ok, true);
    assert.equal(belowCost.data.warnings.length, 1);
    assert.match(belowCost.data.warnings[0], /below cost/i);

    const regularChange = await updateProductPricingUsing(
      sql,
      productId,
      { pricePaise: 55000 },
      'supplier drop',
      'integration-owner',
    );
    assert.equal(regularChange.ok, true);
    history = await sql`
      select price_kind from price_history where product_id = ${productId} order by id
    `;
    assert.equal(history[history.length - 1].price_kind, 'regular');

    const cleared = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: null },
      'test sale',
      'integration-owner',
    );
    assert.equal(cleared.ok, true);
    rows = await sql`
      select price_paise, sale_price_paise from products where id = ${productId}
    `;
    assert.equal(rows[0].sale_price_paise, null);
    assert.equal(Number(rows[0].price_paise), 55000);
    history = await sql`
      select old_price_paise, new_price_paise, price_kind
      from price_history where product_id = ${productId} order by id
    `;
    const last = history[history.length - 1];
    assert.equal(last.price_kind, 'sale_cleared');
    assert.equal(Number(last.old_price_paise), 25000);
    assert.equal(Number(last.new_price_paise), 0, 'the clear sentinel is zero');

    // Rows written without an explicit kind default to a regular change.
    await sql`
      insert into price_history (product_id, variant_id, old_price_paise, new_price_paise, currency, reason, source)
      values (${productId}, null, 55000, 56000, 'INR', 'legacy row', 'store_admin')
    `;
    const legacy = await sql`
      select price_kind from price_history where product_id = ${productId} order by id desc limit 1
    `;
    assert.equal(legacy[0].price_kind, 'regular');
  } finally {
    try {
      await sql.unsafe('set search_path to public');
      await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    } catch (error) {
      console.warn('[sale-pricing] cleanup did not finish:', error?.message ?? error);
    }
    await sql.end({ timeout: 5 });
  }
});

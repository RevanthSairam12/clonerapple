/**
 * Sale price entry, on every surface.
 *
 * The same rupee parser and sale rule are used by the product page, the sale
 * table, CSV import and the server write. These tests pin the decimal and
 * grouped-digit handling, the exact operator-facing messages, and the fact
 * that a below-cost sale is saved with a warning instead of being blocked.
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

const {
  MAX_PRICE_PAISE,
  belowCostWarning,
  formatRupees,
  parseRupeesToPaise,
  salePriceProblem,
} = await jiti.import(path.join(root, 'src/lib/store-admin/money.ts'));
const { checkSalePrice, validatePricePatch } = await jiti.import(
  path.join(root, 'src/lib/store-admin/catalog-crud-rules.ts'),
);
const { bulkSalePrice, parseSalePercent } = await jiti.import(
  path.join(root, 'src/lib/store-admin/sale-admin-rules.ts'),
);
const { IMPORT_COLUMNS, parseMoneyToPaise, validateImportRows } = await jiti.import(
  path.join(root, 'src/lib/store-admin/catalog-csv.ts'),
);
const { updateProductPricingUsing } = await jiti.import(
  path.join(root, 'src/lib/store-admin/catalog-crud.ts'),
);

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

/* ------------------------------------------------------ rupee conversion */

test('rupees become exact whole paise, including decimals', () => {
  assert.deepEqual(parseRupeesToPaise('499.50'), { ok: true, paise: 49950 });
  assert.deepEqual(parseRupeesToPaise('499.5'), { ok: true, paise: 49950 });
  assert.deepEqual(parseRupeesToPaise('499'), { ok: true, paise: 49900 });
  assert.deepEqual(parseRupeesToPaise('0.01'), { ok: true, paise: 1 });
  assert.deepEqual(parseRupeesToPaise('  '), { ok: true, paise: null });
  assert.deepEqual(parseRupeesToPaise(''), { ok: true, paise: null });
});

test('pasted rupee signs and grouped digits are accepted', () => {
  assert.equal(parseRupeesToPaise('₹499.50').paise, 49950);
  assert.equal(parseRupeesToPaise('Rs 499.50').paise, 49950);
  assert.equal(parseRupeesToPaise('Rs.499.50').paise, 49950);
  assert.equal(parseRupeesToPaise('₹1,29,900.50').paise, 12990050);
  assert.equal(parseRupeesToPaise(' 2,999 ').paise, 299900);
});

test('bad money is rejected with a plain message, never a 100x guess', () => {
  for (const value of ['-5', '1.234', 'free', '1e3', '--1']) {
    const parsed = parseRupeesToPaise(value);
    assert.equal(parsed.ok, false, value);
    assert.match(parsed.message, /rupees/);
  }
  // 499.50 is 499.50, not 49950 rupees and not 4995 paise.
  assert.equal(parseRupeesToPaise('499.50').paise, 49950);
  assert.notEqual(parseRupeesToPaise('499.50').paise, 49950 * 100);
});

test('formatRupees is the one display format', () => {
  assert.equal(formatRupees(79900), '₹799.00');
  assert.equal(formatRupees(49950), '₹499.50');
  assert.equal(formatRupees(12990050), '₹1,29,900.50');
});

/* ----------------------------------------------------------- sale rules */

test('a sale must be positive and strictly lower than the regular price', () => {
  assert.equal(salePriceProblem(49950, 79900), null);

  const equal = salePriceProblem(79900, 79900);
  assert.match(equal, /lower than the regular price/);
  assert.match(equal, /₹799\.00/, 'the message names the regular price');

  assert.match(salePriceProblem(79901, 79900), /lower than the regular price/);
  assert.match(salePriceProblem(0, 79900), /positive amount above zero/);
  assert.match(salePriceProblem(-1, 79900), /positive amount above zero/);
  assert.match(
    salePriceProblem(49950, 0),
    /Set a regular price above zero/,
    'a sale cannot exist without a regular price',
  );
  assert.match(salePriceProblem(MAX_PRICE_PAISE + 1, MAX_PRICE_PAISE + 2), /or less/);
});

test('below cost is a warning with the cost named, never an error', () => {
  const warning = belowCostWarning(49950, 60000);
  assert.ok(warning);
  assert.match(warning, /below cost/);
  assert.match(warning, /₹600\.00/);
  assert.match(warning, /will still be saved/);
  assert.equal(belowCostWarning(60000, 60000), null);
  assert.equal(belowCostWarning(50000, null), null);

  const result = checkSalePrice({ salePaise: 49950, regularPaise: 79900, costPaise: 60000 });
  assert.equal(result.error, null);
  assert.match(result.warning, /will still be saved/);
});

test('API validation talks in rupees, not raw paise bounds', () => {
  assert.equal(validatePricePatch({ salePricePaise: 49950 }).ok, true);
  assert.equal(validatePricePatch({ salePricePaise: null }).ok, true);
  assert.equal(validatePricePatch({ salePricePaise: 0 }).ok, false);
  assert.equal(validatePricePatch({ salePricePaise: 1.5 }).ok, false);

  const zero = validatePricePatch({ salePricePaise: 0 });
  assert.equal(zero.ok, false);
  assert.match(zero.error, /₹0\.01/);
  assert.match(zero.error, /₹10,00,000\.00/);
  assert.equal(zero.error.includes('100000000'), false, 'no raw paise bound');
});

/* ------------------------------------------------------------- CSV row */

const CSV_CONTEXT = {
  categories: [{ id: 'cat_power', slug: 'power', name: 'Power' }],
  brands: [],
  conditions: [],
  existing: new Map(),
};

function csvRow(values) {
  const cells = { product_type_id: 'null', device_model_ids: '[]', attribute_values: '{}', ...values };
  return IMPORT_COLUMNS.map((column) => (cells[column] === undefined ? '' : String(cells[column])));
}

test('CSV uses the same parser and keeps decimals', () => {
  assert.equal(parseMoneyToPaise('₹2,999.50'), 299950);
  assert.equal(parseMoneyToPaise('2999.50'), 299950);
  assert.equal(parseMoneyToPaise('12.345'), null);

  const result = validateImportRows(
    [...IMPORT_COLUMNS],
    [csvRow({ name: 'Charger', category: 'Power', price: '3,499', sale_price: '₹2,999.50' })],
    CSV_CONTEXT,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].pricePaise, 349900);
  assert.equal(result.rows[0].salePricePaise, 299950);
});

test('CSV reports the regular price in the row error', () => {
  const result = validateImportRows(
    [...IMPORT_COLUMNS],
    [csvRow({ name: 'Charger', category: 'Power', price: '3499', sale_price: '3499' })],
    CSV_CONTEXT,
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].column, 'sale_price');
  assert.match(result.errors[0].message, /lower than the regular price/);
  assert.match(result.errors[0].message, /₹3,499\.00/);
});

/* ---------------------------------------------------------- every surface */

test('the product page parses rupees and confirms the sale explicitly', async () => {
  const editor = await source('src/components/store-admin/ProductPriceEditor.tsx');
  assert.match(editor, /parseRupeesToPaise/);
  assert.match(editor, /salePriceProblem/);
  assert.match(editor, /Sale price saved: \$\{formatRupees\(saleValue\)\}/);
  assert.match(editor, /Sale price cleared\./);
  assert.match(editor, /Saved with a warning:/);
  assert.match(editor, /inputMode="decimal"/);
  assert.doesNotMatch(editor, /Math\.round\(Number\(price\) \* 100\)/);
  assert.doesNotMatch(editor, /Math\.round\(Number\(sale\) \* 100\)/);
});

test('bulk percent-off uses whole paise and confirms the result', async () => {
  assert.equal(bulkSalePrice(79900, 25), 59925, '₹799.00 less 25% is ₹599.25');
  assert.equal(bulkSalePrice(79900, 10), 71910, '₹719.10');
  assert.equal(parseSalePercent(25).value, 25);
  assert.equal(parseSalePercent(0).ok, false);
  assert.equal(parseSalePercent(96).ok, false);
  assert.equal(parseSalePercent(12.5).ok, false);
  assert.match(parseSalePercent(0).error, /whole percent between 1 and 95/);

  const bulk = await source('src/components/store-admin/SaleBulkActions.tsx');
  assert.match(bulk, /Set sale prices on/);
  assert.match(bulk, /Cleared \$\{changed\} sale price/);
  assert.match(bulk, /No sale prices changed\./);
});

test('the sale table parses rupees, confirms, and hides writes from viewers', async () => {
  const row = await source('src/components/store-admin/SaleProductRow.tsx');
  assert.match(row, /parseRupeesToPaise/);
  assert.match(row, /salePriceProblem/);
  assert.match(row, /Sale price saved: \$\{formatRupees\(next\)\}/);
  assert.match(row, /Sale price cleared\./);
  assert.match(row, /canEdit/);
  assert.match(row, /inputMode="decimal"/);
  assert.doesNotMatch(row, /Math\.round\(Number\(value\) \* 100\)/);

  const page = await source('src/app/(store-admin)/store-admin/(protected)/sale/page.tsx');
  assert.match(page, /canEdit=\{canEdit\}/);
  assert.match(page, /How to start a sale/);
  assert.match(page, /Set a regular price above zero/);
  assert.match(page, /Enter a sale price below that regular price/);
  assert.match(page, /A sale price below cost still\s+saves/);
  assert.match(page, /SALE LIVE/);
});

test('a sale-only write does not re-check an untouched compare-at price', async () => {
  const crud = await source('src/lib/store-admin/catalog-crud.ts');
  assert.match(
    crud,
    /patch\.pricePaise !== undefined \|\| patch\.compareAtPaise !== undefined/,
  );
  assert.match(crud, /const sale = checkSalePrice\(/);
});

test('CSV errors use the shared rupee formatter', async () => {
  const csv = await source('src/lib/store-admin/catalog-csv.ts');
  assert.match(csv, /formatRupees\(pricePaise\)/);
  assert.match(csv, /parseRupeesToPaise/);
});

/* ------------------------------------------------------- database write */

const TABLES = ['categories', 'products', 'price_history'];

test('a decimal sale price is stored exactly and history records the paise', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_sale_entry_${suffix}`;
  const categoryId = `itestcat${suffix}`;
  const productId = `itestprod${suffix}`;
  const sql = client();

  try {
    await createFixtureSchema(sql, schema, TABLES);

    await sql`
      insert into categories (id, slug, name)
      values (${categoryId}, ${categoryId}, 'Sale entry category')
    `;
    await sql`
      insert into products (id, category_id, slug, name, price_paise, cost_paise, compare_at_paise)
      values (${productId}, ${categoryId}, ${productId}, 'Sale entry product', 79900, 60000, 89900)
    `;

    // ₹499.50 typed by the admin.
    const set = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: 49950 },
      'test sale',
      'integration-owner',
    );
    assert.equal(set.ok, true);
    assert.equal(set.data.changed, true);
    assert.equal(set.data.after.salePricePaise, 49950);
    assert.equal(set.data.after.pricePaise, 79900, 'the regular price is untouched');
    assert.equal(set.data.after.compareAtPaise, 89900, 'the compare-at price is untouched');
    assert.equal(set.data.warnings.length, 1);
    assert.match(set.data.warnings[0], /will still be saved/);

    const rows = await sql`
      select price_paise, sale_price_paise, compare_at_paise
      from products where id = ${productId}
    `;
    assert.equal(Number(rows[0].price_paise), 79900);
    assert.equal(Number(rows[0].sale_price_paise), 49950);
    assert.equal(Number(rows[0].compare_at_paise), 89900);

    const history = await sql`
      select new_price_paise, price_kind
      from price_history where product_id = ${productId} order by id
    `;
    assert.equal(history.length, 1);
    assert.equal(history[0].price_kind, 'sale');
    assert.equal(Number(history[0].new_price_paise), 49950);

    const equal = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: 79900 },
      'test sale',
      'integration-owner',
    );
    assert.equal(equal.ok, false);
    assert.equal(equal.reason, 'invalid-input');
    assert.match(equal.error, /₹799\.00/);

    const cleared = await updateProductPricingUsing(
      sql,
      productId,
      { salePricePaise: null },
      'test sale',
      'integration-owner',
    );
    assert.equal(cleared.ok, true);
    assert.equal(cleared.data.after.salePricePaise, null);
  } finally {
    try {
      await dropFixtureSchema(sql, schema);
    } catch (error) {
      console.warn('[sale-price-entry] cleanup did not finish:', error?.message ?? error);
    }
    await sql.end({ timeout: 5 });
  }
});

/**
 * The dedicated sale screen.
 *
 * Everything here is either a pure rule (validation, bulk maths, pre-flight,
 * badge label) or a source guard proving the page, the route and the nav entry
 * are wired as designed. The two database writes run against a throwaway
 * schema cloned from the real tables.
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
    // No .env.local; the integration tests stay skipped.
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

const {
  bulkSalePrice,
  parseSalePercent,
  salePreflight,
  saleStatusLabel,
  toLocalDateTimeInput,
  validateSaleSettingsInput,
} = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'sale-admin-rules.ts'),
);
const { applySalePricesUsing, updateSaleSettingsUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'sale.ts'),
);

/* ------------------------------------------------------- settings input */

test('sale settings need a switch and accept optional store-local times', () => {
  const off = validateSaleSettingsInput({ enabled: false, startsAt: null, endsAt: null });
  assert.equal(off.ok, true);
  assert.deepEqual(off.value, { enabled: false, startsAt: null, endsAt: null });

  const window = validateSaleSettingsInput({
    enabled: true,
    startsAt: '2026-10-27T10:00',
    endsAt: '2026-10-28T22:30',
  });
  assert.equal(window.ok, true);
  assert.equal(window.value.startsAt, '2026-10-27T10:00');

  const blank = validateSaleSettingsInput({ enabled: true, startsAt: '', endsAt: '' });
  assert.equal(blank.ok, true);
  assert.equal(blank.value.startsAt, null);
  assert.equal(blank.value.endsAt, null);
});

test('the switch is mandatory and the window must end after it starts', () => {
  assert.equal(validateSaleSettingsInput({ startsAt: null }).ok, false);
  assert.equal(validateSaleSettingsInput(null).ok, false);

  const backwards = validateSaleSettingsInput({
    enabled: true,
    startsAt: '2026-10-28T10:00',
    endsAt: '2026-10-27T10:00',
  });
  assert.equal(backwards.ok, false);
  assert.match(backwards.error, /after/);

  const equal = validateSaleSettingsInput({
    enabled: true,
    startsAt: '2026-10-27T10:00',
    endsAt: '2026-10-27T10:00',
  });
  assert.equal(equal.ok, false);

  const malformed = validateSaleSettingsInput({
    enabled: true,
    startsAt: '27/10/2026 10:00',
    endsAt: null,
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /YYYY-MM-DD/);
});

/* --------------------------------------------------------------- bulk */
test('bulk percent is floored to paise and never writes an unusable price', () => {
  assert.equal(bulkSalePrice(50000, 20), 40000);
  assert.equal(bulkSalePrice(49999, 10), 44999);
  assert.equal(bulkSalePrice(1000, 95), 50);
  assert.equal(bulkSalePrice(1, 95), null);
  assert.equal(bulkSalePrice(0, 10), null);
  assert.equal(bulkSalePrice(50000, 0), null);
  assert.equal(bulkSalePrice(50000, 96), null);
  assert.equal(bulkSalePrice(50000, 10.5), null);
});

test('the percent field only accepts a whole 1–95', () => {
  assert.equal(parseSalePercent(10).value, 10);
  assert.equal(parseSalePercent('25').value, 25);
  assert.equal(parseSalePercent(0).ok, false);
  assert.equal(parseSalePercent(96).ok, false);
  assert.equal(parseSalePercent(12.5).ok, false);
  assert.equal(parseSalePercent('ten').ok, false);
});

/* -------------------------------------------------------- pre-flight */
test('pre-flight reports sale prices on untracked, sold-out and below-cost products', () => {
  const rows = [
    { name: 'Tracked fine', salePricePaise: 900, costPaise: 500, tracked: true, available: 5 },
    { name: 'Untracked', salePricePaise: 900, costPaise: null, tracked: false, available: null },
    { name: 'Sold out', salePricePaise: 900, costPaise: null, tracked: true, available: 0 },
    { name: 'Negative', salePricePaise: 900, costPaise: null, tracked: true, available: -1 },
    { name: 'Below cost', salePricePaise: 100, costPaise: 800, tracked: true, available: 4 },
    { name: 'No sale', salePricePaise: null, costPaise: null, tracked: false, available: null },
  ];
  const result = salePreflight(rows);
  assert.equal(result.withSalePrice, 5);
  assert.deepEqual(result.warnings.map((entry) => entry.key), [
    'tracking-off',
    'zero-stock',
    'below-cost',
  ]);
  assert.equal(result.warnings[0].count, 1);
  assert.equal(result.warnings[0].names[0], 'Untracked');
  assert.equal(result.warnings[1].count, 2);
  assert.equal(result.warnings[2].count, 1);
});

test('pre-flight names at most five products per warning and warns nothing for none', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    name: `P${index}`,
    salePricePaise: 900,
    costPaise: null,
    tracked: false,
    available: null,
  }));
  const result = salePreflight(rows);
  assert.equal(result.warnings[0].count, 8);
  assert.equal(result.warnings[0].names.length, 5);

  const none = salePreflight([
    { name: 'No sale', salePricePaise: null, costPaise: 100, tracked: false, available: null },
  ]);
  assert.equal(none.withSalePrice, 0);
  assert.deepEqual(none.warnings, []);
});

/* -------------------------------------------------------------- labels */
test('the badge label is the same everywhere', () => {
  assert.equal(saleStatusLabel('live'), 'SALE LIVE');
  assert.equal(saleStatusLabel('scheduled'), 'SALE SCHEDULED');
  assert.equal(saleStatusLabel('off'), 'SALE OFF');
});

test('a stored instant renders as the store-local datetime input value', () => {
  assert.equal(
    toLocalDateTimeInput('2026-10-27T04:30:00.000Z', 'Asia/Kolkata'),
    '2026-10-27T10:00',
  );
  assert.equal(toLocalDateTimeInput('2026-10-27T04:30:00.000Z', 'UTC'), '2026-10-27T04:30');
  assert.equal(toLocalDateTimeInput(null, 'Asia/Kolkata'), '');
  assert.equal(toLocalDateTimeInput('not-a-time', 'Asia/Kolkata'), '');
  assert.equal(toLocalDateTimeInput('2026-10-27T04:30:00Z', 'Not/AZone'), '');
});

/* -------------------------------------------------------- source guards */

test('the sale page is a top-level screen with the required controls', async () => {
  const page = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/sale/page.tsx'),
    'utf8',
  );
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /getSaleAdminData\(\)/);
  assert.match(page, /SaleStatusBadge/);
  assert.match(page, /SaleSettingsForm/);
  assert.match(page, /SaleBulkActions/);
  assert.match(page, /Has sale price/);
  assert.match(page, /No sale price/);
  assert.match(page, /Not limited/);
  assert.match(page, /Low or zero stock/);
  assert.match(page, /Option price edits remain disabled pending checkout verification/);
  assert.match(page, /productCount=\{new Set\(products\.map\(\(row\) => row\.id\)\)\.size\}/);
  assert.match(page, /canEdit=\{canEdit && product\.variantId === null\}/);
  // Read access is viewer-or-better; writes are hidden from viewers.
  assert.match(page, /store_viewer/);

  const row = await readFile(
    path.join(root, 'src/components/store-admin/SaleProductRow.tsx'),
    'utf8',
  );
  assert.match(row, /Adjust/);
  assert.match(row, /salePricePaise/);
  assert.match(row, /discountPercent/);

  const shell = await readFile(
    path.join(root, 'src/components/store-admin/StoreAdminShell.tsx'),
    'utf8',
  );
  assert.match(shell, /href: '\/store-admin\/sale'/);
  // The page lives beside Products, not under Settings.
  const settingsBlock = shell.slice(shell.indexOf("label: 'Settings'"));
  assert.ok(!settingsBlock.includes("'/store-admin/sale'"));

  const overview = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/page.tsx'),
    'utf8',
  );
  assert.match(overview, /readSaleState\(\)/);
  assert.match(overview, /SaleStatusBadge/);
  assert.match(overview, /href="\/store-admin\/sale"/);
});

test('every sale write is guarded, same-origin and audited', async () => {
  const route = await readFile(
    path.join(root, 'src/app/api/store-admin/sale/route.ts'),
    'utf8',
  );
  assert.equal(
    (route.match(/requireStoreRole\('store_admin'\)/g) ?? []).length,
    2,
    'both handlers require store_admin',
  );
  assert.equal(
    (route.match(/assertSameOrigin\(request\)/g) ?? []).length,
    2,
    'both handlers reject cross-origin writes',
  );
  assert.match(route, /writeAudit\(/);
  assert.match(route, /action: 'sale\.settings'/);
  assert.match(route, /action: 'sale\.bulk'/);
  assert.match(route, /revalidateCatalog\(\)/);
  assert.match(route, /getStoreTimeZone\(\)/);
});

test('the sale screen uses the dedicated table and the database clock', async () => {
  const server = await readFile(
    path.join(root, 'src/lib/store-admin/sale.ts'),
    'utf8',
  );
  assert.match(server, /update sale_settings/);
  assert.match(server, /::timestamp at time zone/);
  // The status comes from the shared database-clock reader, not a local comparison.
  assert.match(server, /readSaleStateUsing/);
  assert.ok(!/Date\.now\(\)/.test(server), 'the server module must not read the machine clock');

  const page = await readFile(
    path.join(root, 'src/app/(store-admin)/store-admin/(protected)/sale/page.tsx'),
    'utf8',
  );
  assert.ok(!/Date\.now\(\)|new Date\(\)/.test(page), 'the page must not read the machine clock');
});

/* ------------------------------------------------------ database writes */

const TABLES = ['categories', 'products', 'price_history', 'sale_settings'];

/** A fixed instant plus the store-local wall clock for that instant. */
const STORE_TZ = 'Asia/Kolkata';

test('sale settings convert store-local times with the store timezone', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_saleadmin_${suffix}`;
  const sql = client();

  try {
    await createFixtureSchema(sql, schema, TABLES);
    await sql`insert into sale_settings (id) values ('default')`;

    const saved = await updateSaleSettingsUsing(
      sql,
      { enabled: true, startsAt: '2030-10-27T10:00', endsAt: '2030-10-28T22:30' },
      STORE_TZ,
      'integration-owner',
    );
    assert.equal(saved.ok, true);
    assert.equal(saved.data.changed, true);
    assert.equal(saved.data.after.enabled, true);
    // 10:00 IST is 04:30 UTC, whatever the server's own zone is.
    assert.equal(saved.data.after.startsAt, '2030-10-27T04:30:00.000Z');
    assert.equal(saved.data.after.endsAt, '2030-10-28T17:00:00.000Z');
    assert.equal(saved.data.after.status, 'scheduled');

    const stored = await sql`
      select updated_by,
             to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as starts_utc,
             to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as ends_utc
      from sale_settings where id = 'default'
    `;
    assert.equal(stored[0].updated_by, 'integration-owner');
    assert.equal(stored[0].starts_utc, '2030-10-27 04:30:00');
    assert.equal(stored[0].ends_utc, '2030-10-28 17:00:00');

    // No window → the switch alone decides.
    const opened = await updateSaleSettingsUsing(
      sql,
      { enabled: true, startsAt: null, endsAt: null },
      STORE_TZ,
      'integration-owner',
    );
    assert.equal(opened.ok, true);
    assert.equal(opened.data.after.status, 'live');

    // The status uses the database clock: a window that already ended is off.
    const past = await sql`
      select to_char((now() at time zone ${STORE_TZ}) - interval '2 days', 'YYYY-MM-DD"T"HH24:MI') as start,
             to_char((now() at time zone ${STORE_TZ}) - interval '1 day', 'YYYY-MM-DD"T"HH24:MI') as finish
    `;
    const ended = await updateSaleSettingsUsing(
      sql,
      { enabled: true, startsAt: past[0].start, endsAt: past[0].finish },
      STORE_TZ,
      'integration-owner',
    );
    assert.equal(ended.ok, true);
    assert.equal(ended.data.after.status, 'off');

    const closed = await updateSaleSettingsUsing(
      sql,
      { enabled: false, startsAt: null, endsAt: null },
      STORE_TZ,
      'integration-owner',
    );
    assert.equal(closed.ok, true);
    assert.equal(closed.data.after.status, 'off');
    assert.equal(closed.data.changed, true);
  } finally {
    try {
      await dropFixtureSchema(sql, schema);
    } catch (error) {
      console.warn('[sale-admin] cleanup did not finish:', error?.message ?? error);
    }
    await sql.end({ timeout: 5 });
  }
});

test('bulk sale prices write history and clearing marks every row', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_salebulk_${suffix}`;
  const categoryId = `itestcat${suffix}`;
  const ids = {
    a: `itestproda${suffix}`,
    b: `itestprodb${suffix}`,
    c: `itestprodc${suffix}`,
  };
  const sql = client();

  try {
    await createFixtureSchema(sql, schema, TABLES);

    await sql`
      insert into categories (id, slug, name)
      values (${categoryId}, ${categoryId}, 'Sale bulk category')
    `;
    await sql`
      insert into products (id, category_id, slug, name, price_paise)
      values
        (${ids.a}, ${categoryId}, ${ids.a}, 'Product A', 50000),
        (${ids.b}, ${categoryId}, ${ids.b}, 'Product B', 1000),
        (${ids.c}, ${categoryId}, ${ids.c}, 'Product C', 1)
    `;

    const applied = await applySalePricesUsing(sql, { action: 'percent', percent: 20 }, 'integration-owner');
    assert.equal(applied.ok, true);
    assert.equal(applied.data.changed, 2);
    assert.equal(applied.data.skipped, 1, 'the one-paisa product cannot take 20% off');
    assert.equal(applied.data.beforeWithSalePrice, 0);

    let rows = await sql`
      select id, price_paise, sale_price_paise from products order by id
    `;
    assert.equal(Number(rows.find((row) => row.id === ids.a).sale_price_paise), 40000);
    assert.equal(Number(rows.find((row) => row.id === ids.b).sale_price_paise), 800);
    assert.equal(rows.find((row) => row.id === ids.c).sale_price_paise, null);

    let history = await sql`
      select product_id, old_price_paise, new_price_paise, price_kind, reason
      from price_history order by id
    `;
    assert.equal(history.length, 2);
    assert.ok(history.every((row) => row.price_kind === 'sale'));
    assert.ok(history.every((row) => row.reason === 'sale_bulk_percent'));

    // Applying the same percent again changes nothing.
    const again = await applySalePricesUsing(sql, { action: 'percent', percent: 20 }, 'integration-owner');
    assert.equal(again.ok, true);
    assert.equal(again.data.changed, 0);
    assert.equal(again.data.beforeWithSalePrice, 2);

    const cleared = await applySalePricesUsing(sql, { action: 'clear' }, 'integration-owner');
    assert.equal(cleared.ok, true);
    assert.equal(cleared.data.changed, 2);
    assert.equal(cleared.data.beforeWithSalePrice, 2);

    rows = await sql`select sale_price_paise from products`;
    assert.ok(rows.every((row) => row.sale_price_paise === null));

    history = await sql`
      select old_price_paise, new_price_paise, price_kind, reason
      from price_history where price_kind = 'sale_cleared' order by id
    `;
    assert.equal(history.length, 2);
    assert.ok(history.every((row) => row.reason === 'sale_bulk_clear'));
    assert.ok(history.every((row) => Number(row.new_price_paise) === 0));
    assert.ok(history.every((row) => row.old_price_paise !== null));

    // Clearing again is idempotent.
    const clearedAgain = await applySalePricesUsing(sql, { action: 'clear' }, 'integration-owner');
    assert.equal(clearedAgain.ok, true);
    assert.equal(clearedAgain.data.changed, 0);
    assert.equal(clearedAgain.data.beforeWithSalePrice, 0);
  } finally {
    try {
      await dropFixtureSchema(sql, schema);
    } catch (error) {
      console.warn('[sale-admin] cleanup did not finish:', error?.message ?? error);
    }
    await sql.end({ timeout: 5 });
  }
});

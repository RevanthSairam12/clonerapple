/**
 * POS with no fixed price.
 *
 * The cashier types the price charged on every line. These tests pin the
 * rupee-to-paise rule, the free-item and unusual-price confirmations, the
 * database record (charged and reference prices, stock, totals), the role
 * boundary, the two-till race for the last unit, and the screens that must
 * show the charged amount.
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
    // No .env.local; the integration tests stay skipped.
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

const {
  canEnterPosPrice,
  parsePosUnitPrice,
  unconfirmedFreeLines,
  unusualPriceWarning,
  validatePosCart,
  validatePosPrices,
} = await jiti.import(path.join(root, 'src/lib/store-admin/pos-rules.ts'));
const { createPosSaleUsing } = await jiti.import(
  path.join(root, 'src/lib/store-admin/pos.ts'),
);
const { DEFAULT_SETTINGS, fieldsForSection, validateSettingValue } = await jiti.import(
  path.join(root, 'src/lib/store-admin/settings-rules.ts'),
);

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

/* ----------------------------------------------------- entered price */

test('an empty price is not a price, and zero stays a deliberate value', () => {
  assert.deepEqual(parsePosUnitPrice(undefined), { ok: true, paise: null });
  assert.deepEqual(parsePosUnitPrice(null), { ok: true, paise: null });
  assert.deepEqual(parsePosUnitPrice(''), { ok: true, paise: null });
  assert.deepEqual(parsePosUnitPrice(0), { ok: true, paise: 0 });
  assert.deepEqual(parsePosUnitPrice(49950), { ok: true, paise: 49950 });
});

test('the server accepts whole paise only: no decimals, negatives or words', () => {
  assert.equal(parsePosUnitPrice(499.5).ok, false);
  assert.equal(parsePosUnitPrice(-1).ok, false);
  assert.equal(parsePosUnitPrice('free').ok, false);
  assert.equal(parsePosUnitPrice('49950').ok, false);
  assert.match(parsePosUnitPrice(-1).error, /negative/);
  assert.match(parsePosUnitPrice(499.5).error, /whole number of paise/);
  assert.match(parsePosUnitPrice(1_000_000_01).error, /or less/);
});

test('every cart line must carry a price before the cart is valid', () => {
  const cart = validatePosCart([
    { id: 'prod_a', quantity: 2 },
    { id: 'prod_b', quantity: 1 },
  ]);
  assert.equal(cart.ok, true);

  const missing = validatePosPrices(
    [{ id: 'prod_a', quantity: 2 }, { id: 'prod_b', quantity: 1, unitPricePaise: 100 }],
    cart.lines,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Enter the selling price/);

  const valued = validatePosPrices(
    [
      { id: 'prod_a', quantity: 2, unitPricePaise: 49950 },
      { id: 'prod_b', quantity: 1, unitPricePaise: 0 },
    ],
    cart.lines,
  );
  assert.equal(valued.ok, true);
  assert.deepEqual(valued.lines, [
    { id: 'prod_a', quantity: 2, unitPricePaise: 49950 },
    { id: 'prod_b', quantity: 1, unitPricePaise: 0 },
  ]);
});

test('only an admin or owner may enter a selling price', () => {
  assert.equal(canEnterPosPrice('store_owner'), true);
  assert.equal(canEnterPosPrice('store_admin'), true);
  assert.equal(canEnterPosPrice('store_viewer'), false);
  assert.equal(canEnterPosPrice(null), false);
  assert.equal(canEnterPosPrice(undefined), false, 'an unauthenticated caller has no role');
});

test('zero needs an explicit free-item confirmation', () => {
  const lines = [
    { id: 'prod_a', quantity: 1, unitPricePaise: 0 },
    { id: 'prod_b', quantity: 1, unitPricePaise: 100 },
  ];
  assert.equal(unconfirmedFreeLines(lines, undefined).length, 1);
  assert.equal(unconfirmedFreeLines(lines, ['prod_a']).length, 0);
  assert.equal(unconfirmedFreeLines(lines, 'prod_a').length, 1);
});

test('above 10x list or below cost is a confirmation, never a block', () => {
  assert.equal(
    unusualPriceWarning({ unitPricePaise: 79900, regularPricePaise: 79900, costPaise: 60000 }),
    null,
  );
  assert.match(
    unusualPriceWarning({ unitPricePaise: 799001, regularPricePaise: 79900, costPaise: 60000 }),
    /more than 10 times the list price/,
  );
  assert.match(
    unusualPriceWarning({ unitPricePaise: 50000, regularPricePaise: 79900, costPaise: 60000 }),
    /below cost/,
  );
  assert.equal(
    unusualPriceWarning({ unitPricePaise: 50000, regularPricePaise: 79900, costPaise: null }),
    null,
    'without a cost there is nothing to compare',
  );
  assert.equal(
    unusualPriceWarning({ unitPricePaise: 0, regularPricePaise: 79900, costPaise: 60000 }),
    null,
    'free items have their own confirmation',
  );
});

test('the confirmation setting belongs to Orders and defaults on', () => {
  assert.equal(DEFAULT_SETTINGS.pos_confirm_unusual_price, 'on');
  assert.equal(validateSettingValue('pos_confirm_unusual_price', 'off').ok, true);
  assert.equal(validateSettingValue('pos_confirm_unusual_price', 'maybe').value, 'off');
  assert.ok(
    fieldsForSection('orders').some((field) => field.key === 'pos_confirm_unusual_price'),
  );
});

/* ------------------------------------------------------------- screens */

test('the till starts every price box empty and focuses it', async () => {
  const till = await source('src/components/store-admin/PosTill.tsx');
  assert.match(till, /price: '', freeConfirmed: false/);
  assert.match(till, /setFocusId\(product\.id\)/);
  assert.match(till, /inputMode="decimal"/);
  assert.match(till, /Enter the selling price/);
  assert.match(till, /Use list price/);
  assert.match(till, /Confirm this price\?/);
  assert.match(till, /confirmedFreeItemIds/);
  assert.match(till, /parseRupeesToPaise/);
  assert.match(till, /paid \* line\.quantity/);
  assert.doesNotMatch(till, /product\.pricePaise/);
  assert.doesNotMatch(till, /Math\.round\(Number\(/);
});

test('the POS page says the catalogue price is a reference only', async () => {
  const page = await source('src/app/(store-admin)/store-admin/(protected)/pos/page.tsx');
  assert.match(page, /Type the selling price on every line/);
  assert.match(page, /reference only/);
});

test('the server uses the entered price, never the sale resolver', async () => {
  const pos = await source('src/lib/store-admin/pos.ts');
  assert.match(pos, /export async function createPosSaleUsing/);
  assert.match(pos, /canEnterPosPrice\(input\.role\)/);
  assert.match(pos, /validatePosPrices\(input\.lines, cart\.lines\)/);
  assert.match(pos, /unit_price_paise, reference_price_paise/);
  assert.match(pos, /pos_confirm_unusual_price/);
  assert.match(pos, /unusualPriceWarning/);
  assert.doesNotMatch(pos, /resolveEffectivePrice/);
  assert.doesNotMatch(pos, /readSaleStateUsing/);
  assert.doesNotMatch(pos, /readSaleState\(/);
});

test('the sale route is staff-only, same-origin, and audits the entered prices', async () => {
  const route = await source('src/app/api/store-admin/pos/sales/route.ts');
  assert.match(route, /requireStoreRole\('store_admin'\)/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /role: guard\.session\.role/);
  assert.match(route, /confirmedFreeItemIds/);
  assert.match(route, /confirmUnusualPrices/);
  assert.match(route, /action: 'pos\.price_entered'/);
  assert.match(route, /chargedPricePaise: line\.unitPricePaise/);
  assert.match(route, /referencePricePaise: line\.referencePricePaise/);
  // The audit payload has no customer contact values.
  const auditBlock = route.slice(route.indexOf("action: 'pos.price_entered'"));
  assert.doesNotMatch(auditBlock, /customerPhone\s*:|customerName\s*:|customerEmail\s*:/);
});

test('receipt, invoice and order detail show the charged price', async () => {
  const receipt = await source(
    'src/app/(store-admin)/store-admin/(protected)/pos/receipt/[txnid]/page.tsx',
  );
  assert.match(receipt, /line\.unitPricePaise/);
  assert.match(receipt, /line\.lineTotalPaise/);

  const invoice = await source(
    'src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/invoice/page.tsx',
  );
  assert.match(invoice, /item\.unitPricePaise/);
  assert.match(invoice, /item\.referencePricePaise/);

  const detail = await source(
    'src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/page.tsx',
  );
  assert.match(detail, /item\.unitPricePaise/);
  assert.match(detail, /List price at sale/);

  const pos = await source('src/lib/store-admin/pos.ts');
  assert.match(pos, /sum\(amount_paise\)/);
});

test('reports and revenue read the charged totals', async () => {
  const reports = await source('src/lib/store-admin/reports.ts');
  assert.match(reports, /sum\(coalesce\(o\.total_paise, round\(o\.amount \* 100\)::bigint\)\)/);
  assert.match(reports, /sum\(oi\.line_total_paise - oi\.discount_paise\)/);
  const orders = await source('src/lib/store-admin/orders.ts');
  assert.match(orders, /reference_price_paise/);
  assert.match(orders, /unit_price_paise/);
});

test('the migration keeps the reference price on the order line', async () => {
  const migration = await source('migrations/0040_pos_entered_prices.sql');
  assert.match(migration, /add column if not exists reference_price_paise bigint/);
  assert.match(migration, /reference_price_paise >= 0/);
  assert.doesNotMatch(migration, /enable row level security/i);
});

/* --------------------------------------------------------- database */

const TABLES = [
  'products',
  'stock',
  'stock_movements',
  'orders',
  'order_items',
  'order_payments',
  'order_status_history',
  'pos_shifts',
  'receipt_counters',
  'store_settings',
  'sale_settings',
];

async function setupSchema(sql, options = {}) {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_pos_${suffix}`;
  const productId = `itestposprod${suffix}`;
  const costPaise = options.costPaise ?? 30000;
  const regularPaise = options.regularPaise ?? 79900;
  const onHand = options.onHand ?? 10;

  await sql.unsafe(`create schema "${schema}"`);
  for (const table of TABLES) {
    await sql.unsafe(
      `create table "${schema}".${table} (like public.${table} including all)`,
    );
  }
  await sql.unsafe(`set search_path to "${schema}"`);
  await sql`
    insert into receipt_counters (name, next_number) values ('pos_receipt', 1)
  `;
  await sql`
    insert into sale_settings (id, enabled) values ('default', true)
  `;
  await sql`
    insert into products (
      id, category_id, slug, name, price_paise, sale_price_paise, cost_paise
    ) values (
      ${productId}, 'itestcat', ${productId}, 'POS test product',
      ${regularPaise}, 49900, ${costPaise}
    )
  `;
  await sql`
    insert into stock (id, product_id, variant_id, on_hand, track_inventory)
    values (${`stk_${suffix}`}, ${productId}, null, ${onHand}, true)
  `;
  await sql`
    insert into pos_shifts (staff_id, status) values ('staff_test', 'OPEN')
  `;
  return { schema, productId, onHand };
}

async function cleanup(sql, schema) {
  try {
    await sql.unsafe('set search_path to public');
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
  } catch (error) {
    console.warn('[pos-entered-prices] cleanup did not finish:', error?.message ?? error);
  }
}

function saleInput(productId, overrides = {}) {
  return {
    lines: [{ id: productId, quantity: 1, unitPricePaise: 49950 }],
    method: 'cash',
    providerRef: null,
    customerPhone: null,
    staffId: 'staff_test',
    role: 'store_admin',
    ...overrides,
  };
}

test('a typed decimal price is charged exactly and the list price is kept', { skip }, async () => {
  const sql = client();
  let schema = '';
  try {
    const setup = await setupSchema(sql, { onHand: 5 });
    schema = setup.schema;

    const result = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 2, unitPricePaise: 49950 }],
      }),
    );
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    if (!result.ok) return;
    assert.equal(result.data.lines[0].unitPricePaise, 49950);
    assert.equal(result.data.lines[0].referencePricePaise, 79900);
    assert.equal(result.data.lines[0].lineTotalPaise, 99900);
    assert.equal(result.data.totalPaise, 99900, '₹499.50 × 2 = ₹999.00, exactly');

    const orders = await sql`
      select amount, subtotal_paise, total_paise, status
      from orders where id = ${result.data.orderId}
    `;
    assert.equal(Number(orders[0].subtotal_paise), 99900);
    assert.equal(Number(orders[0].total_paise), 99900);
    assert.equal(Number(orders[0].amount), 999);
    assert.equal(orders[0].status, 'PAID');

    const items = await sql`
      select quantity, unit_price_paise, reference_price_paise, line_total_paise
      from order_items where order_id = ${result.data.orderId}
    `;
    assert.equal(Number(items[0].unit_price_paise), 49950);
    assert.equal(Number(items[0].reference_price_paise), 79900);
    assert.equal(Number(items[0].line_total_paise), 99900);

    const payments = await sql`
      select amount_paise, method from order_payments
      where order_id = ${result.data.orderId}
    `;
    assert.equal(Number(payments[0].amount_paise), 99900);
    assert.equal(payments[0].method, 'cash');

    // Sale mode is live and the product has a lower sale price, but the POS
    // price is the one typed. The resolver is never consulted here.
    const products = await sql`
      select price_paise, sale_price_paise from products where id = ${setup.productId}
    `;
    assert.equal(Number(products[0].price_paise), 79900);
    assert.equal(Number(products[0].sale_price_paise), 49900);

    const stock = await sql`
      select on_hand from stock where product_id = ${setup.productId}
    `;
    assert.equal(Number(stock[0].on_hand), 3, 'two units left the shelf');
    const movements = await sql`
      select delta, reason from stock_movements where product_id = ${setup.productId}
    `;
    assert.equal(Number(movements[0].delta), -2);
    assert.equal(movements[0].reason, 'sale');

    const history = await sql`
      select to_status from order_status_history where order_id = ${result.data.orderId}
    `;
    assert.equal(history[0].to_status, 'PAID');
  } finally {
    if (schema) await cleanup(sql, schema);
    await sql.end({ timeout: 5 });
  }
});

test('empty, viewer, negative and unconfirmed free prices are refused', { skip }, async () => {
  const sql = client();
  let schema = '';
  try {
    const setup = await setupSchema(sql, { onHand: 20 });
    schema = setup.schema;

    const empty = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1 }],
      }),
    );
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, 'invalid-input');
    assert.match(empty.error, /Enter the selling price/);

    const viewer = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, { role: 'store_viewer' }),
    );
    assert.equal(viewer.ok, false);
    assert.equal(viewer.reason, 'forbidden');

    const negative = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: -100 }],
      }),
    );
    assert.equal(negative.ok, false);
    assert.equal(negative.reason, 'invalid-input');
    assert.match(negative.error, /negative/);

    const fractional = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 499.5 }],
      }),
    );
    assert.equal(fractional.ok, false);
    assert.equal(fractional.reason, 'invalid-input');

    const freeUnconfirmed = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 0 }],
      }),
    );
    assert.equal(freeUnconfirmed.ok, false);
    assert.equal(freeUnconfirmed.reason, 'invalid-input');
    assert.match(freeUnconfirmed.error, /Confirm the free item/);

    const free = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 0 }],
        confirmedFreeItemIds: [setup.productId],
      }),
    );
    assert.equal(free.ok, true);
    if (!free.ok) return;
    assert.equal(free.data.totalPaise, 0);
    const zeroOrder = await sql`
      select amount, total_paise from orders where id = ${free.data.orderId}
    `;
    assert.equal(Number(zeroOrder[0].amount), 0);
    assert.equal(Number(zeroOrder[0].total_paise), 0);
    const zeroPayments = await sql`
      select count(*)::int as count from order_payments
      where order_id = ${free.data.orderId}
    `;
    assert.equal(zeroPayments[0].count, 0, 'a zero sale has no payment row to store');

    const orders = await sql`select count(*)::int as count from orders`;
    assert.equal(orders[0].count, 1, 'refused attempts wrote nothing');
  } finally {
    if (schema) await cleanup(sql, schema);
    await sql.end({ timeout: 5 });
  }
});

test('the unusual-price confirmation can be accepted or switched off', { skip }, async () => {
  const sql = client();
  let schema = '';
  try {
    const setup = await setupSchema(sql, { onHand: 20, costPaise: 60000 });
    schema = setup.schema;

    const aboveTenTimes = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 799001 }],
      }),
    );
    assert.equal(aboveTenTimes.ok, false);
    assert.equal(aboveTenTimes.reason, 'unusual-price');
    assert.equal(aboveTenTimes.warnings.length, 1);
    assert.match(aboveTenTimes.warnings[0].message, /10 times the list price/);

    const confirmed = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 799001 }],
        confirmUnusualPrices: true,
      }),
    );
    assert.equal(confirmed.ok, true, 'confirmation never blocks a confirmed price');
    if (!confirmed.ok) return;
    assert.equal(confirmed.data.lines[0].unitPricePaise, 799001);

    // Below cost is the other unusual shape.
    const belowCost = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 50000 }],
      }),
    );
    assert.equal(belowCost.ok, false);
    assert.equal(belowCost.reason, 'unusual-price');
    assert.match(belowCost.warnings[0].message, /below cost/);

    await sql`
      insert into store_settings (key, value)
      values ('pos_confirm_unusual_price', 'off')
      on conflict (key) do update set value = excluded.value
    `;
    const settingOff = await createPosSaleUsing(
      sql,
      saleInput(setup.productId, {
        lines: [{ id: setup.productId, quantity: 1, unitPricePaise: 50000 }],
      }),
    );
    assert.equal(settingOff.ok, true, 'the setting removes the prompt, not the price');
    if (!settingOff.ok) return;
    assert.equal(settingOff.data.lines[0].unitPricePaise, 50000);
  } finally {
    if (schema) await cleanup(sql, schema);
    await sql.end({ timeout: 5 });
  }
});

test('two tills racing for the last unit produce exactly one sale', { skip }, async () => {
  const first = client();
  const second = client();
  let schema = '';
  try {
    const setup = await setupSchema(first, { onHand: 1 });
    schema = setup.schema;
    await second.unsafe(`set search_path to "${schema}"`);

    const [a, b] = await Promise.all([
      createPosSaleUsing(first, saleInput(setup.productId)),
      createPosSaleUsing(second, saleInput(setup.productId)),
    ]);

    assert.equal([a, b].filter((result) => result.ok).length, 1);
    const failed = [a, b].find((result) => !result.ok);
    assert.equal(failed.reason, 'out-of-stock');

    const orders = await first`select count(*)::int as count from orders`;
    assert.equal(orders[0].count, 1, 'the losing till wrote no order');
    const stock = await first`
      select on_hand from stock where product_id = ${setup.productId}
    `;
    assert.equal(Number(stock[0].on_hand), 0);
    const movements = await first`
      select count(*)::int as count from stock_movements
      where product_id = ${setup.productId}
    `;
    assert.equal(movements[0].count, 1);
  } finally {
    if (schema) await cleanup(first, schema);
    await first.end({ timeout: 5 });
    await second.end({ timeout: 5 });
  }
});

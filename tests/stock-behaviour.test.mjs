/**
 * Part 5 — availability and price boundaries.
 *
 * Pure rules (who blocks a purchase, how a price change is detected), source
 * guards proving every purchase surface is wired to the same rule, and a
 * throwaway-schema read of the click-time availability query. The stock race
 * and lazy-expiry behaviour at Pay are already proven end to end by
 * `order-stock-integration.test.mjs` and `flash-sale-reservation-integration`.
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
import { paymentConnection, resolveCartItemsFromDbUsing } from './helpers/payment-catalog-fixture.mjs';

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
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: { search_path: 'pg_catalog' },
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { stockBlocked, STOCK_NOT_AVAILABLE, toPublicAvailability } = await jiti.import(
  path.join(root, 'src/lib/storefront/availability-rules.ts'),
);
const { priceCartLines } = await jiti.import(
  path.join(root, 'src/lib/payu/db-pricing.ts'),
);
const { planStockClaim } = await jiti.import(
  path.join(root, 'src/lib/checkout/stock-rules.ts'),
);
const { readAvailabilityUsing } = await jiti.import(
  path.join(root, 'src/lib/storefront/availability-server.ts'),
);

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

/* ------------------------------------------------------------- pure rules */

test('normal mode blocks an unavailable product; sale mode never does', () => {
  assert.equal(stockBlocked(false, false), true, 'normal + no stock blocks');
  assert.equal(stockBlocked(true, false), false);
  assert.equal(stockBlocked(false, true), false, 'a live sale ignores stock in the UI');
  assert.equal(stockBlocked(true, true), false);
  assert.equal(STOCK_NOT_AVAILABLE, 'Stock not available');
});

test('the public availability payload carries no quantities — only inStock and low', () => {
  const read = {
    saleLive: true,
    databaseNow: '2026-10-28T00:00:00.000Z',
    products: [
      { id: 'plenty', inStock: true, tracked: true, available: 9, lowStockThreshold: 2 },
      { id: 'low', inStock: true, tracked: true, available: 2, lowStockThreshold: 2 },
      { id: 'empty', inStock: false, tracked: true, available: 0, lowStockThreshold: 2 },
      { id: 'gated', inStock: false, tracked: true, available: 3, lowStockThreshold: 5 },
      { id: 'untracked', inStock: true, tracked: false, available: null, lowStockThreshold: null },
    ],
  };

  const published = toPublicAvailability(read);

  assert.equal(published.saleLive, true);
  assert.deepEqual(published.products, [
    { id: 'plenty', inStock: true, low: false },
    { id: 'low', inStock: true, low: true },
    { id: 'empty', inStock: false, low: false },
    { id: 'gated', inStock: false, low: false },
    { id: 'untracked', inStock: true, low: false },
  ]);
  for (const product of published.products) {
    assert.deepEqual(Object.keys(product).sort(), ['id', 'inStock', 'low']);
  }
  const wire = JSON.stringify(published);
  for (const secret of ['available', 'onHand', 'reserved', 'threshold', 'databaseNow']) {
    assert.equal(wire.includes(secret), false, `${secret} must not reach the public payload`);
  }
  assert.equal(wire.includes('"tracked"'), false, 'tracked must not reach the public payload');
});

test('a changed unit price is reported without changing what is charged', () => {
  const rows = [
    {
      id: 'case-a',
      name: 'Silicone Case',
      subtitle: 'Black',
      price_paise: 129900,
      regular_price_paise: 149900,
      image_url: null,
    },
  ];

  const unchanged = priceCartLines(
    [{ id: 'case-a', quantity: 2, expectedUnitPaise: 129900 }],
    rows,
  );
  assert.deepEqual(unchanged.priceChanges, []);
  assert.equal(unchanged.totalPaise, 259800);
  assert.equal(unchanged.items[0].unitPaise, 129900);
  assert.equal(unchanged.items[0].regularPricePaise, 149900);

  // The customer saw the pre-sale price; the sale started. The server price
  // wins, and the mismatch is reported so checkout can ask them to review.
  const saleStarted = priceCartLines(
    [{ id: 'case-a', quantity: 1, expectedUnitPaise: 149900 }],
    rows,
  );
  assert.equal(saleStarted.totalPaise, 129900);
  assert.deepEqual(saleStarted.priceChanges, [
    { id: 'case-a', name: 'Silicone Case - Black', expectedPaise: 149900, actualPaise: 129900 },
  ]);

  // The sale ended between the bag and Pay: the customer saw the sale price,
  // the resolver now returns the regular price, and the difference is a 409.
  const saleEnded = priceCartLines(
    [{ id: 'case-a', quantity: 1, expectedUnitPaise: 129900 }],
    [{ ...rows[0], price_paise: 149900, regular_price_paise: null }],
  );
  assert.equal(saleEnded.totalPaise, 149900, 'the database price is what would be charged');
  assert.equal(saleEnded.priceChanges.length, 1);
  assert.equal(saleEnded.priceChanges[0].actualPaise, 149900);

  // No expectation (old client, or an API caller) is not a conflict.
  const noExpectation = priceCartLines([{ id: 'case-a', quantity: 1 }], rows);
  assert.deepEqual(noExpectation.priceChanges, []);
});

test('the last unit produces one order; the loser hears how many are left', () => {
  const line = (quantity) => ({ productId: 'p1', quantity, productName: 'Silicone Case' });
  const row = { product_id: 'p1', on_hand: 1, reserved: 0, track_inventory: true };

  assert.equal(planStockClaim([line(1)], [row]).ok, true);
  assert.equal(planStockClaim([line(2)], [row]).ok, false);

  const short = planStockClaim([line(2)], [row]);
  assert.equal(short.ok, false);
  assert.match(short.error, /Only 1 left of Silicone Case/);

  const none = planStockClaim([line(1)], [{ ...row, on_hand: 0 }]);
  assert.equal(none.ok, false);
  assert.match(none.error, /Out of stock: Silicone Case/);
});

/**
 * Sale mode is a display decision. Pay must keep the ordinary stock rules, or
 * two buyers could both be sold the last unit during a sale.
 */
test('sale state never reaches the server-side stock claim', async () => {
  const [stock, stockRules, orders] = await Promise.all([
    source('src/lib/payu/stock.ts'),
    source('src/lib/checkout/stock-rules.ts'),
    source('src/lib/payu/orders.ts'),
  ]);

  for (const [name, text] of [
    ['stock.ts', stock],
    ['stock-rules.ts', stockRules],
    ['orders.ts', orders],
  ]) {
    assert.ok(!/sale_settings|readSaleState|saleLive/.test(text), `${name} must not consult sale state`);
  }
  assert.match(orders, /for update/);
  assert.match(stock, /on_hand - reserved >= \$\{claim.quantity\}/);
});

/* ---------------------------------------------------------- source guards */

test('the click-time endpoint is same-origin, rate-limited and never cached', async () => {
  const route = await source('src/app/api/catalog/availability/route.ts');
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /checkRateLimit\(`catalog-availability:/);
  assert.match(route, /limit: 60/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /readAvailabilityUsing\(sql, ids, lines\)/);
  assert.match(route, /Number\.isSafeInteger\(line.quantity\)/);
  assert.match(route, /line.variantId/);
  // The raw read carries counts; the endpoint may only publish the projection.
  assert.match(route, /toPublicAvailability\(availability\)/);
  assert.doesNotMatch(route, /NextResponse\.json\(availability,/);
  assert.match(route, /status: 429/);
  assert.match(route, /status: 503/);
  assert.match(route, /MAX_IDS = 50/);
});

test('detail pages render the shared rule and re-check on click', async () => {
  const pages = [
    'src/components/shop/ProductDetailPage.tsx',
    'src/components/sites/accessories/AccessoryDetailPage.tsx',
  ];
  for (const file of pages) {
    const text = await source(file);
    assert.match(text, /useAvailability\(/, `${file} uses the hook`);
    assert.match(text, /const unavailable = availability\.blocked/);
    assert.match(text, /await verifySelections\(/, `${file} checks fresh exact selections before Buy Now`);
    assert.match(text, /purchase\.run\(async \(signal\) =>/, `${file} runs Add through the purchase action`);
    assert.match(text, /await addItem\(\{/, `${file} delegates Add to authoritative cart validation`);
    assert.match(text, /disabled=\{isAddingToBag \|\| unavailable\}/, `${file} disables both buttons`);
    assert.match(text, /\{unavailable \? STOCK_NOT_AVAILABLE :/, `${file} labels the block`);
  }

  const productPage = await source('src/app/shop/product/[productId]/page.tsx');
  assert.match(productPage, /readSaleState\(\)/);
  assert.match(productPage, /saleLive=\{sale\.live\}/);
  assert.match(productPage, /inStock=\{detail\.stock\.inStock\}/);

  const hook = await source('src/lib/storefront/use-availability.ts');
  assert.match(hook, /\/api\/catalog\/availability\?lines=/);
  assert.match(hook, /variantId, quantity/);
  assert.match(hook, /row\?\.quantityAvailable === true/);
  for (const file of pages) {
    const text = await source(file);
    assert.match(text, /handleBuyNow/);
    assert.match(text, /checked\.status !== 'ready'/);
    assert.match(text, /variantId: selectedVariant\?\.id, quantity: 1/);
  }
  assert.match(hook, /cache: 'no-store'/);
  assert.match(hook, /return null/, 'a failed check keeps the last known state');
});

test('bag, checkout and listings all use the shared stock rule', async () => {
  const cart = await source('src/components/cart/CartPageView.tsx');
  assert.match(cart, /stockBlocked\(/);
  assert.match(cart, /lineAvailable/);
  assert.match(cart, /saleLive: boolean/);

  const cartPage = await source('src/app/cart/page.tsx');
  assert.match(cartPage, /saleLive=\{saleLive\}/);
  const bagPage = await source('src/app/bag/page.tsx');
  assert.match(bagPage, /saleLive=\{saleLive\}/);

  const checkout = await source('src/components/checkout/CheckoutForm.tsx');
  assert.match(checkout, /priceCartLines\(sourceItems, products, saleLive\)/);
  assert.match(checkout, /item\.available/);
  assert.match(checkout, /expectedUnitPaise: i\.unitPaise/);
  assert.match(checkout, /data\.code === 'price_changed'/);
  assert.match(checkout, /syncPrices\(updates\)/);
  for (const attribute of ['disabled', 'aria-disabled']) {
    const payButton = checkout.slice(checkout.indexOf('id="checkout-pay-now-btn"'));
    const expression = payButton.match(new RegExp(`${attribute}=\\{([^}]+)\\}`))?.[1];
    assert.ok(expression, `${attribute} exists`);
    for (const blocker of ['isSubmitting', 'Boolean(activeReservation)', 'Boolean(selectionConflict)', 'hasUnavailable', 'paymentUnavailable', 'coupon.busy']) {
      assert.ok(expression.split(' || ').includes(blocker), `${attribute} independently includes ${blocker}`);
    }
  }

  const checkoutPage = await source('src/app/checkout/page.tsx');
  assert.match(checkoutPage, /stockById\[product\.id\.trim\(\)\.toLowerCase\(\)\] = product\.inStock/);
  assert.match(checkoutPage, /saleLive=\{saleLive\}/);

  for (const file of [
    'src/components/collection/CollectionProductCard.tsx',
    'src/components/collection/CollectionFeaturedTile.tsx',
  ]) {
    const text = await source(file);
    assert.match(text, /!saleLive && product\.inStock === false/, `${file} respects a live sale`);
  }
  assert.match(
    await source('src/components/search/SearchPageView.tsx'),
    /saleLive \|\| item\.inStock !== false/,
  );
});

test('initiate rejects a price boundary crossing and names an out-of-stock item', async () => {
  const route = await source('src/app/api/payu/initiate/route.ts');
  // The initiate route delegates authoritative price checks to createOrder,
  // which rejects unit-price changes through TotalChangedError.
  assert.match(route, /createOrder\(/);
  assert.match(route, /error instanceof TotalChangedError/);
  assert.match(route, /code: 'price_changed'/);
  const totalChanged = await source('src/lib/coupons/errors.ts');
  assert.match(totalChanged, /Prices have changed, please review your cart\./);
  assert.match(route, /code: 'out_of_stock'/);

  const stock = await source('src/lib/payu/stock.ts');
  assert.match(stock, /throw new InsufficientStockError\(`Out of stock:/);
  assert.match(stock, /claim\.productName/, 'guarded stock refusal still identifies the selected product');
  assert.match(stock, /variant_id is not distinct from \$\{claim\.variantId \|\| null\}/, 'the final guard checks the exact selected stock identity');

  const context = await source('src/lib/cart/CartContext.tsx');
  assert.match(context, /syncPrices: \(updates: CartPriceUpdate\[\]\) => void/);
});

test('normal-mode availability fails closed in the payment resolver', async () => {
  const parent = { id: 'cable', name: 'Cable', inventory_mode: 'product', price_paise: 10000, in_stock: false };
  const lines = [{ id: 'cable', quantity: 1 }];
  for (const track_inventory of [null, undefined, false]) {
    const rows = [{ ...parent, track_inventory }];
    await assert.rejects(resolveCartItemsFromDbUsing(paymentConnection({ expired: true, rows }).sql, lines),
      error => error.name === 'InsufficientStockError' && /Out of stock: Cable/.test(error.message));
    const saleCart = await resolveCartItemsFromDbUsing(paymentConnection({ rows }).sql, lines);
    assert.equal(saleCart.totalPaise, 10000, 'a live sale defers tracked stock to the final claim');
    const availableRows = [{ ...parent, track_inventory, in_stock: true }];
    assert.equal((await resolveCartItemsFromDbUsing(paymentConnection({ expired: true, rows: availableRows }).sql, lines)).totalPaise, 10000);
  }
  const trackedRows = [{ ...parent, track_inventory: true }];
  assert.equal((await resolveCartItemsFromDbUsing(paymentConnection({ expired: true, rows: trackedRows }).sql, lines)).totalPaise, 10000);
  const exactRows = [{ ...parent, inventory_mode: 'variant', variant_id: 'exact', track_inventory: true }];
  const exactCart = await resolveCartItemsFromDbUsing(paymentConnection({ expired: true, rows: exactRows }).sql, [{ ...lines[0], variantId: 'exact' }]);
  assert.equal(exactCart.items[0].variantId, 'exact', 'an exact variant is not blocked by the legacy parent flag');
  // The injected rows prove resolver behavior. The final claim must still
  // target the exact identity and remain independent of the display sale switch.
  const stock = await source('src/lib/payu/stock.ts');
  assert.match(stock, /variant_id is not distinct from \$\{claim\.variantId \|\| null\}/);
  assert.doesNotMatch(stock, /saleLive/);
});

test('sale state is read once per request and falls back to off', async () => {
  const refs = await source('src/lib/storefront/catalog.ts');
  assert.match(refs, /readSaleState\(\)/);
  assert.match(refs, /saleLive: sale\.live/);

  const sale = await source('src/lib/storefront/sale-state.ts');
  assert.match(sale, /catch \{/);
  assert.match(sale, /return \{ \.\.\.SALE_OFF \}/);
  assert.match(sale, /unreadable: true/);
});

/* ---------------------------------------------------- database behaviour */

const TABLES = [
  'categories', 'products', 'stock', 'sale_settings', 'product_variants',
  'product_types', 'product_device_models', 'device_models', 'device_brands',
];

test('click-time availability reads stock and the sale switch on one clock', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_availability_${suffix}`;
  const sql = client();

  try {
    await createFixtureSchema(sql, schema, TABLES);

    await sql`insert into sale_settings (id) values ('default')`;
    await sql`
      insert into categories (id, slug, name)
      values ('c1', 'c1', 'Integration category')
    `;
    for (const [id, active] of [['tracked', true], ['empty', true], ['untracked', true], ['retired', false]]) {
      await sql`
        insert into products (id, category_id, slug, name, price_paise, is_active, in_stock)
        values (${id}, 'c1', ${id}, ${id}, 50000, ${active}, true)
      `;
    }
    await sql`
      insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold)
      values ('s1', 'tracked', null, 5, 2, true, 2),
             ('s2', 'empty', null, 0, 0, true, 1)
    `;

    // A window that contains the database's own clock is live.
    await sql`
      update sale_settings
      set enabled = true,
          starts_at = now() - interval '1 hour',
          ends_at = now() + interval '1 hour'
      where id = 'default'
    `;

    const live = await readAvailabilityUsing(sql, ['tracked', 'empty', 'untracked', 'retired', 'missing']);
    assert.equal(live.saleLive, true);
    assert.ok(Number.isFinite(Date.parse(live.databaseNow)));

    const byId = new Map(live.products.map((product) => [product.id, product]));
    assert.equal(byId.get('tracked').available, 3, 'on_hand minus reserved');
    assert.equal(byId.get('tracked').inStock, true);
    assert.equal(byId.get('tracked').tracked, true);
    assert.equal(byId.get('empty').available, 0);
    assert.equal(byId.get('empty').inStock, false);
    assert.equal(byId.get('untracked').tracked, false, 'no stock row is untracked');
    assert.equal(byId.get('untracked').available, null);
    assert.equal(byId.get('untracked').inStock, true);

    // Untracked availability is the product flag, and clearing it blocks.
    await sql`update products set in_stock = false where id = 'untracked'`;
    const hidden = await readAvailabilityUsing(sql, ['untracked']);
    assert.equal(hidden.products[0].inStock, false, 'in_stock=false is unavailable');
    await sql`update products set in_stock = true where id = 'untracked'`;
    assert.equal(byId.get('retired').inStock, false, 'an inactive row is never sellable');
    assert.equal(byId.get('missing').inStock, false, 'a missing row is reported, not dropped');

    // Same rows, sale off: stock still decides in normal mode.
    await sql`update sale_settings set enabled = false where id = 'default'`;
    const off = await readAvailabilityUsing(sql, ['tracked', 'empty']);
    assert.equal(off.saleLive, false);
    assert.equal(off.products.find((product) => product.id === 'empty').inStock, false);

    // A window that has already ended is off, decided by the database clock.
    await sql`
      update sale_settings
      set enabled = true,
          starts_at = now() - interval '2 days',
          ends_at = now() - interval '1 day'
      where id = 'default'
    `;
    const ended = await readAvailabilityUsing(sql, ['tracked']);
    assert.equal(ended.saleLive, false);
  } finally {
    try {
      await dropFixtureSchema(sql, schema);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
});

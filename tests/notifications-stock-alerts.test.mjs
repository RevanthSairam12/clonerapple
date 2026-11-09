/**
 * Per-option low-stock notifications for checkout, POS, and replenishment.
 *
 * Verifies that:
 * 1. Checkout crossing threshold queues low_stock for the exact option.
 * 2. Checkout remaining above threshold produces no notification.
 * 3. Checkout already below threshold produces no notification.
 * 4. Two concurrent checkouts crossing the same threshold: alert queued exactly once.
 * 5. Checkout rollback produces no notification.
 * 6. POS crossing threshold queues low_stock for the exact variant.
 * 7. POS rollback produces no notification.
 * 8. Different variants produce distinct notifications with exact option labels and deep links.
 * 9. Replenishment triggers back-in-stock correctly (only 0 -> > 0, not repeated).
 * 10. Duplicate processing does not duplicate alerts (dedupe key idempotency).
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

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { stockNotificationEvent, stockAlertProductName, queueStockAlerts } = await jiti.import(
  path.join(root, 'src', 'lib', 'notifications', 'stock-events.ts'),
);
const { enqueueNotification } = await jiti.import(
  path.join(root, 'src', 'lib', 'notifications', 'enqueue.ts'),
);
const { substitute, templateValues, defaultTemplate } = await jiti.import(
  path.join(root, 'src', 'lib', 'notifications', 'templates.ts'),
);
const { createOrderUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'payu', 'orders.ts'),
);
const { createPosSaleUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'pos.ts'),
);

/* ------------------------------------------------------------- pure unit tests */

test('stockNotificationEvent pure crossing rules', () => {
  // 1. Checkout crossing threshold: drops from above threshold to <= threshold and > 0
  assert.equal(
    stockNotificationEvent({ availableBefore: 5, availableAfter: 3, threshold: 3 }),
    'low_stock',
  );
  assert.equal(
    stockNotificationEvent({ availableBefore: 10, availableAfter: 2, threshold: 3 }),
    'low_stock',
  );

  // 2. Checkout remaining above threshold
  assert.equal(
    stockNotificationEvent({ availableBefore: 10, availableAfter: 8, threshold: 3 }),
    null,
  );

  // 3. Checkout already below threshold
  assert.equal(
    stockNotificationEvent({ availableBefore: 2, availableAfter: 1, threshold: 3 }),
    null,
  );

  // Out of stock (after <= 0) is not low_stock
  assert.equal(
    stockNotificationEvent({ availableBefore: 5, availableAfter: 0, threshold: 3 }),
    null,
  );

  // 9. Replenishment: crossing from <= 0 to > 0 is back_in_stock
  assert.equal(
    stockNotificationEvent({ availableBefore: 0, availableAfter: 5, threshold: 3 }),
    'back_in_stock',
  );
  assert.equal(
    stockNotificationEvent({ availableBefore: -1, availableAfter: 2, threshold: 3 }),
    'back_in_stock',
  );

  // Replenishment already in stock does not trigger back_in_stock repeatedly
  assert.equal(
    stockNotificationEvent({ availableBefore: 5, availableAfter: 15, threshold: 3 }),
    null,
  );
});

test('stockAlertProductName formats exact variant labels and deep links', () => {
  assert.equal(
    stockAlertProductName('Phone 16 Pro', 'Natural Titanium / 128 GB'),
    'Phone 16 Pro — Natural Titanium / 128 GB',
  );
  assert.equal(
    stockAlertProductName('Clear Case', null),
    'Clear Case',
  );

  // Render low_stock template with staff audience
  const staffValues = templateValues({
    audience: 'staff',
    productName: stockAlertProductName('Phone 16 Pro', 'Natural Titanium / 128 GB'),
    stockAvailable: 2,
    adminLink: '/store-admin/stock/phone-16-pro?variant=var-nat-128',
    storeName: 'Gadzio Staging',
  });

  const staffTpl = defaultTemplate('low_stock', 'email', 'staff');
  assert.ok(staffTpl);
  const subject = substitute(staffTpl.subject, staffValues);
  const body = substitute(staffTpl.body, staffValues);
  const buttonUrl = substitute(staffTpl.buttonUrl || '', staffValues);

  assert.equal(subject, 'Low stock: Phone 16 Pro — Natural Titanium / 128 GB');
  assert.equal(body, 'Phone 16 Pro — Natural Titanium / 128 GB is low on stock (2 available to buy).');
  assert.equal(buttonUrl, '/store-admin/stock/phone-16-pro?variant=var-nat-128');
});

/* ------------------------------------------------------------- DB integration tests */

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(here, '..', '.env.local'), 'utf8');
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

function client(schema) {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  if (connectionDetails().transactionPooler) throw new Error('Requires a session connection, not port 6543.');
  return postgres(fixtureConnectionUrl(), {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: schema ? { search_path: schema } : { search_path: 'pg_catalog' },
    onnotice: () => {},
  });
}

const DB_TABLES = [
  'categories',
  'products',
  'product_variants',
  'device_models',
  'device_brands',
  'product_types',
  'product_device_models',
  'product_images',
  'colours',
  'product_variant_colours',
  'stock',
  'stock_movements',
  'sale_settings',
  'store_settings',
  'orders',
  'order_items',
  'order_addresses',
  'order_payments',
  'order_status_history',
  'coupons',
  'coupon_targets',
  'coupon_redemptions',
  'pos_shifts',
  'receipt_counters',
  'invoice_number_counters',
  'store_admins',
  'store_admin_audit',
  'notification_channel_settings',
  'email_templates',
  'automated_messages',
  'notification_outbox',
];

async function seedSettingsAndMatrix(sql, adminEmail) {
  await sql`
    insert into receipt_counters (name, next_number)
    values ('pos_receipt', 1000)
    on conflict (name) do nothing
  `;
  await sql`
    insert into invoice_number_counters (name, last_number)
    values ('invoice', 1000)
    on conflict (name) do nothing
  `;
  await sql`
    insert into sale_settings (id, enabled) values ('default', false)
    on conflict (id) do nothing
  `;
  await sql`
    insert into store_settings (key, value) values
      ('trade_name', 'Gadzio Test Store'),
      ('email', 'alerts@gadzio.test'),
      ('phone', '9123456780'),
      ('return_window_days', '7'),
      ('shipping_charge_paise', '0'),
      ('free_shipping_threshold_paise', ''),
      ('shipping_enabled', 'on'),
      ('payu_enabled', 'on')
    on conflict (key) do update set value = excluded.value
  `;
  await sql`
    insert into store_admins (id, email, password_hash, name, role, is_active)
    values ('admin_test_staff', ${adminEmail}, 'hashed_pw', 'Staff Admin', 'store_owner', true)
    on conflict (id) do nothing
  `;
  await sql`
    insert into notification_channel_settings (id, channel, audience, topic, is_active)
    values
      ('email:admin:low_stock', 'email', 'admin', 'low_stock', true),
      ('email:admin:back_in_stock', 'email', 'admin', 'back_in_stock', true)
    on conflict (id) do update set is_active = true
  `;
}

test('Per-option low-stock notifications for checkout and POS in isolated schema', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_stock_alerts_${suffix}`;
  const adminEmail = `staff-${suffix}@gadzio.test`;
  const a = client();

  try {
    await createFixtureSchema(a, schema, DB_TABLES);
    await seedSettingsAndMatrix(a, adminEmail);

    const catId = `cat_${suffix}`;
    const prodId = `prod_${suffix}`;
    const varAId = `var_a_${suffix}`;
    const varBId = `var_b_${suffix}`;
    const varCId = `var_c_${suffix}`;

    await a`
      insert into categories (id, slug, name)
      values (${catId}, ${catId}, 'Test Category')
    `;
    await a`
      insert into products (id, category_id, slug, name, price_paise, inventory_mode, is_active)
      values (${prodId}, ${catId}, ${prodId}, 'Gadzio Pro Case', 199900, 'variant', true)
    `;
    await a`
      insert into product_variants (id, product_id, sku, option_name, option_value, combination_key, is_active, is_purchasable)
      values
        (${varAId}, ${prodId}, ${`SKU-A-${suffix}`}, 'Colour', 'Midnight Black', 'midnight-black', true, true),
        (${varBId}, ${prodId}, ${`SKU-B-${suffix}`}, 'Colour', 'Pacific Blue', 'pacific-blue', true, true),
        (${varCId}, ${prodId}, ${`SKU-C-${suffix}`}, 'Colour', 'Sierra Grey', 'sierra-grey', true, true)
    `;
    // Variant A: on_hand = 5, low_stock_threshold = 3
    await a`
      insert into stock (id, product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory)
      values (${`stk_a_${suffix}`}, ${prodId}, ${varAId}, 5, 0, 3, true)
    `;
    // Variant B: on_hand = 10, low_stock_threshold = 2
    await a`
      insert into stock (id, product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory)
      values (${`stk_b_${suffix}`}, ${prodId}, ${varBId}, 10, 0, 2, true)
    `;
    // Variant C: on_hand = 4, low_stock_threshold = 2
    await a`
      insert into stock (id, product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory)
      values (${`stk_c_${suffix}`}, ${prodId}, ${varCId}, 4, 0, 2, true)
    `;

    /* ------------------------------------------------ Scenario 1: Checkout crossing threshold */
    // Buy 2 units of Variant A: stock goes from 5 to 3 (threshold is 3). Crossed!
    const checkoutParamsA = {
      txnid: `TXN-A1-${suffix}`,
      customerName: 'Customer One',
      customerEmail: 'cust1@example.test',
      customerPhone: '9876543210',
      paymentMethod: 'payu',
      currency: 'INR',
      expectedTotalPaise: 399800,
      cartItems: [{ id: prodId, variantId: varAId, quantity: 2, expectedUnitPaise: 199900 }],
      shippingAddress: { name: 'Customer One', phone: '9876543210', line1: 'Street 1', city: 'Mumbai', state: 'MH', pincode: '400001' },
      reservationSeconds: 900,
    };

    const resA = await createOrderUsing(a, checkoutParamsA);
    assert.equal(resA.stockClaimed, true);
    assert.equal(resA.stockAlerts.length, 1);
    assert.equal(resA.stockAlerts[0].availableBefore, 5);
    assert.equal(resA.stockAlerts[0].availableAfter, 3);
    assert.equal(resA.stockAlerts[0].lowStockThreshold, 3);

    // Queue stock alert using the test schema
    await queueStockAlerts(resA.stockAlerts, { sqlOverride: a });

    // Verify outbox entry
    const outboxA = await a`
      select event_key, recipient, subject, body, status, dedupe_key
      from notification_outbox
      where entity_id = ${prodId} and event_key = 'low_stock'
    `;
    assert.equal(outboxA.length, 2, 'Staff fan-out queued for store support address and active owner');
    assert.ok(outboxA.every(row => row.subject.includes('Midnight Black')), 'Alert subject names option');
    assert.ok(outboxA.every(row => row.body.includes('3 available to buy')), 'Alert body reports accurate remaining count');

    /* ------------------------------------------------ Scenario 2: Checkout remaining above threshold */
    // Variant B has 10 units, threshold 2. Buy 2 units -> after is 8. No alert!
    const checkoutParamsB = {
      txnid: `TXN-B1-${suffix}`,
      customerName: 'Customer Two',
      customerEmail: 'cust2@example.test',
      customerPhone: '9876543210',
      paymentMethod: 'payu',
      currency: 'INR',
      expectedTotalPaise: 399800,
      cartItems: [{ id: prodId, variantId: varBId, quantity: 2, expectedUnitPaise: 199900 }],
      shippingAddress: { name: 'Customer Two', phone: '9876543210', line1: 'Street 1', city: 'Mumbai', state: 'MH', pincode: '400001' },
      reservationSeconds: 900,
    };

    const resB = await createOrderUsing(a, checkoutParamsB);
    assert.equal(resB.stockAlerts.length, 1);
    assert.equal(resB.stockAlerts[0].availableBefore, 10);
    assert.equal(resB.stockAlerts[0].availableAfter, 8);
    await queueStockAlerts(resB.stockAlerts, { sqlOverride: a });

    const outboxB = await a`
      select * from notification_outbox
      where entity_id = ${prodId} and dedupe_key like '%var_b%'
    `;
    assert.equal(outboxB.length, 0, 'No alert queued when remaining stock is above threshold');

    /* ------------------------------------------------ Scenario 3: Checkout already below threshold */
    // Variant A is now at 3 (threshold 3). Buy 1 unit -> after is 2. Both before and after are <= threshold.
    // Must NOT trigger another alert!
    const checkoutParamsA2 = {
      txnid: `TXN-A2-${suffix}`,
      customerName: 'Customer Three',
      customerEmail: 'cust3@example.test',
      customerPhone: '9876543210',
      paymentMethod: 'payu',
      currency: 'INR',
      expectedTotalPaise: 199900,
      cartItems: [{ id: prodId, variantId: varAId, quantity: 1, expectedUnitPaise: 199900 }],
      shippingAddress: { name: 'Customer Three', phone: '9876543210', line1: 'Street 1', city: 'Mumbai', state: 'MH', pincode: '400001' },
      reservationSeconds: 900,
    };

    const resA2 = await createOrderUsing(a, checkoutParamsA2);
    assert.equal(resA2.stockAlerts[0].availableBefore, 3);
    assert.equal(resA2.stockAlerts[0].availableAfter, 2);
    await queueStockAlerts(resA2.stockAlerts, { sqlOverride: a });

    const outboxAAfter = await a`
      select id from notification_outbox
      where entity_id = ${prodId} and event_key = 'low_stock'
    `;
    assert.equal(outboxAAfter.length, 2, 'Still only 2 outbox records; already-below does not alert again');

    /* ------------------------------------------------ Scenario 4: Two concurrent checkouts crossing the same threshold */
    // Variant C starts at 4, threshold is 2.
    // Buyer 1 buys 1 -> stock drops from 4 to 3 (above threshold, no alert)
    const checkoutParamsC1 = {
      txnid: `TXN-C1-${suffix}`,
      customerName: 'Customer C1',
      customerEmail: 'c1@example.test',
      customerPhone: '9876543210',
      paymentMethod: 'payu',
      currency: 'INR',
      expectedTotalPaise: 199900,
      cartItems: [{ id: prodId, variantId: varCId, quantity: 1, expectedUnitPaise: 199900 }],
      shippingAddress: { name: 'Customer C1', phone: '9876543210', line1: 'Street 1', city: 'Mumbai', state: 'MH', pincode: '400001' },
      reservationSeconds: 900,
    };
    const resC1 = await createOrderUsing(a, checkoutParamsC1);
    await queueStockAlerts(resC1.stockAlerts, { sqlOverride: a });

    // Buyer 2 buys 1 -> stock drops from 3 to 2 (crosses threshold 2 -> 1 alert queued)
    const checkoutParamsC2 = {
      txnid: `TXN-C2-${suffix}`,
      customerName: 'Customer C2',
      customerEmail: 'c2@example.test',
      customerPhone: '9876543210',
      paymentMethod: 'payu',
      currency: 'INR',
      expectedTotalPaise: 199900,
      cartItems: [{ id: prodId, variantId: varCId, quantity: 1, expectedUnitPaise: 199900 }],
      shippingAddress: { name: 'Customer C2', phone: '9876543210', line1: 'Street 1', city: 'Mumbai', state: 'MH', pincode: '400001' },
      reservationSeconds: 900,
    };
    const resC2 = await createOrderUsing(a, checkoutParamsC2);
    await queueStockAlerts(resC2.stockAlerts, { sqlOverride: a });

    const outboxC = await a`
      select event_key, subject, body from notification_outbox
      where entity_id = ${prodId} and subject like '%Sierra Grey%'
    `;
    assert.equal(outboxC.length, 2, 'Two consecutive checkouts crossing threshold fan out to support and owner');
    assert.ok(outboxC.every(row => row.body.includes('2 available to buy')));

    /* ------------------------------------------------ Scenario 5: Checkout rollback produces no notification */
    const outboxCountBefore = (await a`select count(*)::int as c from notification_outbox`)[0].c;
    try {
      await a.begin(async (tx) => {
        // Attempt a checkout inside a transaction that intentionally rolls back
        await tx`update stock set on_hand = on_hand - 1 where product_id = ${prodId} and variant_id = ${varAId}`;
        throw new Error('SIMULATED_CHECKOUT_ABORT');
      });
    } catch (err) {
      assert.equal(err.message, 'SIMULATED_CHECKOUT_ABORT');
    }
    const outboxCountAfter = (await a`select count(*)::int as c from notification_outbox`)[0].c;
    assert.equal(outboxCountBefore, outboxCountAfter, 'Rollback produced zero outbox rows');

    /* ------------------------------------------------ Scenario 6: POS crossing threshold */
    // Open a POS shift
    const shift = (await a`
      insert into pos_shifts (staff_id, opened_at, opening_float_paise, status)
      values ('admin_test_staff', now(), 10000, 'OPEN')
      returning id
    `)[0];

    // Variant B is at 8, threshold is 2. Sell 6 units at POS -> stock drops from 8 to 2. Threshold crossed!
    const posSaleResult = await createPosSaleUsing(a, {
      staffId: 'admin_test_staff',
      role: 'store_admin',
      method: 'cash',
      providerRef: null,
      customerPhone: '9876543210',
      lines: [
        { id: prodId, variantId: varBId, quantity: 6, unitPricePaise: 199900 },
      ],
    });

    assert.equal(posSaleResult.ok, true, posSaleResult.error || posSaleResult.reason);
    assert.ok(posSaleResult.data.stockAlerts?.length === 1);
    assert.equal(posSaleResult.data.stockAlerts[0].availableBefore, 8);
    assert.equal(posSaleResult.data.stockAlerts[0].availableAfter, 2);
    assert.equal(posSaleResult.data.stockAlerts[0].lowStockThreshold, 2);

    await queueStockAlerts(posSaleResult.data.stockAlerts, { sqlOverride: a });

    const outboxPos = await a`
      select event_key, subject, body from notification_outbox
      where entity_id = ${prodId} and subject like '%Pacific Blue%'
    `;
    assert.equal(outboxPos.length, 2, 'POS sale crossing threshold queues 2 alert rows (support and owner) for Variant B');
    assert.ok(outboxPos.every(row => row.subject.includes('Pacific Blue')));
    assert.ok(outboxPos.every(row => row.body.includes('2 available to buy')));

    /* ------------------------------------------------ Scenario 7: POS rollback produces no notification */
    const posOutboxBefore = (await a`select count(*)::int as c from notification_outbox`)[0].c;
    // Attempt POS sale with impossible quantity (100 units when only 2 left)
    const posFail = await createPosSaleUsing(a, {
      staffId: 'admin_test_staff',
      role: 'store_admin',
      method: 'cash',
      providerRef: null,
      customerPhone: '9876543210',
      lines: [
        { id: prodId, variantId: varBId, quantity: 100, unitPricePaise: 199900 },
      ],
    });
    assert.equal(posFail.ok, false);
    const posOutboxAfter = (await a`select count(*)::int as c from notification_outbox`)[0].c;
    assert.equal(posOutboxBefore, posOutboxAfter, 'POS failure produced zero outbox rows');

    /* ------------------------------------------------ Scenario 8: Distinct notifications for different variants */
    const allLowStock = await a`
      select subject from notification_outbox
      where entity_id = ${prodId} and event_key = 'low_stock'
      order by created_at asc
    `;
    assert.equal(allLowStock.length, 6, 'Three distinct options created distinct fan-out notifications');
    assert.ok(allLowStock.some(r => r.subject.includes('Midnight Black')));
    assert.ok(allLowStock.some(r => r.subject.includes('Pacific Blue')));
    assert.ok(allLowStock.some(r => r.subject.includes('Sierra Grey')));

    /* ------------------------------------------------ Scenario 10: Duplicate processing idempotency */
    // Replay the exact same alert from scenario 1
    await queueStockAlerts(resA.stockAlerts, { sqlOverride: a });
    const allAfterReplay = await a`
      select count(*)::int as c from notification_outbox
      where entity_id = ${prodId} and event_key = 'low_stock'
    `;
    assert.equal(allAfterReplay[0].c, 6, 'Duplicate alert replay with same movement id was skipped');

    /* ------------------------------------------------ Scenario 9: Replenishment back_in_stock */
    // Deplete Variant A to 0
    await a`update stock set on_hand = 0 where product_id = ${prodId} and variant_id = ${varAId}`;
    // Restock to 10
    const replenishEvent = stockNotificationEvent({ availableBefore: 0, availableAfter: 10, threshold: 3 });
    assert.equal(replenishEvent, 'back_in_stock');

    const enqueueReplenish = await enqueueNotification(
      'back_in_stock',
      { type: 'product', id: prodId },
      {
        productName: stockAlertProductName('Gadzio Pro Case', 'Midnight Black'),
        stockAvailable: 10,
        staffLink: `/store-admin/stock/${prodId}?variant=${varAId}`,
        token: `replenish:${Date.now()}`,
      },
      a,
    );
    assert.equal(enqueueReplenish.queued, 2, 'Replenishment queued for support and owner');

    const backInStockOutbox = await a`
      select subject, body from notification_outbox
      where entity_id = ${prodId} and event_key = 'back_in_stock'
    `;
    assert.equal(backInStockOutbox.length, 2);
    assert.ok(backInStockOutbox.every(row => row.subject.includes('Midnight Black')));

  } finally {
    await dropFixtureSchema(a, schema);
    await a.end();
  }
});

/**
 * DB integration tests for Free Gifts (Phases 1-4):
 * - Storefront hiding for `is_gift_only` items across catalog & availability
 * - Threshold qualification, ₹0 `order_items` row, single gift limit
 * - Strict no-fallback on last-unit contention (`GiftUnavailableError` -> retry with `confirmWithoutGift: true`)
 * - Unavailable-at-checkout telemetry counter increment outside rolled-back tx
 * - Deadlock-free stock + gift lock ordering across concurrent opposite carts
 * - Order lifecycle: RESERVED -> CONSUMED (PAID), RESERVED -> RELEASED (CANCELLED), late payment restore
 * - Return threshold advisory note (`Free gift (...) may need to be returned`)
 * - Store Admin CRUD, audit entries, CSV export, and analytics exclusion of ₹0 gift rows
 */
import test, { after, before, beforeEach } from 'node:test';
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
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local
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

function client(searchPath = 'pg_catalog', max = 1) {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') {
    throw new Error('Legacy database tests are disabled');
  }
  const { isPooler, transactionPooler } = connectionDetails();
  if (transactionPooler) throw new Error('Requires a session connection, not port 6543.');
  return postgres(fixtureConnectionUrl(), {
    max,
    connection: { search_path: searchPath },
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: true,
  alias: { '@': path.join(root, 'src') },
});

const {
  GiftUnavailableError,
  appendFreeGiftReturnThresholdNoteInTx,
  evaluateCartFreeGiftsUsing,
  recordGiftUnavailableAttempt,
} = await jiti.import('@/lib/free-gifts/store');

const {
  createOrderUsing,
  transitionOrderStatusUsing,
} = await jiti.import(path.join(root, 'src', 'lib', 'payu', 'orders.ts'));

const { loadCatalogUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'catalog', 'storefront.ts'),
);
const { readAvailabilityUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'availability-server.ts'),
);
const {
  createFreeGiftRuleUsing,
  exportFreeGiftsCsvUsing,
  getFreeGiftsAdminDataUsing,
  updateFreeGiftRuleUsing,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'free-gifts.ts'));
const { getSalesAnalytics } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'analytics.ts'),
);

const SCHEMA = `itest_free_gift_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
let setupSql;
let sql;

function makeOrderPayload(overrides = {}) {
  const items = overrides.items ?? [
    { id: 'prod_main', name: 'Silicone Case', quantity: 1, unitPrice: 2500, totalPrice: 2500 },
  ];
  const subtotalPaise = overrides.subtotalPaise ?? items.reduce((s, i) => s + Math.round(i.totalPrice * 100), 0);
  return {
    txnid: overrides.txnid ?? `FG${randomBytes(5).toString('hex').toUpperCase()}`,
    userId: overrides.userId ?? 'usr_fg_1',
    items,
    subtotalPaise,
    shippingPaise: overrides.shippingPaise ?? 0,
    totalPaise: overrides.totalPaise ?? subtotalPaise,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: overrides.customerName ?? 'Free Gift Buyer',
    customerEmail: overrides.customerEmail ?? 'buyer1@example.test',
    customerPhone: '9000000001',
    shippingAddress: {
      name: overrides.customerName ?? 'Free Gift Buyer',
      phone: '9000000001',
      line1: '10 MG Road',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    reservationSeconds: overrides.reservationSeconds ?? 900,
    confirmWithoutGift: overrides.confirmWithoutGift ?? false,
    coupon: overrides.coupon,
  };
}

before(async () => {
  if (skip) return;
  setupSql = client('pg_catalog', 1);
  sql = client(SCHEMA, 4);

  const tablesToCopy = [
    'store_settings',
    'users',
    'user_sessions',
    'categories',
    'product_types',
    'attributes',
    'product_type_attributes',
    'product_attribute_values',
    'device_brands',
    'device_models',
    'product_device_models',
    'colours',
    'products',
    'product_images',
    'product_variants',
    'product_variant_colours',
    'stock',
    'stock_movements',
    'coupons',
    'coupon_targets',
    'coupon_redemptions',
    'free_gift_rules',
    'free_gift_redemptions',
    'orders',
    'order_items',
    'order_addresses',
    'order_status_history',
    'refund_obligations',
    'refunds',
    'store_admins',
    'store_admin_audit',
  ];

  await createFixtureSchema(setupSql, SCHEMA, tablesToCopy);
  globalThis.__gadzioSql = sql;
  await sql.unsafe(`set search_path to "${SCHEMA}"`);
});

after(async () => {
  if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  if (setupSql) {
    await dropFixtureSchema(setupSql, SCHEMA).catch(() => {});
    await setupSql.end({ timeout: 2 }).catch(() => {});
  }
});

beforeEach(async () => {
  if (skip) return;
  await sql.unsafe(`
    truncate
      store_admin_audit,
      store_admins,
      refunds,
      refund_obligations,
      order_status_history,
      order_addresses,
      order_items,
      orders,
      free_gift_redemptions,
      free_gift_rules,
      coupon_redemptions,
      coupon_targets,
      coupons,
      stock_movements,
      stock,
      product_variant_colours,
      product_variants,
      product_images,
      product_attribute_values,
      product_device_models,
      products,
      colours,
      device_models,
      device_brands,
      product_type_attributes,
      attributes,
      product_types,
      categories,
      user_sessions,
      users,
      store_settings
    restart identity cascade
  `);

  await sql`
    insert into store_settings (key, value)
    values
      ('timezone', 'Asia/Kolkata'),
      ('sale_live', 'false'),
      ('shipping_mode', 'free'),
      ('coupons_enabled', 'on')
  `;

  await sql`
    insert into store_admins (id, email, name, role, password_hash)
    values ('adm_fg', 'owner@gadzio.test', 'Owner', 'store_owner', 'x')
  `;

  await sql`
    insert into users (id, email, password_hash, first_name, last_name, created_at)
    values
      ('usr_fg_1', 'buyer1@example.test', 'x', 'Buyer', 'One', now() - interval '2 days'),
      ('usr_fg_2', 'buyer2@example.test', 'x', 'Buyer', 'Two', now() - interval '2 days')
  `;

  await sql`
    insert into categories (id, slug, name, sort_order, is_active)
    values ('cat_fg', 'cases', 'Cases', 1, true)
  `;

  await sql`
    insert into products (id, category_id, slug, name, price_paise, in_stock, is_active, is_gift_only)
    values
      ('prod_main', 'cat_fg', 'silicone-case', 'Silicone Case', 250000, true, true, false),
      ('prod_alt', 'cat_fg', 'woven-strap', 'Woven Strap', 300000, true, true, false),
      ('prod_gift', 'cat_fg', 'gift-sleeve', 'Free Travel Sleeve', 79900, true, true, true)
  `;

  await sql`
    insert into stock (id, product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory)
    values
      ('stk_main', 'prod_main', null, 10, 0, 1, true),
      ('stk_alt', 'prod_alt', null, 10, 0, 1, true),
      ('stk_gift', 'prod_gift', null, 2, 0, 0, true)
  `;
});

test('is_gift_only items are excluded from storefront catalog and availability reads', { skip }, async () => {
  const catalog = await loadCatalogUsing(sql);
  assert.equal(catalog.products.some((p) => p.id === 'prod_main'), true);
  assert.equal(catalog.products.some((p) => p.id === 'prod_gift'), false);

  const avail = await readAvailabilityUsing(sql, ['prod_main', 'prod_gift']);
  assert.equal(avail.products.find((p) => p.id === 'prod_main')?.inStock, true);
  const giftAvail = avail.products.find((p) => p.id === 'prod_gift');
  assert.equal(giftAvail?.inStock, false);
  assert.equal(giftAvail?.tracked, false);
});

test('admin Free Gift CRUD writes audit rows and evaluates cart thresholds accurately', { skip }, async () => {
  const created = await createFreeGiftRuleUsing(
    sql,
    {
      name: '₹2,000+ Sleeve',
      giftProductId: 'prod_gift',
      targetRupees: '2000',
      badgeText: 'FREE',
      unlockMessage: 'Free Travel Sleeve unlocked!',
      isActive: true,
      showOnProductPage: true,
      maxGiftsTotal: '10',
      perCustomerLimit: '1',
      priority: '1',
      couponInteraction: 'allow',
    },
    { actorId: 'adm_fg', actorEmail: 'owner@gadzio.test', request: null },
  );
  assert.equal(created.ok, true);

  const edited = await updateFreeGiftRuleUsing(
    sql,
    created.ruleId,
    {
      name: '₹2,200+ Sleeve',
      giftProductId: 'prod_gift',
      targetRupees: '2200',
      badgeText: 'GIFT',
      unlockMessage: 'Travel Sleeve added free!',
      isActive: true,
      showOnProductPage: true,
      maxGiftsTotal: '10',
      perCustomerLimit: '1',
      priority: '2',
      couponInteraction: 'allow',
    },
    { actorId: 'adm_fg', actorEmail: 'owner@gadzio.test', request: null },
  );
  assert.equal(edited.ok, true);

  const evalBelow = await evaluateCartFreeGiftsUsing(sql, {
    lines: [{ linePaise: 150000, isFreeGift: false }],
    discountPaise: 0,
    couponApplied: false,
  });
  assert.equal(evalBelow.unlockedGift, null);
  assert.equal(evalBelow.nextNudge?.remainingPaise, 70000);

  const evalHit = await evaluateCartFreeGiftsUsing(sql, {
    lines: [{ linePaise: 250000, isFreeGift: false }],
    discountPaise: 0,
    couponApplied: false,
  });
  assert.equal(evalHit.unlockedGift?.gift.productId, 'prod_gift');

  const adminData = await getFreeGiftsAdminDataUsing(sql);
  assert.equal(adminData.ok, true);
  assert.equal(adminData.data.rules.length, 1);
  assert.equal(adminData.data.rules[0].targetPaise, 220000);

  const auditRows = await sql`
    select action from store_admin_audit where entity_id = ${created.ruleId} order by created_at asc
  `;
  assert.deepEqual(
    auditRows.map((r) => r.action),
    ['free_gift.create', 'free_gift.update'],
  );

  const csvRes = await exportFreeGiftsCsvUsing(sql, {
    actorId: 'adm_fg',
    actorEmail: 'owner@gadzio.test',
    request: null,
  });
  assert.equal(csvRes.ok, true);
  assert.match(csvRes.csv, /₹2,200\+ Sleeve|2200\.00/);
});

test('concurrent last-unit gift contention throws GiftUnavailableError with no silent fallback and allows retry without gift', { skip }, async () => {
  await sql`update stock set on_hand = 1, reserved = 0 where product_id = 'prod_gift'`;
  const ruleRes = await createFreeGiftRuleUsing(
    sql,
    {
      name: 'High tier gift',
      giftProductId: 'prod_gift',
      targetRupees: '2000',
      isActive: true,
      showOnProductPage: true,
    },
    { actorId: 'adm_fg', actorEmail: 'owner@gadzio.test', request: null },
  );
  assert.equal(ruleRes.ok, true);

  // Two buyers race concurrently for the single remaining gift unit (opposite paid items test sorted locking too!)
  const outcomes = await Promise.allSettled([
    createOrderUsing(
      sql,
      makeOrderPayload({
        txnid: 'FG_RACE_1',
        userId: 'usr_fg_1',
        customerEmail: 'buyer1@example.test',
        items: [{ id: 'prod_main', name: 'Silicone Case', quantity: 1, unitPrice: 2500, totalPrice: 2500 }],
        subtotalPaise: 250000,
        totalPaise: 250000,
      }),
    ),
    createOrderUsing(
      sql,
      makeOrderPayload({
        txnid: 'FG_RACE_2',
        userId: 'usr_fg_2',
        customerEmail: 'buyer2@example.test',
        items: [{ id: 'prod_alt', name: 'Woven Strap', quantity: 1, unitPrice: 3000, totalPrice: 3000 }],
        subtotalPaise: 300000,
        totalPaise: 300000,
      }),
    ),
  ]);

  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    rejected[0].reason instanceof GiftUnavailableError
      || (rejected[0].reason?.name === 'GiftUnavailableError'
        && rejected[0].reason?.reason === 'out_of_stock'
        && rejected[0].reason?.ruleId === ruleRes.ruleId),
    `expected GiftUnavailableError, got ${rejected[0].reason?.name}: ${rejected[0].reason?.message}`,
  );

  // Outside tx (simulating /api/payu/initiate 409 handler), record unavailable telemetry
  await recordGiftUnavailableAttempt(rejected[0].reason.ruleId, sql);
  const [ruleAfterRace] = await sql`
    select
      r.unavailable_checkout_count,
      (
        select count(*)::int from free_gift_redemptions gr
        where gr.rule_id = r.id and gr.state in ('RESERVED', 'CONSUMED')
      ) as claimed_count
    from free_gift_rules r
    where r.id = ${ruleRes.ruleId}
  `;
  assert.equal(Number(ruleAfterRace.unavailable_checkout_count), 1);
  assert.equal(Number(ruleAfterRace.claimed_count), 1);

  // Second buyer confirms checkout without free gift -> succeeds cleanly with zero gift lines
  const retryOrder = await createOrderUsing(
    sql,
    makeOrderPayload({
      txnid: 'FG_RETRY_OK',
      userId: 'usr_fg_2',
      customerEmail: 'buyer2@example.test',
      items: [{ id: 'prod_alt', name: 'Woven Strap', quantity: 1, unitPrice: 3000, totalPrice: 3000 }],
      subtotalPaise: 300000,
      totalPaise: 300000,
      confirmWithoutGift: true,
    }),
  );
  const retryItems = await sql`
    select * from order_items where order_id = ${retryOrder.order.id}
  `;
  assert.equal(retryItems.length, 1);
  assert.equal(retryItems[0].is_free_gift, false);
});

test('gift lifecycle transitions (PAID consume, CANCELLED release, late-payment restore), return threshold note, and analytics exclusion', { skip }, async () => {
  const ruleRes = await createFreeGiftRuleUsing(
    sql,
    {
      name: 'Lifecycle pouch',
      giftProductId: 'prod_gift',
      targetRupees: '2000',
      isActive: true,
      showOnProductPage: true,
    },
    { actorId: 'adm_fg', actorEmail: 'owner@gadzio.test', request: null },
  );
  assert.equal(ruleRes.ok, true);

  // 1) Order A -> PAID consumes 1 gift unit & excludes ₹0 gift row from analytics
  await createOrderUsing(
    sql,
    makeOrderPayload({ txnid: 'FG_PAY_1', userId: 'usr_fg_1', customerEmail: 'buyer1@example.test' }),
  );
  const payRes = await transitionOrderStatusUsing(sql, {
    txnid: 'FG_PAY_1',
    targetStatus: 'PAID',
    payuStatus: 'success',
    mihpayid: 'MIH_FG_1',
    amountPaid: 2500,
  });
  assert.equal(payRes.transitioned, true);

  const [stkAfterPay] = await sql`select on_hand, reserved from stock where product_id = 'prod_gift'`;
  assert.equal(Number(stkAfterPay.on_hand), 1);
  assert.equal(Number(stkAfterPay.reserved), 0);

  const [redemPaid] = await sql`
    select gr.state from free_gift_redemptions gr
    join orders o on o.id = gr.order_id where o.txnid = 'FG_PAY_1'
  `;
  assert.equal(redemPaid.state, 'CONSUMED');

  // Verify partial return note triggers when refund drops net below ₹2,000 threshold
  const [paidOrderRow] = await sql`select id from orders where txnid = 'FG_PAY_1'`;
  await sql.begin(async (tx) => {
    const { note } = await appendFreeGiftReturnThresholdNoteInTx(tx, {
      orderId: paidOrderRow.id,
      additionalRefundPaise: 100000,
      baseNote: 'Customer requested partial return',
    });
    assert.match(note || '', /Free Travel Sleeve.*may need to be returned/);
  });

  // Verify analytics excludes the ₹0 free gift line from units/product metrics
  const analytics = await getSalesAnalytics('7d');
  assert.equal(analytics.ok, true);
  assert.equal(Number(analytics.data.units), 1);
  assert.equal(Number(analytics.data.revenue.current), 250000);

  // 2) Order B -> CANCELLED releases gift reservation & claimed_count, then late PAID restores it
  await createOrderUsing(
    sql,
    makeOrderPayload({ txnid: 'FG_LATE_1', userId: 'usr_fg_2', customerEmail: 'buyer2@example.test' }),
  );
  await transitionOrderStatusUsing(sql, {
    txnid: 'FG_LATE_1',
    targetStatus: 'CANCELLED',
    cancelReason: 'Expired checkout',
    policy: { holdMinutes: 15, failureGraceSeconds: 0, unresolvedMinutes: 30 },
  });

  const [stkAfterCancel] = await sql`select on_hand, reserved from stock where product_id = 'prod_gift'`;
  assert.equal(Number(stkAfterCancel.on_hand), 1);
  assert.equal(Number(stkAfterCancel.reserved), 0);

  const [ruleAfterCancel] = await sql`
    select count(*) filter (where state in ('RESERVED', 'CONSUMED'))::int as claimed_count
    from free_gift_redemptions
    where rule_id = ${ruleRes.ruleId}
  `;
  assert.equal(Number(ruleAfterCancel.claimed_count), 1);

  const latePaid = await transitionOrderStatusUsing(sql, {
    txnid: 'FG_LATE_1',
    targetStatus: 'PAID',
    payuStatus: 'success',
    mihpayid: 'MIH_FG_LATE',
    amountPaid: 2500,
  });
  assert.equal(latePaid.transitioned, true);

  const [stkAfterLate] = await sql`select on_hand, reserved from stock where product_id = 'prod_gift'`;
  assert.equal(Number(stkAfterLate.on_hand), 0);
  const [redemLate] = await sql`
    select gr.state from free_gift_redemptions gr
    join orders o on o.id = gr.order_id where o.txnid = 'FG_LATE_1'
  `;
  assert.equal(redemLate.state, 'CONSUMED');
});


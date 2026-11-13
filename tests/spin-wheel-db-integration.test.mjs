/**
 * Database integration tests for Spin and Win (Phase 3 engine & admin service).
 *
 * Uses a temporary isolated schema (never modifying public tables):
 * - Enforces 1 spin per customer per store day + midnight IST reset
 * - Parallel draws for same customer yield strictly 1 spin row and 1 coupon
 * - Personal coupon creation (winner email only, single-use, valid N days)
 * - Other customers cannot see or use another user's prize coupon
 * - NO_PRIZE draws create zero coupons and zero notifications
 * - Daily cap and total cap enforcement under concurrency
 * - IP daily limit enforcement and clean rollback on block
 * - Minimum account age guard
 * - Store admin config edits do not alter already-won coupons; test spin writes 0 rows
 * - CSV export masks customer emails and writes an audit row
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

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL && !process.env.DATABASE_MIGRATION_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; test stays skipped.
  }
}

function fixtureConnectionUrl() {
  return (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
}

function isTransactionPooler() {
  try {
    return new URL(fixtureConnectionUrl()).port === '6543';
  } catch {
    return false;
  }
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !fixtureConnectionUrl()
    ? 'DATABASE_MIGRATION_URL / DATABASE_URL is not set'
    : isTransactionPooler()
      ? 'temporary-schema isolation needs a session connection (not port 6543)'
      : false;

function client(schema) {
  return postgres(fixtureConnectionUrl(), {
    max: schema ? 4 : 1,
    idle_timeout: 20,
    connect_timeout: 25,
    max_lifetime: 1800,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: schema ? { search_path: schema } : { search_path: 'pg_catalog' },
    onnotice: () => { },
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  executeSpinDrawUsing,
  getCustomerSpinStateUsing,
  getHomeSpinSurfaceUsing,
  getSpinWheelConfigUsing,
  invalidateSpinWheelCache,
} = await jiti.import(path.join(root, 'src', 'lib', 'spin-wheel', 'store.ts'));

const { computeStoreDayInfo } = await jiti.import(
  path.join(root, 'src', 'lib', 'spin-wheel', 'rules.ts'),
);

const {
  exportSpinWheelCsvUsing,
  getSpinWheelAdminDataUsing,
  runStaffTestSpinUsing,
  saveSpinWheelConfigUsing,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'spin-wheel.ts'));

const { listCustomerCouponsUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'account', 'coupons.ts'),
);

const { consumeCouponInTx, lookupCouponForCart } = await jiti.import(
  path.join(root, 'src', 'lib', 'coupons', 'store.ts'),
);

const { createOrderUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'payu', 'orders.ts'),
);

const SCHEMA = `itest_spin_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
let setupSql;
let sql;

const USERS = [
  { id: 'usr_a', email: 'winner.one@example.com', name: 'Winner One' },
  { id: 'usr_b', email: 'other.two@example.com', name: 'Other Two' },
  { id: 'usr_c', email: 'third.user@example.com', name: 'Third User' },
];

before(async () => {
  if (skip) return;
  setupSql = client();
  sql = client(SCHEMA);

  const tablesToCopy = [
    'store_settings',
    'users',
    'stock',
    'stock_movements',
    'orders',
    'order_items',
    'order_addresses',
    'order_status_history',
    'colours',
    'device_brands',
    'device_models',
    'products',
    'product_images',
    'product_device_models',
    'product_variants',
    'product_variant_colours',
    'categories',
    'coupons',
    'coupon_targets',
    'coupon_redemptions',
    'free_gift_rules',
    'free_gift_redemptions',
    'spin_wheel_settings',
    'spin_wheel_segments',
    'spin_wheel_segment_daily_counts',
    'spin_wheel_spins',
    'notification_outbox',
    'notification_channel_settings',
    'email_templates',
    'automated_messages',
    'store_admins',
    'store_admin_audit',
  ];

  await createFixtureSchema(setupSql, SCHEMA, tablesToCopy);
  await sql.unsafe(`set search_path to "${SCHEMA}"`);
});

after(async () => {
  if (sql) await sql.end({ timeout: 2 }).catch(() => { });
  if (setupSql) {
    await dropFixtureSchema(setupSql, SCHEMA).catch(() => { });
    await setupSql.end({ timeout: 2 }).catch(() => { });
  }
});

beforeEach(async () => {
  if (skip) return;
  invalidateSpinWheelCache(sql);

  await sql.unsafe(`
    truncate
      store_admin_audit,
      store_admins,
      automated_messages,
      email_templates,
      notification_outbox,
      notification_channel_settings,
      spin_wheel_spins,
      spin_wheel_segment_daily_counts,
      spin_wheel_segments,
      spin_wheel_settings,
      free_gift_redemptions,
      free_gift_rules,
      coupon_redemptions,
      coupon_targets,
      coupons,
      order_status_history,
      order_addresses,
      order_items,
      orders,
      stock_movements,
      stock,
      product_variant_colours,
      product_variants,
      product_device_models,
      product_images,
      products,
      device_models,
      device_brands,
      colours,
      categories,
      users,
      store_settings
    restart identity cascade
  `);

  await sql`insert into store_settings (key, value) values ('timezone', 'Asia/Kolkata')`;

  await sql`
    insert into notification_channel_settings (id, channel, audience, topic, is_active)
    values
      ('inapp:customer:spin_win', 'inapp', 'customer', 'spin_win', true),
      ('email:customer:spin_win', 'email', 'customer', 'spin_win', false),
      ('sms:customer:spin_win', 'sms', 'customer', 'spin_win', false),
      ('inapp:admin:spin_win', 'inapp', 'admin', 'spin_win', false),
      ('email:admin:spin_win', 'email', 'admin', 'spin_win', false),
      ('sms:admin:spin_win', 'sms', 'admin', 'spin_win', false)
  `;

  for (const user of USERS) {
    const [firstName, lastName = ''] = user.name.split(' ');
    await sql`
      insert into users (id, email, password_hash, first_name, last_name, created_at)
      values (${user.id}, ${user.email}, 'x', ${firstName}, ${lastName}, now() - interval '2 days')
    `;
  }

  await sql`
    insert into categories (id, slug, name, sort_order, is_active)
    values ('cat_1', 'cases', 'Cases', 1, true)
  `;
  await sql`
    insert into products (id, category_id, slug, name, price_paise, in_stock, is_active)
    values ('prod_1', 'cat_1', 'leather-case', 'Leather Case', 99900, true, true)
  `;

  await sql`
    insert into spin_wheel_settings (
      id, enabled, title, subtitle, spins_per_customer_per_day,
      terms_text, max_spins_per_ip_per_day, min_account_age_minutes, show_on_home_page,
      reward_cooldown_mode, reward_cooldown_days, show_next_spin_countdown
    ) values (
      'default', true, 'Spin and Win', 'Win a personal reward today.', 1,
      'One spin per customer per day.', 1, 0, true,
      'disabled', 7, true
    )
  `;

  await sql`
    insert into spin_wheel_segments (
      id, label, color_hex, segment_type, weight, daily_cap, total_cap,
      is_active, sort_order, coupon_type, coupon_value,
      coupon_max_discount_paise, coupon_min_order_paise,
      coupon_scope, coupon_target_ids, coupon_valid_days, coupon_allow_with_sale_price
    ) values
      (
        'seg_prize', '15% off', '#ffe100', 'COUPON', 5000, null, null,
        true, 0, 'PERCENT', 15,
        30000, 50000,
        'ORDER', '{}', 7, false
      ),
      (
        'seg_nope', 'Try tomorrow', '#111111', 'NO_PRIZE', 5000, null, null,
        true, 1, null, 0,
        null, 0,
        'ORDER', '{}', 7, false
      )
  `;
});

test('personal coupon created on win is visible and redeemable ONLY by the winner', { skip }, async () => {
  const now = new Date(Date.now() - 5_000);
  const outcome = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_a', termsAccepted: true },
    { nowOverride: now, rollFn: () => 0 }, // lands on seg_prize
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.alreadySpun, false);
  assert.equal(outcome.spin.segmentType, 'COUPON');
  assert.ok(outcome.spin.couponCode?.startsWith('SPIN-'));

  const [couponRow] = await sql`
    select * from coupons where code = ${outcome.spin.couponCode}
  `;
  assert.ok(couponRow);
  assert.equal(couponRow.source, 'spin_wheel');
  assert.equal(couponRow.per_customer_limit, 1);
  assert.equal(couponRow.total_redemption_limit, 1);
  assert.equal(couponRow.show_to_all_users, false);
  assert.deepEqual(couponRow.restricted_to_emails, ['winner.one@example.com']);
  assert.deepEqual(couponRow.assigned_to_emails, ['winner.one@example.com']);

  // Valid for 7 days from spin timestamp
  const diffDays = (new Date(couponRow.ends_at).getTime() - now.getTime()) / 86_400_000;
  assert.equal(diffDays, 7);

  // Winner sees it in their customer coupons list; other customer does NOT
  const loadCouponsEnabled = async () => ({
    ok: true,
    settings: { coupons_enabled: 'on' },
  });
  const winnerCoupons = await listCustomerCouponsUsing(sql, 'usr_a', loadCouponsEnabled);
  assert.ok(winnerCoupons.some((c) => c.code === outcome.spin.couponCode && c.source === 'spin_wheel'));

  const otherCoupons = await listCustomerCouponsUsing(sql, 'usr_b', loadCouponsEnabled);
  assert.equal(otherCoupons.some((c) => c.code === outcome.spin.couponCode), false);

  // Coupon validation allows winner and rejects other customer
  const cartFor = (userId, email) => ({
    lines: [{
      productId: 'prod_1',
      categoryId: 'cat_1',
      brandId: 'brand_1',
      quantity: 1,
      unitPaise: 100000,
      linePaise: 100000,
      onSale: false,
    }],
    subtotalPaise: 100000,
    shippingPaise: 0,
    customer: { userId, email, group: null },
  });

  const winnerLookup = await lookupCouponForCart(sql, outcome.spin.couponCode, cartFor('usr_a', 'winner.one@example.com'));
  assert.equal(winnerLookup.evaluation.ok, true);
  assert.equal(winnerLookup.evaluation.discountPaise, 15000);

  const otherLookup = await lookupCouponForCart(sql, outcome.spin.couponCode, cartFor('usr_b', 'other.two@example.com'));
  assert.equal(otherLookup.evaluation.ok, false);

  // Notification queued post-commit for winner
  const [notif] = await sql`
    select event_key, customer_user_id, body from notification_outbox
    where event_key = 'spin_win'
  `;
  assert.ok(notif);
  assert.equal(notif.customer_user_id, 'usr_a');
  assert.match(notif.body, new RegExp(outcome.spin.couponCode));
});

test('concurrent parallel spins by the same customer produce strictly 1 spin and 1 coupon', { skip }, async () => {
  const now = new Date('2026-11-13T10:00:00.000Z');
  const parallel = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      executeSpinDrawUsing(
        sql,
        { userId: 'usr_a', ipHash: `ip_${i}`, termsAccepted: true },
        { nowOverride: now, rollFn: () => 0 },
      ),
    ),
  );

  for (const res of parallel) {
    assert.equal(res.ok, true);
  }
  const freshWins = parallel.filter((r) => !r.alreadySpun);
  const replays = parallel.filter((r) => r.alreadySpun);
  assert.equal(freshWins.length, 1);
  assert.equal(replays.length, 9);

  const couponCodes = new Set(parallel.map((r) => r.spin.couponCode));
  assert.equal(couponCodes.size, 1);

  const [{ cnt: spinCnt }] = await sql`select count(*)::int as cnt from spin_wheel_spins where user_id = 'usr_a'`;
  const [{ cnt: cpnCnt }] = await sql`select count(*)::int as cnt from coupons where source = 'spin_wheel'`;
  assert.equal(spinCnt, 1);
  assert.equal(cpnCnt, 1);
});

test('midnight store-day reset unlocks next spin strictly after 00:00 IST', { skip }, async () => {
  const beforeMidnightUtc = new Date('2026-11-13T18:29:30.000Z'); // 23:59:30 IST
  const afterMidnightUtc = new Date('2026-11-13T18:30:05.000Z'); // 00:00:05 IST next day

  const day1 = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_a', termsAccepted: true },
    { nowOverride: beforeMidnightUtc, rollFn: () => 0 },
  );
  assert.equal(day1.ok, true);
  assert.equal(day1.alreadySpun, false);

  const stateSameDay = await getCustomerSpinStateUsing(sql, 'usr_a', { nowOverride: new Date('2026-11-13T18:29:50.000Z') });
  assert.equal(stateSameDay.todaySpin?.spinId, day1.spin.spinId);

  const day2 = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_a', termsAccepted: true },
    { nowOverride: afterMidnightUtc, rollFn: () => 0 },
  );
  assert.equal(day2.ok, true);
  assert.equal(day2.alreadySpun, false);
  assert.notEqual(day2.spin.spinId, day1.spin.spinId);
});

test('NO_PRIZE spin records the daily spin without creating coupons or notifications', { skip }, async () => {
  const res = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_a', termsAccepted: true },
    { nowOverride: new Date('2026-11-13T11:00:00.000Z'), rollFn: (total) => total - 1 }, // lands on seg_nope
  );

  assert.equal(res.ok, true);
  assert.equal(res.spin.segmentType, 'NO_PRIZE');
  assert.equal(res.spin.couponCode, null);

  const [{ cnt: cpnCnt }] = await sql`select count(*)::int as cnt from coupons`;
  const [{ cnt: outboxCnt }] = await sql`select count(*)::int as cnt from notification_outbox`;
  assert.equal(cpnCnt, 0);
  assert.equal(outboxCnt, 0);
});

test('daily cap and total cap hold accurately under concurrent wins from multiple customers', { skip }, async () => {
  await sql`
    update spin_wheel_segments
    set daily_cap = 1, total_cap = 1, weight = 100
    where id = 'seg_prize'
  `;

  const results = await Promise.all([
    executeSpinDrawUsing(
      sql,
      { userId: 'usr_a', ipHash: 'ip_1', termsAccepted: true },
      { nowOverride: new Date('2026-11-13T12:00:00.000Z'), rollFn: () => 0 },
    ),
    executeSpinDrawUsing(
      sql,
      { userId: 'usr_b', ipHash: 'ip_2', termsAccepted: true },
      { nowOverride: new Date('2026-11-13T12:00:00.000Z'), rollFn: () => 0 },
    ),
    executeSpinDrawUsing(
      sql,
      { userId: 'usr_c', ipHash: 'ip_3', termsAccepted: true },
      { nowOverride: new Date('2026-11-13T12:00:00.000Z'), rollFn: () => 0 },
    ),
  ]);

  const prizeWins = results.filter((r) => r.ok && r.spin.segmentId === 'seg_prize');
  const nopeWins = results.filter((r) => r.ok && r.spin.segmentId === 'seg_nope');

  assert.equal(prizeWins.length, 1);
  assert.equal(nopeWins.length, 2);

  const [seg] = await sql`select total_awarded from spin_wheel_segments where id = 'seg_prize'`;
  assert.equal(seg.total_awarded, 1);
});

test('IP daily limit blocks a second account sharing the same IP on the same store day', { skip }, async () => {
  const first = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'shared_ip_hash', termsAccepted: true },
    { nowOverride: new Date('2026-11-13T12:00:00.000Z'), rollFn: () => 0 },
  );
  assert.equal(first.ok, true);

  const blocked = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_b', ipHash: 'shared_ip_hash', termsAccepted: true },
    { nowOverride: new Date('2026-11-13T13:00:00.000Z'), rollFn: () => 0 },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'ip_limit');

  // Blocked user has zero recorded spin row (transaction rolled back cleanly)
  const [{ cnt }] = await sql`select count(*)::int as cnt from spin_wheel_spins where user_id = 'usr_b'`;
  assert.equal(cnt, 0);
});

test('minimum account age guard rejects accounts younger than configured minutes', { skip }, async () => {
  await sql`update spin_wheel_settings set min_account_age_minutes = 60 where id = 'default'`;
  await sql`
    insert into users (id, email, password_hash, first_name, last_name, created_at)
    values ('usr_brand_new', 'newbie@example.com', 'x', 'New', 'Bie', now() - interval '5 minutes')
  `;

  const res = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_brand_new', ipHash: 'ip_newbie', termsAccepted: true },
    { rollFn: () => 0 },
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'account_too_new');
});

test('editing wheel config does not affect already-won coupons, test spin writes nothing, CSV masks emails', { skip }, async () => {
  const win = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_a', termsAccepted: true },
    { rollFn: () => 0 },
  );
  assert.equal(win.ok, true);

  // Admin updates config removing old prize value
  const saveRes = await saveSpinWheelConfigUsing(
    sql,
    {
      settings: {
        enabled: true,
        title: 'Holiday Wheel',
        subtitle: 'Updated promo',
        startsAt: null,
        endsAt: null,
        spinsPerCustomerPerDay: 1,
        maxSpinsPerIpPerDay: 2,
        minAccountAgeMinutes: 0,
        showOnHomePage: true,
        termsText: 'Updated terms apply.',
      },
      segments: [
        {
          id: 'seg_prize',
          label: '5% off',
          colorHex: '#e0f2fe',
          segmentType: 'COUPON',
          weight: 2500,
          dailyCap: null,
          totalCap: null,
          isActive: true,
          sortOrder: 0,
          couponType: 'PERCENT',
          couponValueInput: '5',
          couponMaxDiscountRupees: '100',
          couponMinOrderRupees: null,
          couponScope: 'ORDER',
          couponTargetIds: [],
          couponValidDays: 3,
          couponAllowWithSalePrice: true,
        },
        {
          id: 'seg_nope',
          label: 'Better luck tomorrow',
          colorHex: '#111111',
          segmentType: 'NO_PRIZE',
          weight: 7500,
          dailyCap: null,
          totalCap: null,
          isActive: true,
          sortOrder: 1,
          couponType: null,
          couponValueInput: '0',
          couponMaxDiscountRupees: null,
          couponMinOrderRupees: null,
          couponScope: 'ORDER',
          couponTargetIds: [],
          couponValidDays: 7,
          couponAllowWithSalePrice: false,
        },
      ],
    },
    { actorId: 'adm_1', actorEmail: 'owner@gadzio.test', request: null },
  );
  assert.equal(saveRes.ok, true);

  // Previously won coupon retains original 15% / 300 max discount / active status
  const [oldCoupon] = await sql`select value, max_discount_paise, status from coupons where code = ${win.spin.couponCode}`;
  assert.equal(Number(oldCoupon.value), 15);
  assert.equal(Number(oldCoupon.max_discount_paise), 30000);
  assert.equal(oldCoupon.status, 'active');

  // Test spin runs without persisting any spin or coupon rows
  const [{ cnt: beforeSpins }] = await sql`select count(*)::int as cnt from spin_wheel_spins`;
  const testSpin = await runStaffTestSpinUsing(sql, () => 0);
  assert.equal(testSpin.ok, true);
  assert.equal(testSpin.result.label, '5% off');
  const [{ cnt: afterSpins }] = await sql`select count(*)::int as cnt from spin_wheel_spins`;
  assert.equal(afterSpins, beforeSpins);

  // Admin dashboard reports + CSV export mask customer emails and audit export
  const dash = await getSpinWheelAdminDataUsing(sql);
  assert.equal(dash.ok, true);
  assert.equal(dash.data.reports.recentSpins.length, 1);
  assert.equal(dash.data.reports.recentSpins[0].customerMasked.includes('winner.one@'), false);

  const csvRes = await exportSpinWheelCsvUsing(sql, { actorId: 'adm_1', actorEmail: 'owner@gadzio.test', request: null });
  assert.equal(csvRes.ok, true);
  assert.equal(csvRes.csv.includes('winner.one@example.com'), false);
  assert.match(csvRes.csv, new RegExp(win.spin.couponCode));

  const audits = await sql`select action from store_admin_audit order by created_at asc`;
  assert.ok(audits.some((a) => a.action === 'spin_wheel.update'));
  assert.ok(audits.some((a) => a.action === 'spin_wheel.export'));
});

test('winner redeems personal spin coupon through checkout order, single-use blocks reuse, next day unlocks spin', { skip }, async () => {
  const day1 = new Date(Date.now() - 48 * 3600 * 1000);
  const { nextResetAt } = computeStoreDayInfo(day1, 'Asia/Kolkata');
  const day1ResetMs = nextResetAt.getTime();
  const sameDay = new Date(day1ResetMs - 60_000);
  const day2 = new Date(day1ResetMs + 60_000);

  // Day 1: winner spins & gets 15% off coupon (max ₹300)
  const win = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_checkout', termsAccepted: true },
    { nowOverride: day1, rollFn: () => 0 },
  );
  assert.equal(win.ok, true);
  assert.equal(win.alreadySpun, false);
  const couponCode = win.spin.couponCode;
  assert.ok(couponCode);

  // Same day: second spin returns replay with same coupon (never spins again)
  const replay = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_checkout', termsAccepted: true },
    { nowOverride: sameDay, rollFn: () => 0 },
  );
  assert.equal(replay.ok, true);
  assert.equal(replay.alreadySpun, true);
  assert.equal(replay.spin.couponCode, couponCode);

  // Winner checks out via createOrderUsing with ₹1,000 item -> 15% off (₹150) => ₹850 total
  const txnid = `SPN${randomBytes(5).toString('hex').toUpperCase()}`;
  const created = await createOrderUsing(sql, {
    txnid,
    userId: 'usr_a',
    items: [
      {
        id: 'prod_1',
        name: 'Leather Case',
        quantity: 1,
        unitPrice: 1000,
        totalPrice: 1000,
      },
    ],
    subtotalPaise: 100000,
    shippingPaise: 0,
    totalPaise: 100000,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: 'Winner One',
    customerEmail: 'winner.one@example.com',
    customerPhone: '9000000000',
    shippingAddress: {
      name: 'Winner One',
      phone: '9000000000',
      line1: '1 Test Lane',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    reservationSeconds: 0,
    coupon: { code: couponCode },
  });

  assert.equal(created.order.discountPaise, 15000);
  assert.equal(created.order.totalPaise, 85000);
  assert.equal(created.order.amount, 850);
  assert.equal(created.order.couponCode, couponCode);

  // Mark coupon consumed on payment capture
  await sql.begin(async (tx) => {
    const consumed = await consumeCouponInTx(tx, created.order.id);
    assert.equal(consumed, true);
  });

  // Winner cannot reuse single-use personal coupon on a second order
  await assert.rejects(
    () =>
      createOrderUsing(sql, {
        txnid: `SPN${randomBytes(5).toString('hex').toUpperCase()}`,
        userId: 'usr_a',
        items: [
          {
            id: 'prod_1',
            name: 'Leather Case',
            quantity: 1,
            unitPrice: 1000,
            totalPrice: 1000,
          },
        ],
        subtotalPaise: 100000,
        shippingPaise: 0,
        totalPaise: 100000,
        currency: 'INR',
        paymentMethod: 'payu',
        customerName: 'Winner One',
        customerEmail: 'winner.one@example.com',
        customerPhone: '9000000000',
        shippingAddress: {
          name: 'Winner One',
          phone: '9000000000',
          line1: '1 Test Lane',
          line2: '',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
        reservationSeconds: 0,
        coupon: { code: couponCode },
      }),
    (err) => err?.name === 'CouponRejectedError' && /no longer available|limit|used/i.test(err.message),
  );

  // Day 2: same customer can spin again and win a brand-new code
  const nextDayWin = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_checkout', termsAccepted: true },
    { nowOverride: day2, rollFn: () => 0 },
  );
  assert.equal(nextDayWin.ok, true);
  assert.equal(nextDayWin.alreadySpun, false);
  assert.notEqual(nextDayWin.spin.couponCode, couponCode);
});

test('reward cooldown blocks coupon winners until expiry or custom days while allowing NO_PRIZE next day', { skip }, async () => {
  await sql`
    update spin_wheel_settings
    set reward_cooldown_mode = 'until_coupon_expires', reward_cooldown_days = 7, show_next_spin_countdown = true
    where id = 'default'
  `;
  invalidateSpinWheelCache(sql);

  const day1 = new Date('2026-11-13T08:00:00.000Z');
  const day2 = new Date('2026-11-14T08:00:00.000Z');
  const day9 = new Date('2026-11-21T08:00:00.000Z');

  // Before spinning: 1/1 quota available
  const beforeState = await getCustomerSpinStateUsing(sql, 'usr_a', { nowOverride: day1, bypassCache: true });
  assert.equal(beforeState.dailySpinsTotal, 1);
  assert.equal(beforeState.remainingSpinsToday, 1);
  assert.equal(beforeState.cooldownBlocked, false);
  assert.equal(beforeState.customerProfile?.email, 'w***@example.com');

  // Day 1: usr_a wins a 7-day coupon, usr_b lands on NO_PRIZE
  const win = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_cd_1', termsAccepted: true },
    { nowOverride: day1, rollFn: () => 0 },
  );
  assert.equal(win.ok, true);
  assert.equal(win.spin.segmentType, 'COUPON');

  const noPrize = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_b', ipHash: 'ip_cd_2', termsAccepted: true },
    { nowOverride: day1, rollFn: (total) => total - 1 },
  );
  assert.equal(noPrize.ok, true);
  assert.equal(noPrize.spin.segmentType, 'NO_PRIZE');

  // Day 2: usr_a still has an active 7-day coupon -> 0/1 quota left & blocked by reward_cooldown
  const day2State = await getCustomerSpinStateUsing(sql, 'usr_a', { nowOverride: day2, bypassCache: true });
  assert.equal(day2State.remainingSpinsToday, 0);
  assert.equal(day2State.cooldownBlocked, true);
  assert.equal(day2State.activeReward?.couponCode, win.spin.couponCode);

  const blockedDraw = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_cd_1b', termsAccepted: true },
    { nowOverride: day2, rollFn: () => 0 },
  );
  assert.equal(blockedDraw.ok, false);
  assert.equal(blockedDraw.reason, 'reward_cooldown');

  // Day 2: usr_b did not win a coupon on Day 1 -> 1/1 quota & draw succeeds
  const loserDay2State = await getCustomerSpinStateUsing(sql, 'usr_b', { nowOverride: day2, bypassCache: true });
  assert.equal(loserDay2State.remainingSpinsToday, 1);
  const loserDay2Draw = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_b', ipHash: 'ip_cd_2b', termsAccepted: true },
    { nowOverride: day2, rollFn: () => 0 },
  );
  assert.equal(loserDay2Draw.ok, true);

  // Day 9 (past 7-day coupon expiry): usr_a unblocks -> 1/1 & spin succeeds
  const day9State = await getCustomerSpinStateUsing(sql, 'usr_a', { nowOverride: day9, bypassCache: true });
  assert.equal(day9State.remainingSpinsToday, 1);
  assert.equal(day9State.cooldownBlocked, false);
  const day9Draw = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_cd_1c', termsAccepted: true },
    { nowOverride: day9, rollFn: (total) => total - 1 },
  );
  assert.equal(day9Draw.ok, true);

  // Switch to custom_days = 3 and test usr_b who won on Day 2 (day2 + 3 days = day5)
  await sql`
    update spin_wheel_settings
    set reward_cooldown_mode = 'custom_days', reward_cooldown_days = 3
    where id = 'default'
  `;
  invalidateSpinWheelCache(sql);

  const day4CustomBlocked = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_b', ipHash: 'ip_cd_2c', termsAccepted: true },
    { nowOverride: new Date('2026-11-16T08:00:00.000Z'), rollFn: () => 0 },
  );
  assert.equal(day4CustomBlocked.ok, false);
  assert.equal(day4CustomBlocked.reason, 'reward_cooldown');

  const day5CustomOpen = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_b', ipHash: 'ip_cd_2d', termsAccepted: true },
    { nowOverride: new Date('2026-11-17T08:01:00.000Z'), rollFn: (total) => total - 1 },
  );
  assert.equal(day5CustomOpen.ok, true);
});

test('missing spin_wheel_settings relation (Postgres 42P01) fails closed without crashing callers', async () => {
  const fakeMissingSchemaSql = (strings) => {
    const queryText = strings.join(' ');
    if (queryText.includes('spin_wheel_settings') || queryText.includes('spin_wheel_segments')) {
      const err = new Error('relation "spin_wheel_settings" does not exist');
      err.code = '42P01';
      return Promise.reject(err);
    }
    if (queryText.includes('db_now')) {
      return Promise.resolve([{ db_now: new Date().toISOString() }]);
    }
    return Promise.resolve([{ tz: 'Asia/Kolkata' }]);
  };

  const cfg = await getSpinWheelConfigUsing(fakeMissingSchemaSql, { bypassCache: true });
  assert.equal(cfg.settings.enabled, false);
  assert.deepEqual(cfg.segments, []);
  assert.equal(cfg.schemaMissing, true);

  const state = await getCustomerSpinStateUsing(fakeMissingSchemaSql, 'usr_a', { bypassCache: true });
  assert.equal(state.available, false);
  assert.equal(state.isOpen, false);
  assert.equal(state.remainingSpinsToday, 0);
  assert.deepEqual(state.segments, []);
});

test('concurrent spins from different customers do not queue behind one segment lock', { skip }, async () => {
  await sql`
    update spin_wheel_segments
    set daily_cap = 5, total_cap = 5
    where id = 'seg_prize'
  `;
  invalidateSpinWheelCache(sql);

  const now = new Date('2026-11-13T10:00:00.000Z');
  let signalHookEntered;
  const hookEntered = new Promise((resolve) => {
    signalHookEntered = resolve;
  });
  let releaseCustomerA;
  const holdCustomerA = new Promise((resolve) => {
    releaseCustomerA = resolve;
  });
  let locksBeforeCounter = [];

  const spinAPromise = executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_lock_a', termsAccepted: true },
    {
      nowOverride: now,
      rollFn: () => 0,
      lockTimeoutMs: 500,
      beforeCounterHook: async ({ tx }) => {
        locksBeforeCounter = await tx`
          select c.relname, l.mode
          from pg_locks l
          join pg_class c on c.oid = l.relation
          where l.pid = pg_backend_pid()
            and c.relname in ('spin_wheel_segments', 'spin_wheel_segment_daily_counts')
            and l.mode <> 'AccessShareLock'
        `;
        signalHookEntered();
        await holdCustomerA;
      },
    },
  );

  let resB;
  let resC;
  try {
    // Wait until usr_a is paused inside its open transaction BEFORE counter updates.
    await hookEntered;

    assert.equal(
      locksBeforeCounter.length,
      0,
      `expected zero write/row-share segment/counter locks mid-transaction, got ${JSON.stringify(locksBeforeCounter)}`,
    );

    // With only a 250ms lock timeout, usr_b and usr_c must finish completely while usr_a is STILL paused.
    [resB, resC] = await Promise.all([
      executeSpinDrawUsing(
        sql,
        { userId: 'usr_b', ipHash: 'ip_lock_b', termsAccepted: true },
        { nowOverride: now, rollFn: () => 0, lockTimeoutMs: 250 },
      ),
      executeSpinDrawUsing(
        sql,
        { userId: 'usr_c', ipHash: 'ip_lock_c', termsAccepted: true },
        { nowOverride: now, rollFn: () => 0, lockTimeoutMs: 250 },
      ),
    ]);
  } finally {
    // Always release usr_a so the open transaction cannot dangle if an assertion fails.
    releaseCustomerA();
  }

  const resA = await spinAPromise;
  assert.equal(resB.ok, true);
  assert.equal(resC.ok, true);
  assert.equal(resB.spin.segmentId, 'seg_prize');
  assert.equal(resC.spin.segmentId, 'seg_prize');
  assert.equal(resA.ok, true);
  assert.equal(resA.spin.segmentId, 'seg_prize');

  const [segRow] = await sql`
    select total_awarded from spin_wheel_segments where id = 'seg_prize'
  `;
  const [dailyRow] = await sql`
    select awarded_count from spin_wheel_segment_daily_counts where segment_id = 'seg_prize'
  `;
  assert.equal(Number(segRow.total_awarded), 3);
  assert.equal(Number(dailyRow.awarded_count), 3);
});

test('executeSpinDrawUsing enforces botCheck hook and getHomeSpinSurfaceUsing runs 0 extra DB queries for signed-out visitors', { skip }, async () => {
  const blocked = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_bot_1', termsAccepted: true },
    {
      botCheck: async () => ({ ok: false, error: 'Blocked by bot check' }),
    },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'bot_check_failed');
  assert.equal(blocked.error, 'Blocked by bot check');

  const [{ cnt: spinCount }] = await sql`select count(*)::int as cnt from spin_wheel_spins`;
  assert.equal(spinCount, 0);

  // Warm the 5s config cache on spySql itself (WeakMap keys by sql handle),
  // confirming cold read issues exactly 3 config queries and warm signed-out reads issue 0.
  let queryCount = 0;
  const spySql = new Proxy(sql, {
    apply(target, thisArg, args) {
      queryCount += 1;
      return Reflect.apply(target, thisArg, args);
    },
  });

  invalidateSpinWheelCache(spySql);
  const coldGuestSurface = await getHomeSpinSurfaceUsing(spySql, null);
  assert.equal(coldGuestSurface.banner.show, true);
  assert.equal(queryCount, 3);

  queryCount = 0;
  const cachedGuestSurface = await getHomeSpinSurfaceUsing(spySql, null);
  assert.equal(queryCount, 0);
  assert.equal(cachedGuestSurface.banner.show, true);
  assert.equal(cachedGuestSurface.spinState.signedIn, false);
});

test('Spin FREE_GIFT win issues personal single-use coupon, attaches ₹0 gift on checkout, and redirects OOS rolls strictly to NO_PRIZE', { skip }, async () => {
  await sql`
    insert into products (id, category_id, slug, name, price_paise, in_stock, is_active, is_gift_only)
    values ('gift_pouch', 'cat_1', 'gift-pouch', 'Gift Travel Pouch', 49900, true, true, true)
  `;
  await sql`
    insert into stock (id, product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory)
    values ('stk_gift_pouch', 'gift_pouch', null, 1, 0, 0, true)
  `;

  await sql`
    update spin_wheel_segments
    set segment_type = 'FREE_GIFT',
        label = 'Free Pouch',
        weight = 5000,
        gift_product_id = 'gift_pouch',
        gift_variant_id = null,
        gift_min_order_paise = 50000,
        gift_valid_days = 7,
        coupon_type = null
    where id = 'seg_prize'
  `;
  invalidateSpinWheelCache(sql);

  const win = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_a', ipHash: 'ip_fg_1', termsAccepted: true },
    { nowOverride: new Date('2026-11-13T09:00:00.000Z'), rollFn: () => 0 },
  );
  assert.equal(win.ok, true);
  assert.equal(win.spin.segmentType, 'FREE_GIFT');
  assert.equal(win.spin.giftProductId, 'gift_pouch');
  assert.equal(win.spin.giftProductName, 'Gift Travel Pouch');
  assert.ok(win.spin.couponCode?.startsWith('SPIN-'));

  // Winner sees the FREE_GIFT coupon in customer coupons
  const winnerCoupons = await listCustomerCouponsUsing(sql, 'usr_a', async () => ({
    ok: true,
    settings: { coupons_enabled: 'on' },
  }));
  const giftCoupon = winnerCoupons.find((c) => c.code === win.spin.couponCode);
  assert.ok(giftCoupon);
  assert.equal(giftCoupon.type, 'FREE_GIFT');
  assert.equal(giftCoupon.giftProductId, 'gift_pouch');

  // Checkout claims the single remaining gift unit at ₹0 while charging paid case price
  const txnid = `SPFG${randomBytes(5).toString('hex').toUpperCase()}`;
  const created = await createOrderUsing(sql, {
    txnid,
    userId: 'usr_a',
    items: [
      { id: 'prod_1', name: 'Leather Case', quantity: 1, unitPrice: 999, totalPrice: 999 },
    ],
    subtotalPaise: 99900,
    shippingPaise: 0,
    totalPaise: 99900,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: 'Winner One',
    customerEmail: 'winner.one@example.com',
    customerPhone: '9000000000',
    shippingAddress: {
      name: 'Winner One',
      phone: '9000000000',
      line1: '1 Test Lane',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    reservationSeconds: 0,
    coupon: { code: win.spin.couponCode },
  });

  assert.equal(created.order.totalPaise, 99900);
  const giftItems = await sql`
    select * from order_items where order_id = ${created.order.id} and is_free_gift = true
  `;
  assert.equal(giftItems.length, 1);
  assert.equal(giftItems[0].product_id, 'gift_pouch');
  assert.equal(Number(giftItems[0].unit_price_paise), 0);
  assert.equal(giftItems[0].free_gift_source, 'spin_wheel');

  // Checkout claimed the single remaining unit (`on_hand` dropped 1 -> 0) -> next customer's roll into FREE_GIFT redirects strictly to uncapped NO_PRIZE
  const [stkRow] = await sql`select on_hand, reserved from stock where product_id = 'gift_pouch'`;
  assert.equal(Number(stkRow.on_hand), 0);

  const secondSpin = await executeSpinDrawUsing(
    sql,
    { userId: 'usr_b', ipHash: 'ip_fg_2', termsAccepted: true },
    { nowOverride: new Date('2026-11-13T09:05:00.000Z'), rollFn: () => 0 },
  );
  assert.equal(secondSpin.ok, true);
  assert.equal(secondSpin.spin.segmentType, 'NO_PRIZE');
  assert.equal(secondSpin.spin.couponCode, null);
});

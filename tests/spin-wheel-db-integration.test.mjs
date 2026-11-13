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
    max: schema ? 3 : 1,
    idle_timeout: 20,
    connect_timeout: 25,
    max_lifetime: 1800,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: schema ? { search_path: schema } : { search_path: 'pg_catalog' },
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  executeSpinDrawUsing,
  getCustomerSpinStateUsing,
  invalidateSpinWheelCache,
} = await jiti.import(path.join(root, 'src', 'lib', 'spin-wheel', 'store.ts'));

const {
  exportSpinWheelCsvUsing,
  getSpinWheelAdminDataUsing,
  runStaffTestSpinUsing,
  saveSpinWheelConfigUsing,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'spin-wheel.ts'));

const { listCustomerCouponsUsing } = await jiti.import(
  path.join(root, 'src', 'lib', 'account', 'coupons.ts'),
);

const { lookupCouponForCart } = await jiti.import(
  path.join(root, 'src', 'lib', 'coupons', 'store.ts'),
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
    'orders',
    'products',
    'categories',
    'coupons',
    'coupon_targets',
    'coupon_redemptions',
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
  if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  if (setupSql) {
    await dropFixtureSchema(setupSql, SCHEMA).catch(() => {});
    await setupSql.end({ timeout: 2 }).catch(() => {});
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
      coupon_redemptions,
      coupon_targets,
      coupons,
      orders,
      products,
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
      terms_text, max_spins_per_ip_per_day, min_account_age_minutes, show_on_home_page
    ) values (
      'default', true, 'Spin and Win', 'Win a personal reward today.', 1,
      'One spin per customer per day.', 1, 0, true
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
        'seg_prize', '15% off', '#ffe100', 'COUPON', 50, null, null,
        true, 0, 'PERCENT', 15,
        30000, 50000,
        'ORDER', '{}', 7, false
      ),
      (
        'seg_nope', 'Try tomorrow', '#111111', 'NO_PRIZE', 50, null, null,
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
    { nowOverride: new Date('2026-11-13T11:00:00.000Z'), rollFn: () => 60 }, // lands on seg_nope
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
          weight: 25,
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
          weight: 75,
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

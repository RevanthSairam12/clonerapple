import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { customerCanDiscoverCoupon, customerCouponView } = await jiti.import(path.join(root, 'src/lib/account/coupon-rules.ts'));
const { listCustomerCouponsUsing, getCustomerCouponCountUsing } = await jiti.import(path.join(root, 'src/lib/account/coupons.ts'));
const { evaluateCoupon } = await jiti.import(path.join(root, 'src/lib/coupons/rules.ts'));
const { formatPaise } = await jiti.import(path.join(root, 'src/lib/store-admin/amount.ts'));

const NOW = new Date('2026-11-02T10:00:00Z');
const USER = { userId: 'customer_a', email: 'buyer@example.com', group: 'vip' };
const enabled = async () => ({ ok: true, settings: { coupons_enabled: 'on' } });
function coupon(overrides = {}) {
  return {
    id: 'coupon_a', code: 'SAVE10', type: 'PERCENT', value: 10, scope: 'ORDER',
    status: 'active', startsAt: null, endsAt: null, totalRedemptionLimit: null,
    perCustomerLimit: null, minOrderPaise: 0, onlyNewCustomers: false,
    restrictedToEmails: [], allowedCustomerGroups: [],
    showToAllUsers: false, assignedToEmails: [], assignedCustomerGroups: [],
    ...overrides,
  };
}
function context(overrides = {}) {
  return { now: NOW, customer: USER, customerPaidOrderExists: false,
    customerRedemptions: 0, totalRedemptions: 0, ...overrides };
}
function visible(overrides = {}, ctx = {}, isEnabled = true) {
  return customerCanDiscoverCoupon(coupon(overrides), context(ctx), isEnabled);
}
function row(overrides = {}) {
  return {
    id: 'coupon_a', code: 'SAVE10', type: 'PERCENT', value: 10, scope: 'ORDER',
    status: 'active', starts_at: null, ends_at: null, total_redemption_limit: null,
    per_customer_limit: null, min_order_paise: 0, only_new_customers: false,
    restricted_to_emails: [], allowed_customer_groups: [], show_to_all_users: true,
    assigned_to_emails: [], assigned_customer_groups: [], total_used: 0, mine_used: 0,
    database_now: NOW, ...overrides,
  };
}
/** No DB connection: a query-injected adapter exercises the real selection/DTO path. */
function queries(rows, users = [{ email: ' BUYER@Example.com ', customer_group: 'VIP', has_paid_order: false }]) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    calls.push({ query, values });
    if (query.includes('from users u')) return users;
    if (query.includes('with candidates as')) return rows;
    throw new Error('Unexpected query');
  };
  return { sql, calls };
}

test('discovery defaults hidden; redemption restrictions alone do not assign a coupon', () => {
  assert.equal(visible(), false);
  assert.equal(visible({ restrictedToEmails: [USER.email], allowedCustomerGroups: ['vip'] }), false);
});

test('public, normalized email and normalized group are independent OR discovery grants', () => {
  for (const grant of [
    { showToAllUsers: true },
    { assignedToEmails: [' BUYER@EXAMPLE.COM '] },
    { assignedCustomerGroups: [' VIP '] },
    { showToAllUsers: true, assignedToEmails: [USER.email], assignedCustomerGroups: ['vip'] },
  ]) assert.equal(visible(grant), true);
  assert.equal(visible({ assignedToEmails: ['other@example.com'], assignedCustomerGroups: ['retail'] }), false);
});

test('public/assignment grants never bypass the AND of email and group redemption restrictions', () => {
  const restricted = { restrictedToEmails: [USER.email], allowedCustomerGroups: ['wholesale'] };
  for (const grant of [{ showToAllUsers: true }, { assignedToEmails: [USER.email] }, { assignedCustomerGroups: ['vip'] }]) {
    assert.equal(visible({ ...restricted, ...grant }), false);
    assert.equal(visible({ ...restricted, ...grant, allowedCustomerGroups: [' VIP '] }), true);
    assert.equal(visible({ ...restricted, ...grant, restrictedToEmails: ['other@example.com'] }), false);
  }
});

test('global disablement and missing authenticated identity fail closed', () => {
  assert.equal(visible({ showToAllUsers: true }, {}, false), false);
  assert.equal(visible({ showToAllUsers: true }, { customer: { ...USER, userId: null } }), false);
});

test('paid-order and RESERVED/CONSUMED count context enforce new-customer and usage limits', () => {
  assert.equal(visible({ showToAllUsers: true, onlyNewCustomers: true }, { customerPaidOrderExists: true }), false);
  assert.equal(visible({ showToAllUsers: true, onlyNewCustomers: true }), true);
  assert.equal(visible({ showToAllUsers: true, totalRedemptionLimit: 3 }, { totalRedemptions: 3 }), false);
  assert.equal(visible({ showToAllUsers: true, perCustomerLimit: 2 }, { customerRedemptions: 2 }), false);
  assert.equal(visible({ showToAllUsers: true, perCustomerLimit: 2, totalRedemptionLimit: 3 }, { customerRedemptions: 1, totalRedemptions: 2 }), true);
  assert.equal(visible({ showToAllUsers: true, totalRedemptionLimit: 0 }), false);
});

test('status and date window use supplied database time, start inclusive and end exclusive', () => {
  for (const status of ['paused', 'archived']) assert.equal(visible({ showToAllUsers: true, status }), false);
  assert.equal(visible({ showToAllUsers: true, startsAt: NOW }), true);
  assert.equal(visible({ showToAllUsers: true, startsAt: '2026-11-02T10:00:01Z' }), false);
  assert.equal(visible({ showToAllUsers: true, endsAt: NOW }), false);
  assert.equal(visible({ showToAllUsers: true, endsAt: '2026-11-02T10:00:01Z' }), true);
  assert.equal(visible({ showToAllUsers: true }, { now: new Date('invalid') }), false);
});

test('unlimited personal uses remain null even with a global limit; limited uses show personal remainder only', () => {
  assert.equal(customerCouponView(coupon({ totalRedemptionLimit: 1 }), 100).remainingUses, null);
  assert.equal(customerCouponView(coupon(), 100).remainingDisplay, 'Available');
  assert.equal(customerCouponView(coupon({ perCustomerLimit: 3 }), 1).remainingDisplay, '2 uses remaining');
  assert.equal(customerCouponView(coupon({ perCustomerLimit: 3 }), 2).remainingDisplay, '1 use remaining');
});

test('uppercase discount types and scopes use the shared paise formatter', () => {
  assert.equal(customerCouponView(coupon(), 0).valueDisplay, '10% off');
  assert.equal(customerCouponView(coupon({ type: 'FIXED', value: 12345678 }), 0).valueDisplay, `${formatPaise(12345678)} off`);
  assert.equal(customerCouponView(coupon({ type: 'FREE_SHIPPING', value: 0 }), 0).valueDisplay, 'Free shipping');
  for (const [scope, label] of Object.entries({ ORDER: 'Entire order', PRODUCTS: 'Selected products', CATEGORIES: 'Selected categories', BRANDS: 'Selected brands' })) {
    assert.equal(customerCouponView(coupon({ scope }), 0).scopeDisplay, label);
  }
  assert.equal(customerCouponView(coupon({ minOrderPaise: 10001 }), 0).minOrderDisplay, `${formatPaise(10001)} min. order`);
  assert.equal(customerCouponView(coupon(), 0).minOrderDisplay, 'No minimum');
});

test('DTO has an exact safe key allowlist, stable expiry and no recipient/restriction/global data', () => {
  const view = customerCouponView(coupon({ name: 'SECRET', endsAt: '2026-11-03T01:00:00Z', assignedToEmails: [USER.email], totalRedemptionLimit: 80 }), 0);
  assert.deepEqual(Object.keys(view).sort(), ['id', 'code', 'type', 'valueDisplay', 'scopeDisplay', 'minOrderPaise', 'minOrderDisplay', 'expiresAt', 'expiryDisplay', 'remainingUses', 'remainingDisplay'].sort());
  assert.equal(view.expiresAt, '2026-11-03T01:00:00.000Z');
  assert.equal(view.expiryDisplay, 'Expires 3 Nov 2026');
  assert.doesNotMatch(JSON.stringify(view), /SECRET|buyer@example.com|totalRedemptionLimit/);
});

test('cart conditions do not prevent discovery; hidden known codes remain redeemable', () => {
  assert.equal(visible({ showToAllUsers: true, minOrderPaise: 500000, scope: 'PRODUCTS' }), true);
  const hidden = coupon({ name: 'Internal', allowWithSalePrice: true, maxDiscountPaise: null, targets: [] });
  const ctx = { ...context(), subtotalPaise: 10000, shippingPaise: 0 };
  assert.equal(customerCanDiscoverCoupon(hidden, ctx, true), false);
  const result = evaluateCoupon({ coupon: hidden, context: ctx, lines: [{ productId: 'p', categoryId: null, brandId: null, quantity: 1, unitPaise: 10000, linePaise: 10000, onSale: false }] });
  assert.equal(result.ok, true);
  assert.equal(result.discountPaise, 1000);
});

test('real selection seam deduplicates overlapping grants, normalizes DB identity and has list/count parity', async () => {
  const fixture = queries([
    row({ show_to_all_users: false, assigned_to_emails: ['buyer@example.com'], assigned_customer_groups: ['vip'], per_customer_limit: 4, mine_used: 2 }),
    row({ id: 'hidden', show_to_all_users: false }),
    row({ id: 'restricted', allowed_customer_groups: ['wholesale'] }),
  ]);
  const result = await listCustomerCouponsUsing(fixture.sql, USER.userId, enabled);
  assert.equal(result.length, 1);
  assert.equal(result[0].remainingUses, 2);
  assert.equal(await getCustomerCouponCountUsing(fixture.sql, USER.userId, enabled), result.length);
  assert.equal(fixture.calls.length, 4, 'two queries per call, independent of coupon count');
  assert.ok(fixture.calls[1].values.includes('buyer@example.com'));
  assert.ok(fixture.calls[1].values.includes('vip'));
});

test('selection query count stays constant for 200 coupons, with no per-coupon calls', async () => {
  const fixture = queries(Array.from({ length: 200 }, (_, index) => row({ id: `coupon_${index}` })));
  assert.equal((await listCustomerCouponsUsing(fixture.sql, USER.userId, enabled)).length, 200);
  assert.equal(fixture.calls.length, 2);
  // Contract checks supplement behavioral query-count coverage; real PostgreSQL proof is separate.
  assert.match(fixture.calls[1].query, /state in \('RESERVED', 'CONSUMED'\)/);
  assert.match(fixture.calls[1].query, /now\(\) as database_now/);
  assert.match(fixture.calls[1].query, /customer_user_id = \?/);
  assert.match(fixture.calls[1].query, /lower\(r.customer_email\) = \?/);
});

test('settings unavailable/off/malformed, missing user and missing session never expose coupons', async () => {
  for (const settings of [{ ok: false, reason: 'unavailable' }, { ok: true, settings: { coupons_enabled: 'off' } }, { ok: true, settings: { coupons_enabled: 'invalid' } }]) {
    const fixture = queries([row()]);
    assert.deepEqual(await listCustomerCouponsUsing(fixture.sql, USER.userId, async () => settings), []);
    assert.equal(await getCustomerCouponCountUsing(fixture.sql, USER.userId, async () => settings), 0);
    assert.equal(fixture.calls.length, 0);
  }
  const missing = queries([row()], []);
  assert.deepEqual(await listCustomerCouponsUsing(missing.sql, USER.userId, enabled), []);
  assert.equal(missing.calls.length, 1);
  assert.deepEqual(await listCustomerCouponsUsing(missing.sql, '', enabled), []);
  assert.equal(missing.calls.length, 1);
});

test('successive authenticated customers never share assignment results or cached identity', async () => {
  const rows = [row({ show_to_all_users: false, assigned_to_emails: [USER.email] })];
  const a = queries(rows);
  const b = queries(rows, [{ email: 'other@example.com', customer_group: 'retail', has_paid_order: false }]);
  assert.equal((await listCustomerCouponsUsing(a.sql, 'customer_a', enabled)).length, 1);
  assert.equal((await listCustomerCouponsUsing(b.sql, 'customer_b', enabled)).length, 0);
  assert.equal((await listCustomerCouponsUsing(a.sql, 'customer_a', enabled)).length, 1);
  assert.equal(a.calls[0].values[0], 'customer_a');
  assert.equal(b.calls[0].values[0], 'customer_b');
});

test('selection uses returned database clock and paid-order/usage context for exclusions', async () => {
  const fixture = queries([
    row({ id: 'future', starts_at: new Date(NOW.getTime() + 1) }),
    row({ id: 'expired', ends_at: NOW }),
    row({ id: 'new-only', only_new_customers: true }),
    row({ id: 'total-used', total_redemption_limit: 1, total_used: 1 }),
    row({ id: 'mine-used', per_customer_limit: 1, mine_used: 1 }),
    row({ id: 'remaining', per_customer_limit: 2, mine_used: 1 }),
  ], [{ email: USER.email, customer_group: 'vip', has_paid_order: true }]);
  assert.deepEqual((await listCustomerCouponsUsing(fixture.sql, USER.userId, enabled)).map((entry) => entry.id), ['remaining']);
});

test('coupons page remains guarded and force-dynamic', async () => {
  const page = await readFile(path.join(root, 'src/app/account/coupons/page.tsx'), 'utf8');
  assert.match(page, /requireAccountPageSession\('\/account\/coupons'\)/);
  assert.match(page, /export\s+const\s+dynamic\s*=\s*'force-dynamic'/);
});

/**
 * Coupon wiring guards.
 *
 * These are structural tests: they pin the places that must not quietly drift.
 * The coupon tables ship with RLS and no policies, every store-admin route is
 * role-guarded and audited, the validation endpoint is a preview that writes
 * nothing and leaks nothing, checkout sends only a code, the storefront never
 * stores a discount, and POS never touches coupons at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function source(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function filesUnder(relative) {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path.relative(root, full))));
    else if (entry.name === 'route.ts') found.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return found;
}

/* ----------------------------------------------------------- migration */

test('0041 enables RLS on every coupon table and creates no policies', async () => {
  const migration = await source('migrations/0041_coupons.sql');
  const tables = ['coupons', 'coupon_targets', 'coupon_redemptions'];

  for (const table of tables) {
    assert.match(
      migration,
      new RegExp(`create table if not exists ${table}\\b`),
      `${table} must be created here`,
    );
    assert.match(
      migration,
      new RegExp(`alter table ${table}\\s+enable row level security`),
      `${table} must ship with RLS enabled`,
    );
  }
  assert.equal((migration.match(/enable row level security/g) ?? []).length, 3);

  // No policies: only the server, which connects as the owner, may read them.
  assert.doesNotMatch(migration, /create policy|create or replace policy|drop policy/i);
  assert.doesNotMatch(migration, /\bdelete from\b|\bdrop table\b/i);

  // The unique code lives on the normalized form even if a row is written
  // outside this app.
  assert.match(migration, /create unique index if not exists idx_coupons_code_upper\s+on coupons \(upper\(code\)\)/);
  assert.match(migration, /check \(code = upper\(code\)\)/);
  assert.match(migration, /check \(num_nonnulls\(product_id, category_id, brand_id\) = 1\)/);
  assert.match(migration, /unique \(coupon_id, order_id\)/);
  assert.match(migration, /state in \('RESERVED', 'CONSUMED', 'RELEASED'\)/);
});

test('the order carries one coupon, its snapshot and a per-line discount', async () => {
  const migration = await source('migrations/0041_coupons.sql');
  assert.match(migration, /alter table orders\s+add column if not exists coupon_id text,\s+add column if not exists coupon_snapshot jsonb/);
  assert.match(migration, /alter table order_items\s+add column if not exists discount_paise bigint not null default 0/);
  assert.match(migration, /check \(discount_paise >= 0 and discount_paise <= line_total_paise\)/);

  // One coupon per order — there is no join table or list column that would
  // let a second code stack.
  assert.doesNotMatch(migration, /coupon_id\s+text\[\]|order_coupons/);
});

/* ------------------------------------------------------ store admin API */

test('every coupon store-admin route is role-guarded, audited and same-origin', async () => {
  const routes = [
    ...(await filesUnder('src/app/api/store-admin/coupons')),
    ...(await filesUnder('src/app/api/store-admin/reports/coupon-usage')),
  ];
  assert.ok(routes.length >= 6, 'expected the coupon and report routes');

  for (const route of routes) {
    const text = await source(route);
    assert.match(text, /requireStoreRole\(/, `${route} must guard with requireStoreRole`);
    const transactionalServices = {
      'src/app/api/store-admin/coupons/route.ts': 'createCoupon',
      'src/app/api/store-admin/coupons/[id]/route.ts': 'updateCoupon',
      'src/app/api/store-admin/coupons/[id]/duplicate/route.ts': 'duplicateCoupon',
      'src/app/api/store-admin/coupons/bulk/route.ts': 'bulkGenerateCoupons',
      'src/app/api/store-admin/coupons/visibility/route.ts': 'setCouponsVisibility',
    };
    const service = transactionalServices[route];
    if (service) {
      assert.match(text, new RegExp(`await ${service}\\(`), `${route} delegates to its audited transaction`);
      assert.match(text, /actorId: guard\.session\.adminId/);
      assert.match(text, /actorEmail: guard\.session\.email, request/);
      const lib = await source('src/lib/store-admin/coupons.ts');
      const start = lib.indexOf(`export async function ${service}(`);
      const end = lib.indexOf('\nexport ', start + 1);
      const implementation = lib.slice(start, end < 0 ? undefined : end);
      assert.match(implementation, /sql\.begin\(async \(tx\) =>/);
      assert.match(implementation, /await auditCoupon\(tx, actor,/);
    } else {
      assert.match(text, /writeAudit\(/, `${route} must write an audit row`);
    }

    const mutating = /export async function (POST|PATCH|PUT|DELETE)/.test(text);
    if (mutating) {
      assert.match(text, /assertSameOrigin\(/, `${route} must assert same-origin`);
    } else {
      assert.doesNotMatch(text, /assertSameOrigin\(/, `${route} is a read and needs no origin check`);
    }
  }
});

test('the route guard script lists every new route', async () => {
  const script = await source('scripts/check-store-admin-routes.mjs');
  for (const route of [
    'coupons/route.ts',
    'coupons/[id]/route.ts',
    'coupons/[id]/status/route.ts',
    'coupons/[id]/duplicate/route.ts',
    'coupons/bulk/route.ts',
    'coupons/export/route.ts',
    'coupons/visibility/route.ts',
    'reports/coupon-usage/export/route.ts',
  ]) {
    assert.ok(script.includes(route), `${route} is missing from the guard script`);
  }
});

test('DELETE archives an unused coupon and refuses one that was used', async () => {
  const route = await source('src/app/api/store-admin/coupons/[id]/route.ts');
  assert.match(route, /export async function DELETE/);
  assert.match(route, /archiveCouponOnDelete\(id\)/);
  assert.match(route, /code: 'coupon_in_use'/);
  assert.match(route, /deleted: false/);
  assert.match(route, /action: 'coupon\.archive'/);

  const lib = await source('src/lib/store-admin/coupons.ts');
  assert.match(lib, /from coupon_redemptions\s+where coupon_id/);
  assert.match(lib, /Archive it instead/);
  assert.match(lib, /set status = 'archived', archived_at =/);
  // DELETE never removes a row; no hard delete exists in the coupon store.
  assert.doesNotMatch(lib, /delete from coupons/i);
});

test('the coupon box shows the server message, including the sale note', async () => {
  const box = await source('src/components/cart/CouponBox.tsx');
  assert.match(box, /\{coupon\.message\}/);

  const rules = await source('src/lib/coupons/rules.ts');
  assert.match(rules, /'Not valid on sale items\.'/);
  assert.match(rules, /'This code does not take anything off this order\.'/);
  assert.match(rules, /return reject\('no_discount'\)/);

  // The preview answers with the evaluation's own message, so the sentence the
  // rules produce is the sentence the bag renders.
  const validate = await source('src/app/api/coupons/validate/route.ts');
  assert.match(validate, /message: result\.evaluation\.message/);
});

test('the coupon audit never records the restricted email addresses', async () => {
  const rules = await source('src/lib/store-admin/coupon-rules.ts');
  assert.match(rules, /restrictedEmails: values\.restrictedToEmails\?\.length \?\? 0/);
  assert.match(rules, /customerGroups: values\.allowedCustomerGroups\?\.length \?\? 0/);
});

/* ------------------------------------------------------- validate route */

test('the validation endpoint is same-origin, rate-limited and never cached', async () => {
  const route = await source('src/app/api/coupons/validate/route.ts');
  assert.match(route, /assertSameOrigin\(req\)/);
  assert.match(route, /coupon-validate-ip:/);
  assert.match(route, /coupon-validate-user:/);
  assert.match(route, /limit: 10/);
  assert.match(route, /windowMs: 60 \* 1000/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /lookupCouponForCart\(/);
});

test('the validation endpoint is a preview: it writes nothing and leaks nothing', async () => {
  const route = await source('src/app/api/coupons/validate/route.ts');
  assert.doesNotMatch(route, /insertReservedRedemption|consumeCouponInTx|releaseCouponInTx/);
  assert.doesNotMatch(route, /insert into|update |delete from/i);

  for (const forbidden of [
    'couponId',
    'coupon_id',
    'redemptionId',
    'targets',
    'restrictedToEmails',
    'allowedCustomerGroups',
    'totalRedemptionLimit',
    'perCustomerLimit',
    'totalRedemptions',
    'customerRedemptions',
  ]) {
    assert.ok(!route.includes(forbidden), `the response must not expose ${forbidden}`);
  }

  // A failure in the coupon tables falls back to no discount, never a made-up
  // one, and checkout keeps working without the code.
  assert.match(route, /catch[\s\S]*?Coupons are temporarily unavailable/);
});

/* ---------------------------------------------------------------- checkout */

test('checkout sends only the code and a comparison total', async () => {
  const route = await source('src/app/api/payu/initiate/route.ts');
  assert.match(route, /const rawCouponCode = body\.couponCode/);
  assert.match(route, /typeof rawCouponCode !== 'string' \|\| !isValidCouponCode/);
  assert.match(route, /const expectedTotal = body\.expectedTotalPaise/);
  assert.match(route, /Number\.isSafeInteger\(expectedTotal\)/);
  assert.match(route, /coupon: couponCode\s*\?/);
  assert.match(route, /code: 'coupon_invalid'/);
  assert.match(route, /code: 'coupon_unavailable'/);
  assert.doesNotMatch(route, /body\.(discountPaise|discount|couponId|totalPaise)\b/);
});

test('the storefront revalidates before Pay and handles every refusal', async () => {
  const form = await source('src/components/checkout/CheckoutForm.tsx');
  assert.match(form, /useCoupon\(/);
  assert.match(form, /await coupon\.revalidate\(\)/);
  assert.match(form, /couponCode: checkedCoupon\?\.code/);
  assert.match(form, /expectedTotalPaise: acceptedTotalPaise/);
  assert.match(form, /data\.code === 'coupon_invalid'/);
  assert.match(form, /data\.code === 'coupon_unavailable'/);
  assert.match(form, /coupon\.remove\(\)/);
  assert.match(form, /<CouponBox/);
});

test('the bag shows the same box and totals', async () => {
  const bag = await source('src/components/cart/CartPageView.tsx');
  assert.match(bag, /useCoupon\(/);
  assert.match(bag, /<CouponBox/);
  assert.match(bag, /coupon\.totals\.totalPaise/);
  assert.match(bag, /discountAmount/);
});

test('the Coupons setting hides the box and skips validation', async () => {
  for (const file of [
    'src/app/cart/page.tsx',
    'src/app/bag/page.tsx',
    'src/app/checkout/page.tsx',
  ]) {
    const text = await source(file);
    assert.match(text, /coupons_enabled === 'on'|isOn\(checkoutConfiguration\.settings\.coupons_enabled\)/, `${file} must pass the setting`);
  }

  const bag = await source('src/components/cart/CartPageView.tsx');
  assert.match(bag, /enabled: Boolean\(shippingPolicy\) && couponsEnabled/);
  assert.match(bag, /couponsEnabled &&/);

  const form = await source('src/components/checkout/CheckoutForm.tsx');
  assert.match(form, /enabled: Boolean\(shippingPolicy\) && couponsEnabled/);
  assert.match(form, /couponsEnabled \? await coupon\.revalidate\(\) : null/);
  assert.match(form, /couponsEnabled &&/);
});

test('the client stores the code only, never a discount', async () => {
  const hook = await source('src/lib/cart/useCoupon.ts');
  assert.match(hook, /localStorage\.setItem\(STORAGE_KEY, code\)/);
  assert.doesNotMatch(hook, /setItem\(STORAGE_KEY, JSON\.stringify/);
  assert.doesNotMatch(hook, /discountPaise[\s\S]{0,80}setItem/);
  assert.match(hook, /\/api\/coupons\/validate/);
  // Revalidation is debounced so the rate-limited endpoint is not hammered by
  // typing.
  assert.match(hook, /setTimeout\(/);
});

/* ------------------------------------------------------------ POS / others */

test('POS never mentions or uses a coupon', async () => {
  for (const file of ['src/lib/store-admin/pos.ts', 'src/lib/store-admin/pos-rules.ts']) {
    const text = await source(file);
    assert.doesNotMatch(text, /coupon/i, `${file} must not know about coupons`);
  }
  for (const route of await filesUnder('src/app/api/store-admin/pos')) {
    const text = await source(route);
    assert.doesNotMatch(text, /coupon/i, `${route} must not accept a coupon`);
  }
});

test('order notifications carry only the code and the discount amount', async () => {
  const templates = await source('src/lib/notifications/templates.ts');
  assert.ok(templates.includes("'coupon_code'"));
  assert.ok(templates.includes("'discount_amount'"));
  assert.match(templates, /coupon_code: text\(input\.couponCode\)/);
  assert.match(templates, /discount_amount: money\(input\.discountPaise\)/);

  const context = await source('src/lib/notifications/order-context.ts');
  assert.match(context, /couponCode: order\.couponCode \?\? null/);
  assert.match(context, /discountPaise: order\.discountPaise \?\? 0/);

  // Nothing else about the coupon reaches a template.
  assert.doesNotMatch(templates, /couponId|coupon_id|redemption/i);
});

test('returns refund the net-of-discount line value', async () => {
  const returns = await source('src/lib/store-admin/returns.ts');
  assert.match(returns, /line_total_paise - oi\.discount_paise/);
  assert.match(returns, /releaseConsumedCouponOnRefund/);
  assert.match(returns, /refunds_restore_coupon/);
});

test('the reconcile worker releases and restores coupon uses with the stock hold', async () => {
  const orders = await source('src/lib/payu/orders.ts');
  assert.match(orders, /releaseCouponInTx\(tx, current\.id, releaseReason\)/);
  assert.match(orders, /restoreCouponAfterLatePayment\(tx, current\.id\)/);
  assert.match(orders, /consumeCouponInTx\(tx, current\.id\)/);
  assert.match(orders, /couponReviewRequired/);
});

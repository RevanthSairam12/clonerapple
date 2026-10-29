/**
 * Coupon rules.
 *
 * The discount is decided once, in `evaluateCoupon`, from a definition, the
 * resolved cart lines and a context whose clock and counts come from
 * PostgreSQL. These tests pin the money rules (percent cap, fixed, free
 * shipping, allocation, the ₹1 floor), the validity window, customer
 * eligibility, scope and sale-price handling, and the promise that a refusal
 * never reveals coupon internals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  COUPON_CODE_PATTERN,
  MIN_PAYABLE_PAISE,
  allocateDiscount,
  couponRejectionMessage,
  couponSnapshot,
  evaluateCoupon,
  isValidCouponCode,
  lineMatchesScope,
  normalizeCouponCode,
  normalizeEmail,
} = await jiti.import(path.join(root, 'src', 'lib', 'coupons', 'rules.ts'));

const {
  COUPON_NAME_LIMIT,
  couponAuditFromRow,
  couponAuditSnapshot,
  couponBadge,
  couponListBadge,
  couponScopeLabel,
  couponValueLabel,
  parseCouponInput,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'coupon-rules.ts'));

const { generateCouponCode } = await jiti.import(
  path.join(root, 'src', 'lib', 'coupons', 'codes.ts'),
);

/* --------------------------------------------------------------- fixtures */

const NOW = new Date('2026-10-29T10:00:00Z');

function definition(overrides = {}) {
  return {
    id: 'coupon_1',
    code: 'SAVE10',
    name: 'Ten percent',
    type: 'PERCENT',
    value: 10,
    scope: 'ORDER',
    status: 'active',
    startsAt: null,
    endsAt: null,
    totalRedemptionLimit: null,
    perCustomerLimit: null,
    minOrderPaise: 0,
    maxDiscountPaise: null,
    onlyNewCustomers: false,
    allowWithSalePrice: false,
    allowedCustomerGroups: null,
    restrictedToEmails: null,
    targets: [],
    ...overrides,
  };
}

function line(overrides = {}) {
  const quantity = overrides.quantity ?? 1;
  const unitPaise = overrides.unitPaise ?? 10000;
  return {
    productId: 'product_1',
    categoryId: 'category_1',
    brandId: 'brand_1',
    quantity,
    unitPaise,
    linePaise: unitPaise * quantity,
    onSale: false,
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    now: NOW,
    subtotalPaise: 10000,
    shippingPaise: 0,
    customer: { userId: 'user_1', email: 'buyer@example.com', group: null },
    customerPaidOrderExists: false,
    customerRedemptions: 0,
    totalRedemptions: 0,
    ...overrides,
  };
}

/** Evaluate a definition against lines, with subtotal derived from the lines. */
function run(def, lines, ctxOverrides = {}) {
  const subtotalPaise = lines.reduce((sum, entry) => sum + entry.linePaise, 0);
  return evaluateCoupon({
    coupon: def,
    lines,
    context: context({ subtotalPaise, ...ctxOverrides }),
  });
}

function reasonOf(result) {
  assert.equal(result.ok, false, 'expected a refusal');
  return result.reason;
}

/* ------------------------------------------------------------- the window */

test('a paused or archived code is refused as inactive', () => {
  for (const status of ['paused', 'archived']) {
    assert.equal(reasonOf(run(definition({ status }), [line()])), 'inactive');
  }
});

test('starts_at is inclusive and ends_at is exclusive on the database clock', () => {
  const windowed = definition({
    startsAt: '2026-10-29T10:00:00.000Z',
    endsAt: '2026-10-30T10:00:00.000Z',
  });
  assert.equal(run(windowed, [line()]).ok, true, 'the start instant is inside');

  const later = run(windowed, [line()], { now: new Date('2026-10-30T10:00:00Z') });
  assert.equal(reasonOf(later), 'expired');

  const early = run(windowed, [line()], { now: new Date('2026-10-29T09:59:59Z') });
  assert.equal(reasonOf(early), 'not_started');
});

test('an unreadable clock refuses instead of applying a discount', () => {
  assert.equal(reasonOf(run(definition(), [line()], { now: 'not-a-time' })), 'inactive');
});

/* -------------------------------------------------------------- customer */

test('restricted emails match case-insensitively and fail closed for guests', () => {
  const def = definition({ restrictedToEmails: ['VIP@Example.com'] });
  assert.equal(run(def, [line()], {
    customer: { userId: null, email: 'vip@example.com', group: null },
  }).ok, true);
  assert.equal(reasonOf(run(def, [line()], {
    customer: { userId: null, email: 'someone@example.com', group: null },
  })), 'not_eligible_customer');
  assert.equal(reasonOf(run(def, [line()], {
    customer: { userId: null, email: '', group: null },
  })), 'not_eligible_customer');
});

test('a group-restricted code needs a matching signed-in group', () => {
  const def = definition({ allowedCustomerGroups: ['vip'] });
  assert.equal(run(def, [line()], {
    customer: { userId: 'u1', email: 'a@example.com', group: 'VIP' },
  }).ok, true);
  assert.equal(reasonOf(run(def, [line()], {
    customer: { userId: 'u1', email: 'a@example.com', group: 'retail' },
  })), 'not_eligible_customer');
  assert.equal(reasonOf(run(def, [line()])), 'not_eligible_customer', 'a guest has no group');
});

test('a new-customers-only code needs no earlier paid order', () => {
  const def = definition({ onlyNewCustomers: true });
  assert.equal(run(def, [line()]).ok, true);
  assert.equal(reasonOf(run(def, [line()], { customerPaidOrderExists: true })), 'not_eligible_customer');
});

/* ---------------------------------------------------------------- limits */

test('a total limit is checked against RESERVED + CONSUMED uses', () => {
  const def = definition({ totalRedemptionLimit: 2 });
  assert.equal(run(def, [line()], { totalRedemptions: 1 }).ok, true);
  assert.equal(reasonOf(run(def, [line()], { totalRedemptions: 2 })), 'used_up');
});

test('a per-customer limit is checked against this customer', () => {
  const def = definition({ perCustomerLimit: 1 });
  assert.equal(run(def, [line()], { customerRedemptions: 0 }).ok, true);
  assert.equal(reasonOf(run(def, [line()], { customerRedemptions: 1 })), 'already_used');
});

/* ------------------------------------------------------------- min order */

test('the minimum order is checked on the pre-discount subtotal', () => {
  const def = definition({ minOrderPaise: 50000 });
  assert.equal(reasonOf(run(def, [line({ unitPaise: 49999 })])), 'min_order');
  assert.equal(run(def, [line({ unitPaise: 50000 })]).ok, true);

  const refusal = run(def, [line({ unitPaise: 49999 })]);
  assert.match(refusal.message, /₹499\.99|₹500/);
});

/* --------------------------------------------------------------- percent */

test('a percentage is floored to whole paise, then capped', () => {
  const def = definition({ value: 13 });
  const result = run(def, [line({ unitPaise: 999 })]);
  assert.equal(result.ok, true);
  assert.equal(result.discountPaise, 129, 'floor(999 * 13 / 100)');
  assert.equal(result.totalPaise, 870);

  const capped = run(
    definition({ value: 20, maxDiscountPaise: 5000 }),
    [line({ unitPaise: 100000 })],
  );
  assert.equal(capped.discountPaise, 5000);
  assert.equal(capped.totalPaise, 95000);
});

test('an out-of-range stored percentage is refused, never charged', () => {
  for (const value of [0, -5, 101]) {
    assert.equal(reasonOf(run(definition({ value }), [line()])), 'inactive');
  }
});

/* ----------------------------------------------------------------- fixed */

test('a fixed discount is capped at the eligible value', () => {
  const result = run(definition({ type: 'FIXED', value: 5000 }), [line({ unitPaise: 20000 })]);
  assert.equal(result.discountPaise, 5000);
  assert.equal(result.totalPaise, 15000);

  const oversized = run(definition({ type: 'FIXED', value: 50000 }), [line({ unitPaise: 20000 })]);
  assert.equal(oversized.ok, true);
  // The discount is trimmed to keep ₹1 payable, and the line note says so.
  assert.equal(oversized.discountPaise, 19900);
  assert.equal(oversized.totalPaise, MIN_PAYABLE_PAISE);
  assert.match(oversized.message, /adjusted/);
});

/* --------------------------------------------------------- free shipping */

test('free shipping removes the shipping charge and no line value', () => {
  const result = run(
    definition({ type: 'FREE_SHIPPING', value: 0 }),
    [line({ unitPaise: 20000 })],
    { shippingPaise: 4900 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.discountPaise, 0);
  assert.equal(result.shippingPaise, 0);
  assert.equal(result.totalPaise, 20000);
  assert.deepEqual(result.allocations, [0]);
});

/* ----------------------------------------------------------------- scope */

test('scope matching is by product, category or brand id', () => {
  const lines = [
    line({ productId: 'p1', categoryId: 'c1', brandId: 'b1', unitPaise: 10000 }),
    line({ productId: 'p2', categoryId: 'c2', brandId: 'b2', unitPaise: 10000 }),
  ];

  const byProduct = run(
    definition({ scope: 'PRODUCTS', targets: [{ productId: 'P2' }], value: 10 }),
    lines,
  );
  assert.equal(byProduct.ok, true);
  assert.equal(byProduct.discountPaise, 1000);
  assert.deepEqual(byProduct.eligibleLineIndexes, [1]);
  assert.deepEqual(byProduct.allocations, [0, 1000]);

  const byCategory = run(
    definition({ scope: 'CATEGORIES', targets: [{ categoryId: 'c1' }], value: 10 }),
    lines,
  );
  assert.deepEqual(byCategory.eligibleLineIndexes, [0]);

  const byBrand = run(
    definition({ scope: 'BRANDS', targets: [{ brandId: 'b2' }], value: 10 }),
    lines,
  );
  assert.deepEqual(byBrand.eligibleLineIndexes, [1]);

  assert.equal(lineMatchesScope(lines[0], 'ORDER', []), true);
});

test('a scoped coupon with no matching line is refused generically', () => {
  const result = run(
    definition({ scope: 'PRODUCTS', targets: [{ productId: 'missing' }] }),
    [line()],
  );
  assert.equal(reasonOf(result), 'no_eligible_items');
  assert.equal(result.message, 'This code is not valid for your cart.');

  const noTargets = run(definition({ scope: 'PRODUCTS', targets: [] }), [line()]);
  assert.equal(reasonOf(noTargets), 'no_eligible_items');
});

/* ------------------------------------------------------------ sale items */

test('sale-priced lines are excluded unless the code allows them', () => {
  const lines = [
    line({ productId: 'sale', unitPaise: 20000, onSale: true }),
    line({ productId: 'full', unitPaise: 30000, onSale: false }),
  ];

  const excluded = run(definition({ value: 10 }), lines);
  assert.equal(excluded.ok, true);
  assert.deepEqual(excluded.eligibleLineIndexes, [1]);
  assert.deepEqual(excluded.allocations, [0, 3000]);
  assert.match(excluded.message, /sale/i);

  const allowed = run(definition({ value: 10, allowWithSalePrice: true }), lines);
  assert.deepEqual(allowed.eligibleLineIndexes, [0, 1]);
  assert.equal(allowed.discountPaise, 5000);

  const onlySale = run(definition({ value: 10 }), [lines[0]]);
  assert.equal(reasonOf(onlySale), 'sale_items_excluded');
});

/* ------------------------------------------------------------ the floor */

test('a discount never takes the payable below the gateway floor', () => {
  const result = run(definition({ value: 100 }), [line({ unitPaise: 10000 })]);
  assert.equal(result.ok, true);
  assert.equal(result.discountPaise, 9900);
  assert.equal(result.totalPaise, MIN_PAYABLE_PAISE);
  assert.ok(result.message, 'the customer is told the discount was adjusted');

  const tiny = run(definition({ value: 10 }), [line({ unitPaise: 50 })]);
  assert.equal(reasonOf(tiny), 'below_minimum_payable');
});

test('free shipping cannot rescue a cart below the gateway floor', () => {
  const result = run(
    definition({ type: 'FREE_SHIPPING', value: 0 }),
    [line({ unitPaise: 50 })],
    { shippingPaise: 0 },
  );
  assert.equal(reasonOf(result), 'below_minimum_payable');
});

test('the total is never negative for any input', () => {
  const cases = [
    [definition({ value: 100 }), [line({ unitPaise: 10000 })], {}],
    [definition({ type: 'FIXED', value: 999999 }), [line({ unitPaise: 10000 })], {}],
    [definition({ type: 'FREE_SHIPPING', value: 0 }), [line({ unitPaise: 100000 })], { shippingPaise: 5000 }],
    [definition({ value: 100 }), [line({ unitPaise: 10000, quantity: 3 })], {}],
  ];
  for (const [def, lines, ctx] of cases) {
    const result = run(def, lines, ctx);
    if (result.ok) {
      assert.ok(result.totalPaise >= MIN_PAYABLE_PAISE);
      assert.ok(result.discountPaise >= 0);
      assert.ok(result.shippingPaise >= 0);
    }
  }
});

/* ---------------------------------------------------------- allocation */

test('allocation sums to the discount and never exceeds a line', () => {
  const lines = [
    line({ unitPaise: 333 }),
    line({ unitPaise: 333 }),
    line({ unitPaise: 334 }),
  ];
  for (const discount of [1, 7, 99, 999]) {
    const allocations = allocateDiscount(discount, lines, [0, 1, 2]);
    assert.equal(
      allocations.reduce((sum, value) => sum + value, 0),
      discount,
      `allocations for ${discount}`,
    );
    allocations.forEach((value, index) => {
      assert.ok(value >= 0);
      assert.ok(value <= lines[index].linePaise);
    });
  }
});

test('the largest remainders get the odd paise, in a stable order', () => {
  const lines = [line({ unitPaise: 300 }), line({ unitPaise: 700 })];
  assert.deepEqual(allocateDiscount(10, lines, [0, 1]), [3, 7]);
  assert.deepEqual(allocateDiscount(1, lines, [0, 1]), [0, 1]);
  assert.deepEqual(
    allocateDiscount(1, [line({ unitPaise: 1 }), line({ unitPaise: 1 })], [0, 1]),
    [1, 0],
    'a tie goes to the earlier line',
  );
  assert.deepEqual(allocateDiscount(5, lines, [1]), [0, 5]);
  assert.deepEqual(allocateDiscount(0, lines, [0, 1]), [0, 0]);
  assert.deepEqual(allocateDiscount(-5, lines, [0, 1]), [0, 0]);
  assert.deepEqual(allocateDiscount(5, lines, []), [0, 0]);
});

/* --------------------------------------------------------------- messages */

test('refusals never leak internals, only the safe specific reason', () => {
  const generic = [
    'not_found',
    'inactive',
    'not_started',
    'no_eligible_items',
    'invalid_code',
  ];
  for (const reason of generic) {
    const message = couponRejectionMessage(reason);
    assert.equal(message, 'This code is not valid for your cart.', reason);
  }

  assert.equal(couponRejectionMessage('expired'), 'This code has expired.');
  assert.equal(couponRejectionMessage('already_used'), 'You have already used this code.');
  assert.equal(
    couponRejectionMessage('min_order', 50000),
    'This code needs a minimum order of ₹500.',
  );

  // No message ever names the code, a limit, a target or another customer.
  for (const reason of ['expired', 'min_order', 'already_used', 'used_up', 'not_eligible_customer']) {
    const message = couponRejectionMessage(reason, 50000);
    assert.doesNotMatch(message, /SAVE10|coupon_id|limit \d|product|category|brand/i);
  }
});

/* ------------------------------------------------------- normalisation */

test('codes are stored uppercase and bounded, with no lookalike characters', () => {
  assert.equal(normalizeCouponCode('  save10 '), 'SAVE10');
  assert.equal(normalizeCouponCode(null), '');
  assert.equal(normalizeEmail(' Buyer@Example.COM '), 'buyer@example.com');

  for (const code of ['ABC', 'SAVE-10', 'GZ-ABCDEFGH', 'A1B']) {
    assert.equal(isValidCouponCode(code), true, code);
  }
  for (const code of ['AB', '', 'SAVE 10', 'SAVE_10', 'X'.repeat(33), 'SAVE.10']) {
    assert.equal(isValidCouponCode(code), false, code);
  }
  assert.ok(COUPON_CODE_PATTERN.test('SAVE-10'));
});

test('the snapshot copies only what the customer saw', () => {
  const snapshot = couponSnapshot(definition({ value: 25 }), 1234);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'code',
    'discountPaise',
    'id',
    'scope',
    'type',
    'value',
  ]);
  assert.equal(snapshot.code, 'SAVE10');
  assert.equal(snapshot.discountPaise, 1234);
});

/* --------------------------------------------------------- admin parsing */

test('the admin form parses a percentage into the stored shape', () => {
  const parsed = parseCouponInput({
    code: ' save10 ',
    name: 'Ten percent',
    type: 'percent',
    value: '10',
    maxDiscountRupees: '500',
    minOrderRupees: '1,499',
    perCustomerLimit: '1',
    totalRedemptionLimit: '10',
    allowWithSalePrice: 'on',
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-11-30T00:00:00.000Z',
  });
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.values.code, 'SAVE10');
  assert.equal(parsed.values.type, 'PERCENT');
  assert.equal(parsed.values.value, 10);
  assert.equal(parsed.values.maxDiscountPaise, 50000);
  assert.equal(parsed.values.minOrderPaise, 149900);
  assert.equal(parsed.values.perCustomerLimit, 1);
  assert.equal(parsed.values.totalRedemptionLimit, 10);
  assert.equal(parsed.values.allowWithSalePrice, true);
  assert.equal(parsed.values.scope, 'ORDER');
  assert.equal(parsed.values.startsAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('the admin form rejects each broken rule with a usable message', () => {
  const base = { code: 'SAVE10', type: 'PERCENT', value: '10' };
  const cases = [
    [{ ...base, code: 'A' }, /code/i],
    [{ ...base, value: '0' }, /percentage/i],
    [{ ...base, value: '101' }, /percentage/i],
    [{ ...base, value: '10.5' }, /percentage/i],
    [{ ...base, type: 'FIXED', value: '0' }, /greater than zero/i],
    [{ ...base, type: 'FIXED', value: '-10' }, /rupees/i],
    [{ ...base, type: 'NOPE', value: '10' }, /discount type/i],
    [{ ...base, scope: 'PRODUCTS' }, /at least one product/i],
    [{ ...base, scope: 'WAT' }, /applies to/i],
    [{ ...base, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' }, /after/i],
    [{ ...base, startsAt: 'soon' }, /valid date/i],
    [{ ...base, perCustomerLimit: '0' }, /greater than zero/i],
    [{ ...base, perCustomerLimit: '1.5' }, /greater than zero/i],
    [{ ...base, restrictedToEmails: 'not-an-email' }, /email address/i],
    [{ ...base, name: 'x'.repeat(COUPON_NAME_LIMIT + 1) }, /characters or fewer/i],
    [{ ...base, maxDiscountRupees: '0' }, /greater than zero/i],
  ];
  for (const [input, pattern] of cases) {
    const parsed = parseCouponInput(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
    assert.match(parsed.error, pattern);
  }
});

test('a free-shipping code carries no amount and no max discount', () => {
  const parsed = parseCouponInput({ code: 'FREESHIP', type: 'FREE_SHIPPING', value: '50' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.values.value, 0);
  assert.equal(parsed.values.maxDiscountPaise, null);
});

test('targets follow the chosen scope and are de-duplicated', () => {
  const parsed = parseCouponInput({
    code: 'P10',
    type: 'PERCENT',
    value: '10',
    scope: 'PRODUCTS',
    productIds: ['p1', 'p1', ' p2 '],
    categoryIds: ['ignored'],
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.values.targets, [{ productId: 'p1' }, { productId: 'p2' }]);
});

test('the audit snapshot records email and group counts, never addresses', () => {
  const parsed = parseCouponInput({
    code: 'VIP10',
    type: 'PERCENT',
    value: '10',
    restrictedToEmails: 'a@example.com b@example.com',
    allowedCustomerGroups: ['vip'],
    scope: 'BRANDS',
    brandIds: ['brand_1'],
  });
  assert.equal(parsed.ok, true);
  const snapshot = couponAuditSnapshot({ ...parsed.values, status: 'active' });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /a@example\.com|b@example\.com/);
  assert.equal(snapshot.restrictedEmails, 2);
  assert.equal(snapshot.customerGroups, 1);
  assert.equal(snapshot.targets, 1);

  const fromRow = couponAuditFromRow({
    ...parsed.values,
    status: 'paused',
    targetCount: 3,
  });
  assert.equal(fromRow.targets, 3);
  assert.equal(fromRow.status, 'paused');
  assert.doesNotMatch(JSON.stringify(fromRow), /@example\.com/);
});

test('list badges explain why a code cannot be used right now', () => {
  assert.equal(couponBadge({ status: 'archived', startsAt: null, endsAt: null }).tone, 'archived');
  assert.equal(couponBadge({ status: 'paused', startsAt: null, endsAt: null }).tone, 'paused');
  assert.equal(
    couponBadge({ status: 'active', startsAt: null, endsAt: '2020-01-01T00:00:00Z' }).tone,
    'expired',
  );
  assert.equal(
    couponBadge({ status: 'active', startsAt: '2099-01-01T00:00:00Z', endsAt: null }).tone,
    'scheduled',
  );
  assert.equal(couponBadge({ status: 'active', startsAt: null, endsAt: null }).tone, 'active');

  assert.equal(
    couponListBadge({
      status: 'active',
      startsAt: null,
      endsAt: null,
      used: 5,
      totalLimit: 5,
    }).tone,
    'used-up',
  );
  assert.equal(
    couponListBadge({
      status: 'active',
      startsAt: null,
      endsAt: null,
      used: 4,
      totalLimit: 5,
    }).tone,
    'active',
  );
});

test('labels show money and scope the way staff read them', () => {
  assert.equal(couponValueLabel('PERCENT', 10), '10%');
  assert.equal(couponValueLabel('FIXED', 149900), '₹1,499');
  assert.equal(couponValueLabel('FIXED', 149950), '₹1,499.50');
  assert.equal(couponValueLabel('FREE_SHIPPING', 0), 'Free shipping');
  assert.equal(couponScopeLabel('ORDER'), 'Whole order');
  assert.equal(couponScopeLabel('PRODUCTS'), 'Products');
});

/* -------------------------------------------------------------- code gen */

test('generated codes use the unambiguous alphabet and a valid format', () => {
  const codes = new Set();
  for (let index = 0; index < 200; index += 1) {
    const code = generateCouponCode('GZ', 8);
    assert.match(code, /^GZ-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(isValidCouponCode(code), true);
    codes.add(code);
  }
  assert.equal(codes.size, 200, '200 generated codes are unique');
});

test('a generated code stays valid for any prefix and length input', () => {
  for (const [prefix, length] of [['', 6], ['promo', 24], ['x!', 999], ['A-B', 2]]) {
    const code = generateCouponCode(prefix, length);
    assert.equal(isValidCouponCode(code), true, `${prefix}/${length} -> ${code}`);
    assert.ok(code.length <= 32);
  }
});

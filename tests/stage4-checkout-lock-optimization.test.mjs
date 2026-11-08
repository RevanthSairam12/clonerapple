import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const root = process.cwd();

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch {
    // ignore
  }
}

const connUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
const skip =
  process.env.RUN_LEGACY_DB_TESTS !== '1'
    ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
    : !connUrl
      ? 'DATABASE_URL not set'
      : new URL(connUrl).port === '6543'
        ? 'requires session connection on port 5432'
        : false;

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { createOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));
const { loadCouponDefinition, evaluateCouponFromDatabase } = await jiti.import(
  path.join(root, 'src/lib/coupons/store.ts'),
);
const { createPosSaleUsing } = await jiti.import(path.join(root, 'src/lib/store-admin/pos.ts'));
const { cancelOrderUsing, createReturn, transitionReturn } = await jiti.import(
  path.join(root, 'src/lib/store-admin/returns.ts'),
);
const { reconcileOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/reconcile.ts'));
const { DEFAULT_RESERVATION_POLICY } = await jiti.import(
  path.join(root, 'src/lib/checkout/reservation-rules.ts'),
);

test('coupon lock + evaluation collapses into exactly 2 SQL round trips', async () => {
  const queries = [];
  const fakeTx = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim();
    queries.push({ q, values });
    if (q.includes('from coupons c')) {
      assert.match(q, /for update of c$/i);
      assert.match(q, /from coupon_targets ct/i);
      return [
        {
          id: 'coup_1',
          code: 'SAVE10',
          name: 'Save 10%',
          type: 'PERCENT',
          value: 10,
          scope: 'PRODUCTS',
          status: 'active',
          starts_at: null,
          ends_at: null,
          total_redemption_limit: 5,
          per_customer_limit: 2,
          min_order_paise: 10000,
          max_discount_paise: null,
          only_new_customers: true,
          allow_with_sale_price: true,
          allowed_customer_groups: ['vip'],
          restricted_to_emails: null,
          targets_json: [{ product_id: 'prod_1', category_id: null, brand_id: null }],
        },
      ];
    }
    if (q.includes('from (select 1) as one') && q.includes('left join coupon_redemptions cr')) {
      return [
        {
          now: new Date('2026-11-08T12:00:00Z'),
          resolved_group: 'vip',
          paid_order_exists: false,
          total: 1,
          mine: 0,
        },
      ];
    }
    throw new Error(`Unexpected query in coupon evaluation: ${q}`);
  };

  const coupon = await loadCouponDefinition(fakeTx, 'save10', { forUpdate: true });
  assert.ok(coupon);
  assert.equal(coupon.targets.length, 1);
  assert.equal(coupon.targets[0].productId, 'prod_1');
  assert.equal(queries.length, 1, 'loadCouponDefinition + targets is 1 round trip');

  const evaluation = await evaluateCouponFromDatabase(fakeTx, coupon, {
    lines: [
      {
        productId: 'prod_1',
        categoryId: null,
        brandId: null,
        quantity: 1,
        unitPaise: 50000,
        linePaise: 50000,
        onSale: false,
      },
    ],
    subtotalPaise: 50000,
    shippingPaise: 5000,
    customer: {
      userId: 'user_1',
      email: 'asha@example.test',
      group: null,
    },
  });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.discountPaise, 5000);
  assert.equal(queries.length, 2, 'entire coupon lock + evaluation is 2 round trips total');
});

test('createOrderUsing runs plain reads before row locks and enforces lock order orders -> stock -> coupons -> order_number_counters', async () => {
  const source = await readFile(path.join(root, 'src/lib/payu/orders.ts'), 'utf8');
  const fnStart = source.indexOf('export async function createOrderUsing(');
  const body = source.slice(fnStart);

  const plainConfigRead = body.indexOf('readCheckoutConfigurationUsing(tx)');
  const plainCatalogRead = body.indexOf('resolveCartItemsFromDbUsing(tx');
  const ordersLock = body.indexOf('for update of o`');
  const stockLock = body.indexOf('lockStockIdentities(tx');
  const couponLock = body.indexOf('loadCouponDefinition(tx, code, { forUpdate: true })');
  const counterLock = body.indexOf('allocateOrderNumber(tx, params.numbering)');

  assert.ok(plainConfigRead > 0, 'plain checkout configuration read present');
  assert.ok(plainCatalogRead > plainConfigRead, 'plain cart price resolution present');
  assert.ok(
    plainCatalogRead < ordersLock,
    'plain reads (checkout config, sale state, cart prices) execute BEFORE locking orders',
  );
  assert.ok(ordersLock < stockLock, 'lock order: orders -> stock');
  assert.ok(stockLock < couponLock, 'lock order: stock -> coupons');
  assert.ok(couponLock < counterLock, 'lock order: coupons -> order_number_counters');
});

const TABLES = [
  'categories',
  'product_types',
  'device_brands',
  'device_models',
  'products',
  'product_variants',
  'product_device_models',
  'colours',
  'product_variant_colours',
  'product_images',
  'users',
  'stock',
  'stock_movements',
  'orders',
  'order_items',
  'order_addresses',
  'order_deliveries',
  'order_status_history',
  'order_payments',
  'order_number_counters',
  'invoice_number_counters',
  'receipt_counters',
  'pos_shifts',
  'coupons',
  'coupon_targets',
  'coupon_redemptions',
  'cancellation_reasons',
  'return_requests',
  'return_items',
  'refunds',
  'refund_obligations',
  'payment_events',
  'sale_settings',
  'store_settings',
  'store_admins',
  'store_admin_audit',
];

test(
  'DB integration: concurrent checkouts with coupons, POS, reconcile, cancel and return execute without deadlock and preserve exact ledger invariants',
  { skip },
  async () => {
    const tag = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const schema = `itest_lock_${tag}`;
    const makeClient = (pinnedSchema) =>
      postgres(connUrl, {
        max: 1,
        prepare: false,
        ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
        connection: { search_path: pinnedSchema || 'pg_catalog' },
        onnotice: () => {},
      });

    const a = makeClient();
    let b;
    let c;

    try {
      await createFixtureSchema(a, schema, TABLES);
      b = makeClient(schema);
      c = makeClient(schema);
      await b.unsafe(`set search_path to "${schema}"`);
      await c.unsafe(`set search_path to "${schema}"`);

      const catId = `cat_${tag}`;
      const prodId = `prod_${tag}`;
      const staffId = `stf_${tag}`;
      const couponId = `cpn_${tag}`;
      const reasonId = `rsn_${tag}`;

      await a`insert into categories (id, slug, name) values (${catId}, ${catId}, 'Cases')`;
      await a`
        insert into products (id, category_id, slug, name, price_paise, inventory_mode, is_active, in_stock)
        values (${prodId}, ${catId}, ${prodId}, 'Lock Test Case', 50000, 'product', true, true)
      `;
      await a`
        insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold)
        values (${`stk_${tag}`}, ${prodId}, null, 5, 0, true, 1)
      `;
      await a`
        insert into sale_settings (id, enabled)
        values ('default', false)
        on conflict (id) do update set enabled = false
      `;
      await a`
        insert into store_settings (key, value)
        values
          ('payu_enabled', 'on'),
          ('coupons_enabled', 'on'),
          ('shipping_enabled', 'on'),
          ('shipping_charge_paise', '5000'),
          ('free_shipping_threshold_paise', '99900')
        on conflict (key) do update set value = excluded.value
      `;
      await a`
        insert into order_number_counters (name, next_number)
        values ('order', 1000)
        on conflict (name) do update set next_number = 1000
      `;
      await a`
        insert into invoice_number_counters (name, last_number)
        values ('invoice', 0)
        on conflict (name) do nothing
      `;
      await a`
        insert into receipt_counters (name, next_number)
        values ('pos_receipt', 1)
        on conflict (name) do nothing
      `;
      await a`
        insert into store_admins (id, email, password_hash, name, role, is_active)
        values (${staffId}, ${`staff_${tag}@example.invalid`}, 'fixture-hash', 'Staff', 'store_owner', true)
      `;
      await a`
        insert into pos_shifts (staff_id, opening_float_paise, status)
        values (${staffId}, 0, 'OPEN')
      `;
      await a`
        insert into coupons (id, code, name, type, value, scope, status, total_redemption_limit)
        values (${couponId}, 'LOCK10', 'Lock 10%', 'PERCENT', 10, 'ORDER', 'active', 2)
      `;
      await a`
        insert into cancellation_reasons (id, label, sort_order, is_active)
        values (${reasonId}, 'Customer requested cancellation', 1, true)
      `;

      // Seed one order to reconcile/cancel and one delivered order to return concurrently with checkouts & POS
      const toCancel = await createOrderUsing(a, {
        numbering: { prefix: 'GDZ', startNumber: 1000 },
        cartItems: [{ id: prodId, quantity: 1, expectedUnitPaise: 50000 }],
        expectedTotalPaise: 55000,
        currency: 'INR',
        customerName: 'Cancel User',
        customerEmail: 'cancel@example.test',
        customerPhone: '9876543210',
        reservationSeconds: 600,
        shippingAddress: {
          name: 'Cancel User',
          phone: '9876543210',
          line1: '1 Cancel Rd',
          line2: '',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
        },
      });

      // Run concurrent web checkouts (with coupon & numbering), POS sale, and order cancellation on the same product!
      const [chkA, chkB, posRes, cancelRes] = await Promise.all([
        createOrderUsing(a, {
          numbering: { prefix: 'GDZ', startNumber: 1000 },
          cartItems: [{ id: prodId, quantity: 1, expectedUnitPaise: 50000 }],
          coupon: { code: 'LOCK10', expectedTotalPaise: 50000 },
          expectedTotalPaise: 50000,
          currency: 'INR',
          customerName: 'Buyer A',
          customerEmail: 'buyera@example.test',
          customerPhone: '9876543211',
          reservationSeconds: 600,
          shippingAddress: {
            name: 'Buyer A',
            phone: '9876543211',
            line1: '2 Main Rd',
            line2: '',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
        }),
        createOrderUsing(b, {
          numbering: { prefix: 'GDZ', startNumber: 1000 },
          cartItems: [{ id: prodId, quantity: 1, expectedUnitPaise: 50000 }],
          coupon: { code: 'LOCK10', expectedTotalPaise: 50000 },
          expectedTotalPaise: 50000,
          currency: 'INR',
          customerName: 'Buyer B',
          customerEmail: 'buyerb@example.test',
          customerPhone: '9876543212',
          reservationSeconds: 600,
          shippingAddress: {
            name: 'Buyer B',
            phone: '9876543212',
            line1: '3 Main Rd',
            line2: '',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
        }),
        createPosSaleUsing(c, {
          lines: [{ id: prodId, variantId: null, quantity: 1, unitPricePaise: 50000 }],
          method: 'cash',
          providerRef: null,
          customerPhone: null,
          staffId,
          role: 'store_owner',
        }),
        cancelOrderUsing(a, {
          txnid: toCancel.order.txnid,
          reasonId,
          note: 'Concurrent cancel test',
          actorId: staffId,
          role: 'store_owner',
        }),
      ]);

      assert.equal(chkA.stockClaimed, true);
      assert.equal(chkB.stockClaimed, true);
      assert.notEqual(chkA.order.orderNumber, chkB.order.orderNumber, 'unique order numbers allocated');
      assert.equal(posRes.ok, true);
      assert.equal(cancelRes.ok, true);

      // Verify stock ledger invariant: opening (5) + sum(movements.delta) === stock.on_hand
      const [stk] = await a`select on_hand from stock where product_id = ${prodId}`;
      const [mov] = await a`select coalesce(sum(delta), 0)::int as delta_sum from stock_movements where product_id = ${prodId}`;
      assert.equal(Number(stk.on_hand), 5 + Number(mov.delta_sum), 'stock on_hand matches ledger exactly');
      // 5 opening - 1 (toCancel) + 1 (cancel release) - 1 (chkA) - 1 (chkB) - 1 (posRes) = 2
      assert.equal(Number(stk.on_hand), 2);
    } finally {
      if (b) await b.end({ timeout: 5 });
      if (c) await c.end({ timeout: 5 });
      await dropFixtureSchema(a, schema);
      await a.end({ timeout: 5 });
    }
  },
);

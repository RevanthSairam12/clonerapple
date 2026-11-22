import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NextRequest } from 'next/server.js';

const root = process.cwd();
const pricingJiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const pricing = await pricingJiti.import(path.join(root, 'src/lib/payu/db-pricing.ts'));

function createOrderTxDouble({
  saleEnabled = true,
  saleUnreadable = false,
  saleMissingRow = false,
  flipSaleEnabledOnLock = false,
  stockOnHand = 5,
} = {}) {
  const queries = [];
  const insertedOrders = [];
  const stockUpdates = [];
  let lockSeen = false;
  let currentSaleEnabled = saleEnabled;
  let txChain = Promise.resolve();

  function makeSql() {
    const sql = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim();
      const qLower = q.toLowerCase();
      queries.push({ q, values });

      if (q.includes("to_regclass('colours')")) return [{ colours: false }];
      if (q.includes("to_regclass('sale_settings')")) return [{ present: true }];
      if (q.includes("to_regclass('free_gift_rules')")) return [{ present: false }];
      if (q.includes('from information_schema.columns')) return [{ present: false }];
      if (q.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: '' }];
      if (q.includes('set_config(')) return [];

      if (q.includes('from store_settings')) {
        return [
          { key: 'payu_enabled', value: 'on' },
          { key: 'coupons_enabled', value: 'on' },
          { key: 'shipping_enabled', value: 'off' },
          { key: 'shipping_charge_paise', value: '0' },
          { key: 'free_shipping_threshold_paise', value: '0' },
          { key: 'reservation_minutes', value: '10' },
        ];
      }

      if (q.includes('from sale_settings')) {
        if (saleUnreadable) throw new Error('Simulated sale_settings outage');
        if (saleMissingRow) return [];
        return [{
          enabled: currentSaleEnabled,
          starts_at: null,
          ends_at: null,
          updated_at: null,
          updated_by: null,
          db_now: new Date('2026-11-22T10:00:00Z'),
        }];
      }

      if (q.includes('clock_timestamp()')) {
        return [{ db_now: new Date('2026-11-22T10:00:00Z') }];
      }

      if (q.trim() === '' || q.includes('from product_images pi') || q.includes('as variant_device_model_id')) {
        return '';
      }

      if (q.includes('from products p')) {
        return [
          {
            id: 'prod_case',
            name: 'Phone Case',
            subtitle: 'Black',
            inventory_mode: 'variant',
            price_paise: 150000,
            sale_price_paise: 99900,
            option_price_paise: null,
            option_sale_price_paise: null,
            variant_id: 'var_black',
            variant_sku: 'CASE-BLK',
            variant_label: 'iPhone 16 Pro / Black',
            variant_device_model_id: null,
            variant_device_model_name: null,
            variant_colour_id: null,
            variant_colour_name: null,
            variant_colour_hex: null,
            category_id: 'cat_cases',
            brand_id: 'brand_gadzio',
            in_stock: true,
            track_inventory: true,
            image: null,
          },
          {
            id: 'prod_case',
            name: 'Phone Case',
            subtitle: 'Clear',
            inventory_mode: 'variant',
            price_paise: 150000,
            sale_price_paise: 99900,
            option_price_paise: null,
            option_sale_price_paise: null,
            variant_id: 'var_clear',
            variant_sku: 'CASE-CLR',
            variant_label: 'iPhone 16 Pro / Clear',
            variant_device_model_id: null,
            variant_device_model_name: null,
            variant_colour_id: null,
            variant_colour_name: null,
            variant_colour_hex: null,
            category_id: 'cat_cases',
            brand_id: 'brand_gadzio',
            in_stock: true,
            track_inventory: true,
            image: null,
          },
          {
            id: 'prod_cable',
            name: 'USB-C Cable',
            subtitle: '1m',
            inventory_mode: 'product',
            price_paise: 60000,
            sale_price_paise: 40000,
            option_price_paise: null,
            option_sale_price_paise: null,
            variant_id: null,
            variant_sku: null,
            variant_label: null,
            variant_device_model_id: null,
            variant_device_model_name: null,
            variant_colour_id: null,
            variant_colour_name: null,
            variant_colour_hex: null,
            category_id: 'cat_cables',
            brand_id: 'brand_gadzio',
            in_stock: true,
            track_inventory: true,
            image: null,
          },
        ];
      }

      if (q.includes('from orders o where o.reservation_state=')) {
        return [];
      }

      if (q.includes('from stock') && q.includes('for update')) {
        lockSeen = true;
        if (flipSaleEnabledOnLock) {
          currentSaleEnabled = true;
        }
        return [
          {
            id: 'stk_case_blk',
            product_id: 'prod_case',
            variant_id: 'var_black',
            on_hand: stockOnHand,
            reserved: 0,
            track_inventory: true,
            low_stock_threshold: 1,
          },
          {
            id: 'stk_case_clr',
            product_id: 'prod_case',
            variant_id: 'var_clear',
            on_hand: stockOnHand,
            reserved: 0,
            track_inventory: true,
            low_stock_threshold: 1,
          },
          {
            id: 'stk_cable',
            product_id: 'prod_cable',
            variant_id: null,
            on_hand: stockOnHand,
            reserved: 0,
            track_inventory: true,
            low_stock_threshold: 1,
          },
        ];
      }

      if (qLower.includes('with inserted_order as')) {
        assert.ok(lockSeen, 'stock locks must precede order insert');
        const row = {
          id: `ord_${insertedOrders.length + 1}`,
          txnid: `TXN_${insertedOrders.length + 1}`,
          order_number: null,
          is_test_order: false,
          user_id: null,
          status: 'CREATED',
          fulfilment_status: 'PENDING',
          currency: 'INR',
          subtotal_paise: 99900,
          discount_paise: 0,
          shipping_paise: 0,
          amount: '999.00',
          items: '[]',
          product_summary: 'Phone Case',
          customer_name: 'Asha',
          customer_email: 'asha@example.test',
          customer_phone: '9876543210',
          reservation_state: 'ACTIVE',
          reservation_expires_at: new Date('2026-11-22T10:10:00Z'),
          created_at: new Date('2026-11-22T10:00:00Z'),
          updated_at: new Date('2026-11-22T10:00:00Z'),
        };
        insertedOrders.push(row);
        return [row];
      }

      if (qLower.includes('insert into order_items')) return [];
      if (qLower.includes('update stock')) {
        stockUpdates.push(values);
        return [{ id: 'stk_updated', on_hand: stockOnHand - 1 }];
      }
      if (qLower.includes('insert into stock_movements')) return [];

      throw new Error(`Unexpected SQL in SEC-002 double: ${q}`);
    };

    sql.json = (v) => v;
    sql.unsafe = async () => [];
    sql.begin = async (fn) => {
      const prev = txChain;
      let release;
      txChain = new Promise((r) => {
        release = r;
      });
      await prev;
      try {
        return await fn(sql);
      } finally {
        release();
      }
    };
    return sql;
  }

  return { makeSql, queries, insertedOrders, stockUpdates };
}

test('SEC-002 pure rules: validateSaleModeQuantities aggregates variants & aliases and distinguishes variants/products/normal mode', () => {
  // Active sale: qty 1 allowed
  pricing.validateSaleModeQuantities([{ id: 'prod_cable', quantity: 1 }], true);

  // Active sale: different variants of same product allowed (each qty 1)
  pricing.validateSaleModeQuantities(
    [
      { id: 'prod_case', variantId: 'var_black', quantity: 1 },
      { id: 'prod_case', variantId: 'var_clear', quantity: 1 },
    ],
    true,
  );

  // Active sale: multiple distinct products allowed (each qty 1)
  pricing.validateSaleModeQuantities(
    [
      { id: 'prod_case', variantId: 'var_black', quantity: 1 },
      { id: 'prod_cable', variantId: null, quantity: 1 },
    ],
    true,
  );

  // Active sale: free gifts excluded from paid 1-unit cap
  pricing.validateSaleModeQuantities(
    [
      { id: 'prod_cable', quantity: 1 },
      { id: 'prod_cable', quantity: 1, isFreeGift: true },
    ],
    true,
  );

  // Active sale: qty 2 rejected
  assert.throws(
    () => pricing.validateSaleModeQuantities([{ id: 'prod_cable', quantity: 2 }], true),
    (err) => err instanceof pricing.SaleQuantityLimitError && err.code === 'sale_quantity_limit',
  );

  // Active sale: duplicate lines (same product + variant, differing case / alias) summing to 2 rejected
  assert.throws(
    () =>
      pricing.validateSaleModeQuantities(
        [
          { id: 'PROD_CASE', variantId: 'var_black', quantity: 1 },
          { id: 'prod_case', variantId: 'var_black', quantity: 1 },
        ],
        true,
      ),
    (err) => err instanceof pricing.SaleQuantityLimitError && err.quantity === 2,
  );

  // Inactive sale: multi-quantity allowed
  pricing.validateSaleModeQuantities(
    [
      { id: 'prod_cable', quantity: 3 },
      { id: 'prod_case', variantId: 'var_black', quantity: 2 },
    ],
    false,
  );
});

test('SEC-002 transactional enforcement: createOrderUsing rejects qty > 1 and duplicate lines during live Sale Mode, permits distinct variants/products and inactive multi-qty, and fails closed on state failure', async () => {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => { throw new Error('use injected sql'); } },
    },
  });
  const { createOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));

  const shippingAddress = {
    name: 'Asha Rao',
    phone: '9876543210',
    line1: '1 Main Rd',
    line2: '',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
  };

  function makeOrderCall(sql, cartItems) {
    return createOrderUsing(sql, {
      txnid: `TXN${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      userId: null,
      cartItems,
      currency: 'INR',
      coupon: null,
      customerName: 'Asha',
      customerEmail: 'asha@example.test',
      customerPhone: '9876543210',
      shippingAddress,
      reservationSeconds: 600,
    });
  }

  // 1. Live sale + qty 1 succeeds
  {
    const dbl = createOrderTxDouble({ saleEnabled: true });
    const res = await makeOrderCall(dbl.makeSql(), [{ id: 'prod_cable', quantity: 1 }]);
    assert.equal(res.stockClaimed, true);
    assert.equal(dbl.insertedOrders.length, 1);
  }

  // 2. Live sale + qty 2 rejects with SaleQuantityLimitError, zero inserts / zero stock writes
  {
    const dbl = createOrderTxDouble({ saleEnabled: true });
    await assert.rejects(
      () => makeOrderCall(dbl.makeSql(), [{ id: 'prod_cable', quantity: 2 }]),
      (err) => err instanceof pricing.SaleQuantityLimitError || err?.code === 'sale_quantity_limit',
    );
    assert.equal(dbl.insertedOrders.length, 0);
    assert.equal(dbl.stockUpdates.length, 0);
  }

  // 3. Live sale + duplicate lines for same product & variant summing > 1 rejected
  {
    const dbl = createOrderTxDouble({ saleEnabled: true });
    await assert.rejects(
      () =>
        makeOrderCall(dbl.makeSql(), [
          { id: 'prod_case', variantId: 'var_black', quantity: 1 },
          { id: 'prod_case', variantId: 'var_black', quantity: 1 },
        ]),
      (err) => err?.code === 'sale_quantity_limit',
    );
    assert.equal(dbl.insertedOrders.length, 0);
  }

  // 4. Live sale + different variants of same product AND distinct products at qty 1 allowed
  {
    const dbl = createOrderTxDouble({ saleEnabled: true });
    const res = await makeOrderCall(dbl.makeSql(), [
      { id: 'prod_case', variantId: 'var_black', quantity: 1 },
      { id: 'prod_case', variantId: 'var_clear', quantity: 1 },
      { id: 'prod_cable', quantity: 1 },
    ]);
    assert.equal(dbl.insertedOrders.length, 1);
    assert.equal(res.stockClaimed, true);
  }

  // 5. Placing another separate order for the same item after previous order succeeds (per-order rule)
  {
    const dbl1 = createOrderTxDouble({ saleEnabled: true });
    await makeOrderCall(dbl1.makeSql(), [{ id: 'prod_cable', quantity: 1 }]);
    const dbl2 = createOrderTxDouble({ saleEnabled: true });
    await makeOrderCall(dbl2.makeSql(), [{ id: 'prod_cable', quantity: 1 }]);
    assert.equal(dbl1.insertedOrders.length, 1);
    assert.equal(dbl2.insertedOrders.length, 1);
  }

  // 6. Sale inactive + qty 3 allowed
  {
    const dbl = createOrderTxDouble({ saleEnabled: false });
    const res = await makeOrderCall(dbl.makeSql(), [{ id: 'prod_cable', quantity: 3 }]);
    assert.equal(dbl.insertedOrders.length, 1);
    assert.equal(res.stockClaimed, true);
  }

  // 7. Post-lock race: sale was OFF during initial resolve, flips ON before/upon lock acquisition -> aborts!
  {
    const dbl = createOrderTxDouble({ saleEnabled: false, flipSaleEnabledOnLock: true });
    await assert.rejects(
      () => makeOrderCall(dbl.makeSql(), [{ id: 'prod_cable', quantity: 2 }]),
      (err) => err?.code === 'sale_quantity_limit',
    );
    assert.equal(dbl.insertedOrders.length, 0);
    assert.equal(dbl.stockUpdates.length, 0);
  }

  // 8. State read failure (query throws) or missing sale_settings row fails closed with SaleStateUnavailableError
  for (const opts of [{ saleUnreadable: true }, { saleMissingRow: true }]) {
    const dbl = createOrderTxDouble(opts);
    await assert.rejects(
      () => makeOrderCall(dbl.makeSql(), [{ id: 'prod_cable', quantity: 1 }]),
      (err) => err?.code === 'sale_state_unavailable',
    );
    assert.equal(dbl.insertedOrders.length, 0);
  }
});

test('SEC-002 initiate route: stale cached sale=off cannot bypass transactional check (with or without coupon) and unreadable sale fails closed (503)', async () => {
  const jitiOrder = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/payu/db-pricing': pricing,
      '@/lib/platform/db': { getSql: () => { throw new Error('no global pool'); } },
    },
  });
  const { createOrderUsing } = await jitiOrder.import(path.join(root, 'src/lib/payu/orders.ts'));

  let cachedSaleState = { live: false, unreadable: false };
  let authoritativeSaleEnabled = true;

  const initiateJiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/payu/db-pricing': pricing,
      '@/lib/platform/db': { getSql: () => { throw new Error('no direct pool'); } },
      '@/lib/storefront/sale-state': {
        readSaleState: async () => cachedSaleState,
      },
      '@/lib/payu/orders': {
        findActiveReservationForUser: async () => null,
        getOrderByTxnid: async () => null,
        getOrderShippingAddress: async () => null,
        isIdenticalCheckoutAttempt: () => false,
        createOrder: async (params) => {
          const dbl = createOrderTxDouble({ saleEnabled: authoritativeSaleEnabled });
          return createOrderUsing(dbl.makeSql(), params);
        },
      },
      '@/lib/user-auth': { getUserSession: async () => ({ userId: 'u_1' }) },
      '@/lib/account/addresses': { getCustomerAddress: async () => null },
      '@/lib/platform/api-guard': { assertSameOrigin: () => null },
      '@/lib/storefront/maintenance-guard': { requireStorefrontOpen: async () => null },
      '@/lib/payu/rate-limit': { checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }) },
      '@/lib/platform/distributed-rate-limit': { checkDistributedRateLimit: async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, backend: 'memory' }) },
      '@/lib/store-admin/customer-settings': { readCustomerSettings: async () => ({ guest_checkout: 'on' }) },
      '@/lib/checkout/settings': { readCheckoutConfiguration: async () => ({ ok: true, settings: { payu_enabled: 'on', coupons_enabled: 'on' } }) },
      '@/lib/payu/config': {
        checkPayUConfiguration: () => ({ ok: true, appBaseUrl: 'https://shop.example' }),
        getPayUConfig: () => ({ key: 'k', salt: 's', paymentUrl: 'https://pay.example' }),
        getPayUCallbackUrls: () => ({ surl: 'https://shop.example/s', furl: 'https://shop.example/f', curl: 'https://shop.example/c' }),
      },
      '@/lib/payu/hash': { generateRequestHash: () => ({ hash: 'h' }) },
      '@/lib/notifications/order-context': { queueOrderEvent: () => {} },
      '@/lib/store-admin/subscribers': { subscribeToNewsletter: () => {} },
      '@/lib/storefront/revalidate': { revalidateCatalog: () => {} },
    },
  });

  const { POST } = await initiateJiti.import(path.join(root, 'src/app/api/payu/initiate/route.ts'));
  const contact = { firstname: 'Asha', email: 'asha@example.test', phone: '9876543210' };
  const shippingAddress = { name: 'Asha Rao', phone: '9876543210', line1: '1 Main Rd', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' };

  // Cached route check says OFF, DB transaction says LIVE -> blocked with 400 sale_quantity_limit, EVEN with couponCode!
  for (const couponCode of [undefined, 'SAVE10']) {
    cachedSaleState = { live: false, unreadable: false };
    authoritativeSaleEnabled = true;
    const res = await POST(
      new NextRequest('http://localhost/api/payu/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: 'prod_cable', quantity: 2 }],
          customer: contact,
          shippingAddress,
          ...(couponCode ? { couponCode } : {}),
        }),
      }),
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.code, 'sale_quantity_limit');
  }

  // Unreadable route sale state on multi-qty request fails closed with 503, never assumes live=false.
  cachedSaleState = { live: false, unreadable: true };
  const failClosed = await POST(
    new NextRequest('http://localhost/api/payu/initiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'prod_cable', quantity: 2 }],
        customer: contact,
        shippingAddress,
      }),
    }),
  );
  assert.equal(failClosed.status, 503);
  assert.equal((await failClosed.json()).code, 'sale_state_unavailable');
});

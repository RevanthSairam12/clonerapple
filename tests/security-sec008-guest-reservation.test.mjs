/**
 * SECURITY (SEC-008): Guest checkout reservation anti-hoarding.
 *
 * Verifies:
 * 1. Exact duplicate guest retries resume cleanly without second orders or stock claims.
 * 2. Same guest changing cart items supersedes cleanly AND preserves open reservation TTL
 *    (never extending stock hold expiration by resubmitting edited carts).
 * 3. Colliding guest attempts on the same email or phone with a different shipping address,
 *    alternate contact, or active PROCESSING order throw `GuestReservationLimitError` (`409`).
 * 4. Expired guest reservations are released cleanly and stop blocking checkout.
 * 5. `POST /api/payu/initiate` enforces distributed `payu_guest_init_ip` (`5 / 10m`) and
 *    maps `GuestReservationLimitError` to `409 active_reservation_exists` + `Retry-After`
 *    even when a coupon code is present, without leaking PII or txnid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NextRequest, NextResponse } from 'next/server.js';

const root = process.cwd();
const pricingJiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const pricing = await pricingJiti.import(path.join(root, 'src/lib/payu/db-pricing.ts'));

function createStatefulGuestOrderDb({ stockOnHand = 5 } = {}) {
  let stock = stockOnHand;
  let seq = 0;
  const orders = [];
  const addresses = [];
  const history = [];
  const movements = [];
  let txChain = Promise.resolve();

  function addOrderRow(row, addr) {
    orders.push(row);
    addresses.push({ order_id: row.id, address_type: 'shipping', ...addr });
  }

  function expireOrderById(orderId) {
    const o = orders.find((r) => r.id === orderId);
    if (o) {
      o.reservation_expires_at = new Date(Date.now() - 60_000);
    }
  }

  function makeSql() {
    const sql = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim();
      const qLower = q.toLowerCase();

      if (q.includes("to_regclass('colours')")) return [{ colours: false }];
      if (q.includes("to_regclass('sale_settings')")) return [{ present: true }];
      if (q.includes('to_regclass(')) return [{ name: null, present: false }];
      if (q.includes('from information_schema.columns')) return [{ present: false }];
      if (q.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: '' }];
      if (q.includes('set_config(')) return [];
      if (q.includes('from sale_settings')) {
        return [{
          enabled: false,
          starts_at: null,
          ends_at: null,
          updated_at: null,
          updated_by: null,
          db_now: new Date(),
        }];
      }
      if (q.includes('clock_timestamp()')) {
        return [{ db_now: new Date() }];
      }

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

      if (q.trim() === '' || q.includes('from product_images pi') || q.includes('as variant_device_model_id')) {
        return '';
      }

      if (q.includes('from products p')) {
        return [
          {
            id: 'prod_1',
            name: 'MagSafe Case',
            subtitle: 'Black',
            inventory_mode: 'product',
            price_paise: 100000,
            sale_price_paise: null,
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
            category_id: 'cat_1',
            brand_id: 'brand_1',
            in_stock: true,
            track_inventory: true,
            image: null,
          },
          {
            id: 'prod_2',
            name: 'USB-C Cable',
            subtitle: 'Braided',
            inventory_mode: 'product',
            price_paise: 50000,
            sale_price_paise: null,
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
            category_id: 'cat_1',
            brand_id: 'brand_1',
            in_stock: true,
            track_inventory: true,
            image: null,
          },
        ];
      }

      // `affectedOrders` query in createOrderUsing
      if (q.includes('select o.id from orders o where o.reservation_state=')) {
        const [, candidateUserId, , isGuestWeb, guestEmailA, , guestPhoneA] = values;
        const nowMs = Date.now();
        return orders
          .filter((o) => {
            if (o.reservation_state !== 'ACTIVE' || o.status === 'PAID') return false;
            const expired = o.reservation_expires_at && o.reservation_expires_at.getTime() <= nowMs;
            if (expired) return true;
            if (candidateUserId && o.user_id === candidateUserId) return true;
            if (isGuestWeb && o.user_id === null && !expired) {
              const eMatch = guestEmailA && o.customer_email.trim().toLowerCase() === guestEmailA;
              const pMatch = guestPhoneA && o.customer_phone.trim() === guestPhoneA;
              return Boolean(eMatch || pMatch);
            }
            return false;
          })
          .map((o) => ({ id: o.id }));
      }

      if (q.includes('select distinct product_id,variant_id from order_items')) {
        const [orderIds] = values;
        return orders
          .filter((o) => orderIds.includes(o.id))
          .flatMap((o) =>
            (o.items || []).map((it) => ({
              product_id: it.id,
              variant_id: it.variantId ?? null,
            })),
          );
      }

      if (q.includes('from stock') && q.includes('for update')) {
        return [
          {
            id: 'stk_1',
            product_id: 'prod_1',
            variant_id: null,
            on_hand: stock,
            reserved: 0,
            track_inventory: true,
            low_stock_threshold: 1,
          },
          {
            id: 'stk_2',
            product_id: 'prod_2',
            variant_id: null,
            on_hand: stockOnHand,
            reserved: 0,
            track_inventory: true,
            low_stock_threshold: 1,
          },
        ];
      }

      // `activeGuestOrders` select inside createOrderUsing
      if (qLower.includes('extract(epoch from (o.reservation_expires_at - now())) as remaining_sec')) {
        const [guestEmailKey, , guestPhoneKey] = values;
        const nowMs = Date.now();
        return orders
          .filter((o) => {
            if (o.user_id !== null || o.reservation_state !== 'ACTIVE') return false;
            if (!o.reservation_expires_at || o.reservation_expires_at.getTime() <= nowMs) return false;
            if (!['CREATED', 'PENDING', 'PROCESSING', 'FAILED', 'CANCELLED'].includes(o.status)) return false;
            const eMatch = guestEmailKey && o.customer_email.trim().toLowerCase() === guestEmailKey;
            const pMatch = guestPhoneKey && o.customer_phone.trim() === guestPhoneKey;
            return Boolean(eMatch || pMatch);
          })
          .map((o) => ({
            ...o,
            remaining_sec: Math.max(0, (o.reservation_expires_at.getTime() - nowMs) / 1000),
          }));
      }

      if (qLower.includes('from order_addresses') && qLower.includes("address_type = 'shipping'")) {
        const [first] = values;
        const ids = Array.isArray(first) ? first : [first];
        return addresses.filter((a) => ids.includes(a.order_id));
      }

      // `releaseExpiredReservationsForProducts`
      if (q.includes('select o.id, o.txnid, o.status, o.coupon_id from orders o')) {
        const nowMs = Date.now();
        return orders
          .filter(
            (o) =>
              o.reservation_state === 'ACTIVE'
              && o.status !== 'PAID'
              && o.reservation_expires_at
              && o.reservation_expires_at.getTime() <= nowMs,
          )
          .map((o) => ({ id: o.id, txnid: o.txnid, status: o.status, coupon_id: o.coupon_id ?? null }));
      }

      if (qLower.includes('from stock_movements where order_id=')) {
        const [orderId] = values;
        const byProduct = new Map();
        for (const m of movements) {
          if (m.orderId !== orderId) continue;
          const prev = byProduct.get(m.productId) ?? { claimed: 0, released: 0 };
          if (m.reason === 'sale') prev.claimed += -m.delta;
          else if (m.reason === 'release' || m.reason === 'return') prev.released += m.delta;
          byProduct.set(m.productId, prev);
        }
        return [...byProduct.entries()]
          .filter(([, b]) => b.claimed > 0)
          .map(([product_id, b]) => ({
            product_id,
            variant_id: null,
            claimed: b.claimed,
            released: b.released,
          }));
      }

      if (qLower.includes('update stock set on_hand=on_hand+')) {
        const qty = Number(values[0]);
        const productId = String(values[1]);
        const orderId = String(values[6]);
        if (productId === 'prod_1') stock += qty;
        movements.push({ orderId, productId, delta: qty, reason: 'release' });
        return [{ id: 'stk_restored' }];
      }

      if (qLower.includes('update orders set status =')) {
        const nextStatus = String(values[0]);
        const releaseReason = String(values[1]);
        const orderId = String(values[values.length - 1]);
        const o = orders.find((r) => r.id === orderId);
        if (o && o.reservation_state === 'ACTIVE' && o.status !== 'PAID') {
          o.status = nextStatus;
          o.reservation_state = 'RELEASED';
          o.reservation_released_reason = releaseReason;
        }
        return [];
      }

      if (qLower.includes('with updated_order as (')) {
        const state = String(values[0]);
        const reason = String(values[1]);
        const orderId = values.find((v) => typeof v === 'string' && orders.some((o) => o.id === v));
        const o = orders.find((r) => r.id === orderId);
        if (o) {
          o.status = state === 'EXPIRED' ? 'CANCELLED' : o.status;
          o.reservation_state = state;
          o.reservation_released_reason = reason;
        }
        return [];
      }

      if (qLower.includes('with inserted_order as')) {
        const intervalStr = values.find((v) => typeof v === 'string' && v.endsWith(' seconds')) ?? '600 seconds';
        const sec = parseInt(intervalStr, 10) || 600;
        const id = String(values[0]);
        const txnid = String(values[1]);
        const itemsJson = values[4];
        const subtotalPaise = Number(values[8]);
        const totalPaise = Number(values[11]);
        const customerName = String(values[16]);
        const customerEmail = String(values[17]);
        const customerPhone = String(values[18]);
        const resState = String(values[19]);
        const line1 = String(values[values.length - 5] ?? '');
        const line2 = String(values[values.length - 4] ?? '');
        const city = String(values[values.length - 3] ?? '');
        const state = String(values[values.length - 2] ?? '');
        const pincode = String(values[values.length - 1] ?? '');

        const row = {
          id,
          txnid,
          order_number: null,
          is_test_order: false,
          user_id: null,
          status: 'CREATED',
          fulfilment_status: 'PENDING',
          currency: 'INR',
          subtotal_paise: subtotalPaise,
          total_paise: totalPaise,
          discount_paise: 0,
          shipping_paise: 0,
          amount: (totalPaise / 100).toFixed(2),
          items: itemsJson,
          product_summary: 'Item',
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          reservation_state: resState,
          reservation_expires_at: new Date(Date.now() + sec * 1000),
          created_at: new Date(),
          updated_at: new Date(),
          recordedIntervalSec: sec,
        };
        addOrderRow(row, {
          full_name: customerName,
          phone: customerPhone,
          line1,
          line2,
          city,
          state,
          postal_code: pincode,
        });
        return [row];
      }

      if (qLower.includes('insert into order_status_history')) {
        history.push(values);
        return [];
      }

      if (qLower.includes('insert into order_items')) return [];
      if (qLower.includes('update stock')) {
        const qty = Number(values[0]);
        const productId = String(values[1]);
        const orderId = String(values[values.length - 1]);
        if (productId === 'prod_1') stock -= qty;
        movements.push({ productId, delta: -qty, reason: 'sale', orderId });
        return [{ id: `stk_${++seq}`, product_id: productId, on_hand: stock }];
      }
      if (qLower.includes('insert into stock_movements')) {
        const [productId, , delta, reason, orderId] = values;
        movements.push({ productId, delta: Number(delta), reason, orderId });
        return [];
      }

      throw new Error(`Unexpected SQL in SEC-008 double: ${q}`);
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

  return { makeSql, orders, expireOrderById, getStock: () => stock };
}

test('SEC-008 transactional guest reservation enforcement: resume, non-extending supersede, anti-hoarding block, and expiry recovery', async () => {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/payu/db-pricing': pricing,
      '@/lib/platform/db': { getSql: () => { throw new Error('use injected sql'); } },
    },
  });
  const { createOrderUsing, GuestReservationLimitError } = await jiti.import(
    path.join(root, 'src/lib/payu/orders.ts'),
  );

  const dbl = createStatefulGuestOrderDb({ stockOnHand: 5 });
  const sql = dbl.makeSql();
  const baseAddress = {
    name: 'Riya Sen',
    phone: '9876543210',
    line1: '12 MG Road',
    line2: '',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  };

  // 1. Initial guest order succeeds and claims 1 unit
  const first = await createOrderUsing(sql, {
    txnid: 'GDZ_GUEST_1',
    userId: null,
    cartItems: [{ id: 'prod_1', quantity: 1 }],
    customerName: 'Riya Sen',
    customerEmail: 'riya@example.test',
    customerPhone: '9876543210',
    shippingAddress: baseAddress,
    reservationSeconds: 600,
  });
  assert.equal(first.resumed, false);
  assert.equal(first.stockClaimed, true);
  assert.equal(dbl.getStock(), 4);
  assert.equal(dbl.orders.length, 1);

  // 2. Identical retry resumes atomically with no duplicate order or stock deduction
  const resumed = await createOrderUsing(sql, {
    txnid: 'GDZ_GUEST_1_RETRY',
    userId: null,
    cartItems: [{ id: 'prod_1', quantity: 1 }],
    customerName: 'Riya Sen',
    customerEmail: 'RIYA@example.test',
    customerPhone: '9876543210',
    shippingAddress: baseAddress,
    reservationSeconds: 600,
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.stockClaimed, false);
  assert.equal(resumed.order.txnid, 'GDZ_GUEST_1');
  assert.equal(dbl.orders.length, 1);
  assert.equal(dbl.getStock(), 4);

  // 3. Different shipping address reusing same email is refused (prevents stacking holds / cross-actor hijack)
  await assert.rejects(
    () =>
      createOrderUsing(sql, {
        txnid: 'GDZ_GUEST_HOARD_ADDR',
        userId: null,
        cartItems: [{ id: 'prod_1', quantity: 1 }],
        customerName: 'Riya Sen',
        customerEmail: 'riya@example.test',
        customerPhone: '9876543210',
        shippingAddress: { ...baseAddress, line1: '99 Alternate Ave', pincode: '560002' },
        reservationSeconds: 600,
      }),
    (err) => err instanceof GuestReservationLimitError && err.code === 'active_reservation_exists',
  );
  assert.equal(dbl.orders.length, 1);
  assert.equal(dbl.getStock(), 4);

  // 4. Different email reusing same phone is also refused
  await assert.rejects(
    () =>
      createOrderUsing(sql, {
        txnid: 'GDZ_GUEST_HOARD_PHONE',
        userId: null,
        cartItems: [{ id: 'prod_1', quantity: 1 }],
        customerName: 'Riya Sen',
        customerEmail: 'second-alias@example.test',
        customerPhone: '9876543210',
        shippingAddress: baseAddress,
        reservationSeconds: 600,
      }),
    (err) => err instanceof GuestReservationLimitError && err.code === 'active_reservation_exists',
  );

  // 5. Same guest updating cart items supersedes cleanly AND caps remaining TTL (never extends window)
  dbl.orders[0].reservation_expires_at = new Date(Date.now() + 240_000);
  const replaced = await createOrderUsing(sql, {
    txnid: 'GDZ_GUEST_2',
    userId: null,
    cartItems: [{ id: 'prod_2', quantity: 1 }],
    customerName: 'Riya Sen',
    customerEmail: 'riya@example.test',
    customerPhone: '9876543210',
    shippingAddress: baseAddress,
    reservationSeconds: 600,
  });
  assert.equal(replaced.resumed, false);
  assert.equal(dbl.orders[0].status, 'CANCELLED');
  assert.equal(dbl.orders[0].reservation_state, 'RELEASED');
  assert.equal(dbl.getStock(), 5, 'released prod_1 unit when superseded');
  assert.ok(
    dbl.orders[1].recordedIntervalSec <= 240 && dbl.orders[1].recordedIntervalSec >= 235,
    `expected capped TTL <= 240s, got ${dbl.orders[1].recordedIntervalSec}s`,
  );

  // 6. Active PROCESSING guest order refuses replacement even for identical contact/address
  dbl.orders[1].status = 'PROCESSING';
  await assert.rejects(
    () =>
      createOrderUsing(sql, {
        txnid: 'GDZ_GUEST_WHILE_PROCESSING',
        userId: null,
        cartItems: [{ id: 'prod_1', quantity: 1 }],
        customerName: 'Riya Sen',
        customerEmail: 'riya@example.test',
        customerPhone: '9876543210',
        shippingAddress: baseAddress,
        reservationSeconds: 600,
      }),
    (err) => err instanceof GuestReservationLimitError,
  );

  // 7. Expired reservation is cleaned up cleanly and no longer blocks the buyer
  dbl.expireOrderById(dbl.orders[1].id);
  const afterExpiry = await createOrderUsing(sql, {
    txnid: 'GDZ_GUEST_3',
    userId: null,
    cartItems: [{ id: 'prod_1', quantity: 1 }],
    customerName: 'Riya Sen',
    customerEmail: 'riya@example.test',
    customerPhone: '9876543210',
    shippingAddress: { ...baseAddress, line1: '77 New St' },
    reservationSeconds: 600,
  });
  assert.equal(afterExpiry.order.txnid, 'GDZ_GUEST_3');
  assert.equal(dbl.orders[1].reservation_state, 'EXPIRED');
  assert.equal(dbl.getStock(), 4);
});

test('SEC-008 initiate route: enforces distributed guest IP limit (5/10m) and returns clean 409 active_reservation_exists even with couponCode', async () => {
  const prevTrustProxy = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';

  const rateRows = [];
  let nextRateId = 1;
  let txChain = Promise.resolve();
  const sharedRateSql = (() => {
    const conn = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim();
      if (q.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: '' }];
      if (q.includes('from auth_rate_limits') && q.includes('count(*)')) {
        const [scope, bucketKey, cutoff] = values;
        const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : Date.parse(String(cutoff));
        const matching = rateRows.filter(
          (r) => r.scope === scope && r.bucket_key === bucketKey && r.created_at.getTime() > cutoffMs,
        );
        const oldest = matching.length
          ? new Date(Math.min(...matching.map((r) => r.created_at.getTime())))
          : null;
        return [{ hits: matching.length, oldest }];
      }
      if (q.includes('insert into auth_rate_limits')) {
        const [nowVal, scopes, hashes] = values;
        const createdAt = nowVal instanceof Date ? nowVal : new Date(nowVal);
        for (let i = 0; i < scopes.length; i += 1) {
          rateRows.push({
            id: nextRateId++,
            scope: scopes[i],
            bucket_key: hashes[i],
            created_at: createdAt,
          });
        }
        return [];
      }
      throw new Error(`Unexpected SQL: ${q}`);
    };
    conn.begin = async (fn) => {
      const prev = txChain;
      let release;
      txChain = new Promise((r) => {
        release = r;
      });
      await prev;
      try {
        return await fn(conn);
      } finally {
        release();
      }
    };
    return conn;
  })();

  let rejectReservation = false;

  try {
    const loadInitiate = async () => {
      const jiti = createJiti(import.meta.url, {
        moduleCache: false,
        alias: { '@': path.join(root, 'src') },
        virtualModules: {
          'next/server': { NextRequest, NextResponse },
          '@/lib/payu/db-pricing': pricing,
          '@/lib/platform/db': { getSql: () => sharedRateSql },
          '@/lib/storefront/sale-state': { readSaleState: async () => ({ live: false, unreadable: false }) },
          '@/lib/payu/orders': {
            findActiveReservationForUser: async () => null,
            findActiveReservationForGuest: async () => null,
            getOrderByTxnid: async () => null,
            getOrderShippingAddress: async () => null,
            isIdenticalCheckoutAttempt: () => false,
            isGuestReservationLimitError: (err) =>
              Boolean(err && err.name === 'GuestReservationLimitError'),
            createOrder: async (params) => {
              if (rejectReservation) {
                const err = new Error(
                  'An active checkout reservation already exists. Please complete your pending payment or wait before trying again.',
                );
                err.name = 'GuestReservationLimitError';
                err.code = 'active_reservation_exists';
                err.retryAfterSec = 321;
                throw err;
              }
              return {
                order: {
                  txnid: 'GDZ_OK',
                  totalPaise: 100000,
                  items: [{ name: 'MagSafe Case', quantity: 1 }],
                },
                stockClaimed: false,
                resumed: false,
                supersededOrders: [],
                expiredReservations: [],
              };
            },
          },
          '@/lib/user-auth': { getUserSession: async () => null },
          '@/lib/account/addresses': { getCustomerAddress: async () => null },
          '@/lib/platform/api-guard': { assertSameOrigin: () => null },
          '@/lib/storefront/maintenance-guard': { requireStorefrontOpen: async () => null },
          '@/lib/store-admin/customer-settings': { readCustomerSettings: async () => ({ guest_checkout: 'on' }) },
          '@/lib/checkout/settings': {
            readCheckoutConfiguration: async () => ({
              ok: true,
              settings: { payu_enabled: 'on', coupons_enabled: 'on', mail_status: 'off' },
            }),
          },
          '@/lib/payu/config': {
            checkPayUConfiguration: () => ({ ok: true, appBaseUrl: 'https://gadzio.in' }),
            getPayUConfig: () => ({ key: 'k', salt: 's', paymentUrl: 'https://pay.example' }),
            getPayUCallbackUrls: () => ({
              surl: 'https://gadzio.in/s',
              furl: 'https://gadzio.in/f',
              curl: 'https://gadzio.in/c',
            }),
          },
          '@/lib/payu/hash': { generateRequestHash: () => ({ hash: 'h' }) },
          '@/lib/notifications/order-context': { queueOrderEvent: () => {} },
          '@/lib/store-admin/subscribers': { subscribeToNewsletter: () => {} },
          '@/lib/storefront/revalidate': { revalidateCatalog: () => {} },
        },
      });
      return jiti.import(path.join(root, 'src/app/api/payu/initiate/route.ts'));
    };

    const instA = await loadInitiate();
    const instB = await loadInitiate();

    const makeReq = (ip, withCoupon = false) =>
      new NextRequest('https://gadzio.in/api/payu/initiate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://gadzio.in',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          items: [{ id: 'prod_1', quantity: 1 }],
          customer: { firstname: 'Riya', email: 'riya@example.test', phone: '9876543210' },
          shippingAddress: {
            name: 'Riya Sen',
            phone: '9876543210',
            line1: '12 MG Road',
            line2: '',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
          ...(withCoupon ? { couponCode: 'SAVE10' } : {}),
        }),
      });

    // 1. GuestReservationLimitError returns 409 active_reservation_exists + Retry-After, even with couponCode, with zero PII/txnid
    rejectReservation = true;
    const conflictRes = await instA.POST(makeReq('198.51.100.10', true));
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.headers.get('retry-after'), '321');
    const conflictBody = await conflictRes.json();
    assert.equal(conflictBody.code, 'active_reservation_exists');
    assert.equal(conflictBody.statusUrl, undefined);
    assert.doesNotMatch(JSON.stringify(conflictBody), /GDZ_|riya@example\.test|9876543210/);

    // 2. Distributed guest IP cap (5 / 10m across separate instances): 1 consumed above -> 2..5 ok -> 6th returns 429
    rejectReservation = false;
    for (let i = 2; i <= 5; i += 1) {
      const target = i % 2 === 0 ? instB : instA;
      const res = await target.POST(makeReq('198.51.100.10'));
      assert.equal(res.status, 200);
    }
    const sixth = await instB.POST(makeReq('198.51.100.10'));
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.headers.get('retry-after')) >= 1);
  } finally {
    if (prevTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrustProxy;
  }
});

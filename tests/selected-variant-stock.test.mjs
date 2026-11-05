import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

// Strictly offline: never load .env.local, construct a postgres client or call PayU.
// The real checkout/stock/payment functions below receive our SQL transaction
// double. This checks service behavior and bindings, NOT PostgreSQL acceptance,
// locking, constraints, isolation or concurrent callback execution.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envKeys = ['DATABASE_URL', 'PAYU_KEY', 'PAYU_SALT', 'APP_BASE_URL'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const savedFetch = globalThis.fetch;
let externalCalls = 0;
delete process.env.DATABASE_URL;
process.env.PAYU_KEY = 'offline-fixture-key';
process.env.PAYU_SALT = 'offline-fixture-salt';
process.env.APP_BASE_URL = 'https://store.example.test';
globalThis.fetch = async () => { externalCalls++; throw new Error('Unexpected network request'); };
after(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = savedFetch;
  assert.equal(externalCalls, 0, 'all SQL and gateway calls must stay injected');
});

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
  virtualModules: {
    '@/lib/platform/db': { getSql: () => { externalCalls++; throw new Error('Unexpected application SQL'); } },
    postgres: { default: () => { externalCalls++; throw new Error('Unexpected postgres client'); } },
  },
});
const { createOrderUsing, releaseOrderReservation, LATE_PAYMENT_REVIEW_REASON } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));
const { lockStockIdentities, claimPlannedStock, releaseClaimedStock } = await jiti.import(path.join(root, 'src/lib/payu/stock.ts'));
const { processPayUCallback } = await jiti.import(path.join(root, 'src/lib/payu/process-response.ts'));
const { computeReverseHash } = await jiti.import(path.join(root, 'src/lib/payu/hash.ts'));

const PRODUCT = 'iphone16';
const BLACK = 'iphone16-black';
const BLUE = 'iphone16-blue';
const REPLACEMENT = 'iphone16-black-replacement';
const SHARED = 'iphone15';
const NOW = new Date('2026-11-03T12:00:00Z');
const policy = { reservationSeconds: 600, failureGraceSeconds: 0, unresolvedMinutes: 60 };
const key = (productId, variantId) => JSON.stringify([productId, variantId ?? null]);
const clone = value => structuredClone(value);

// `optionSnapshot` models migration 0061 being applied: the catalogue rows
// carry the model/colour/photo and the order_items columns exist.
function fixture({ blackOnHand = 10, blackReserved = 0, missingBlack = false,
  optionSnapshot = false } = {}) {
  const stockRow = (product_id, variant_id, on_hand, reserved = 0) => ({
    id: key(product_id, variant_id), product_id, variant_id, on_hand, reserved, track_inventory: true,
  });
  let stocks = [
    stockRow(PRODUCT, null, 90), // Retained parent stock is not variant inventory.
    stockRow(PRODUCT, BLACK, blackOnHand, blackReserved),
    stockRow(PRODUCT, 'iphone16-blue', 20),
    stockRow(PRODUCT, 'iphone15-black', 15), // A different model under the same base product.
    stockRow('iphone15', null, 80),
    stockRow('iphone15', 'iphone15-black', 30),
  ].filter(row => !missingBlack || row.variant_id !== BLACK);
  // Eligibility is deliberately separate from retained historical stock. This
  // double supplies the eligible SQL result, not an implementation/proof of
  // PostgreSQL's active/compatibility/category predicates.
  let eligibleVariants = [BLACK, BLUE];
  let catalogPrice = 50000;
  let now = new Date(NOW);
  let forbidCatalog = false;
  let order = null;
  let movements = [];
  let items = [];
  let history = [];
  let events = [];
  let obligations = [];
  const queries = [];
  const untouched = () => clone(stocks.filter(row => row.variant_id !== BLACK));
  const originalUntouched = untouched();

  // Synchronous on purpose: inline `sql`...`` fragments compose the catalogue
  // statement in postgres.js, so this double returns fragment text rather than
  // a promise. Every real query still returns an awaitable array.
  const sql = (strings, ...values) => {
    const text = strings.reduce((all, part, i) => all + (i ? `$${i}` : '') + part, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    // The colour-photo subquery, the snapshot column list and the colour join
    // are fragments of the catalogue statement, not separate queries.
    if (text === '' || text.startsWith('(') || text.includes('as variant_device_model_id')
      || text.startsWith('left join product_variant_colours')) return text;
    queries.push({ text, values: clone(values) });
    if (text === 'select pg_advisory_xact_lock_shared(513031,3)') return [];
    if (text.startsWith('select o.id from orders o') || text.startsWith('select o.id, o.txnid, o.status from orders o')) return [];
    if (text === 'select now() as now') return [{ now: new Date(now) }];
    if (text === 'select clock_timestamp() as db_now') return [{ db_now: new Date(now) }];
    if (text.includes('from sale_settings')) return [{ enabled: false, db_now: new Date(now) }];
    if (text.startsWith('select key, value from store_settings')) return [
      { key: 'payu_enabled', value: 'on' },
      { key: 'shipping_enabled', value: 'off' },
      { key: 'shipping_charge_paise', value: '0' },
      { key: 'free_shipping_threshold_paise', value: '' },
      { key: 'auto_confirm', value: 'off' },
      { key: 'default_fulfilment_status', value: 'PENDING' },
    ];
    // The offline schema predates 0059/0060/0061: the capability probes must
    // report the older shape so the exact previous SQL is exercised.
    if (text.includes("to_regclass('colours')")) return [{ colours: false }];
    if (text.includes('from information_schema.columns')) return [{ present: optionSnapshot }];
    if (text.includes('from products p')) {
      assert.equal(forbidCatalog, false, 'historical release/reclaim must not query current purchase eligibility');
      const rows = eligibleVariants.filter(id => stocks.some(s => s.product_id === PRODUCT && s.variant_id === id))
        .map(variant_id => ({ id: PRODUCT, name: 'iPhone 16', inventory_mode: 'variant',
          variant_id, variant_sku: `SKU-${variant_id}`, variant_label: variant_id,
          price_paise: catalogPrice, sale_price_paise: null, option_price_paise: null,
          option_sale_price_paise: null, track_inventory: true, in_stock: true,
          ...(optionSnapshot ? {
            variant_device_model_id: 'iphone-16', variant_device_model_name: 'iPhone 16',
            variant_colour_id: variant_id === BLACK ? 'black' : 'blue',
            variant_colour_name: variant_id === BLACK ? 'Black' : 'Blue',
            variant_colour_hex: variant_id === BLACK ? '#1D1D1F' : '#0071E3',
            // The SQL aliases the single chosen photo as url + unit separator + alt.
            image: `/images/${variant_id}.png${String.fromCharCode(31)}iPhone 16 ${variant_id}`,
          } : {}) }));
      rows.push({ id: SHARED, name: 'Shared compatibility product', inventory_mode: 'product',
        variant_id: null, price_paise: 12000, sale_price_paise: null,
        track_inventory: true, in_stock: true });
      // Fragments occupy value slots ahead of the id array in this double.
      const ids = values.find(value => Array.isArray(value)) ?? [];
      return rows.filter(row => ids.includes(row.id));
    }
    if (text.startsWith('insert into orders (')) {
      const columns = text.match(/^insert into orders \((.*?)\) values/)[1].split(',').map(s => s.trim());
      // These columns precede literal CREATED/web/payu status values. Remaining
      // bindings are explicit so a changed production statement fails loudly.
      order = Object.fromEntries(columns.slice(0, 7).map((column, i) => [column, clone(values[i])]));
      Object.assign(order, { status: 'CREATED', fulfilment_status: 'PENDING',
        subtotal_paise: values[8], discount_paise: values[9], shipping_paise: values[10], total_paise: values[11],
        customer_name: values[16], customer_email: values[17], customer_phone: values[18],
        reservation_state: values[19], reservation_expires_at: new Date(NOW.getTime() + 600_000),
        created_at: new Date(now), updated_at: new Date(now), paid_at: null,
        payment_review_required: false, payment_review_reason: '' });
      assert.equal(order.reservation_state, 'ACTIVE');
      return [clone(order)];
    }
    if (text.startsWith('insert into order_addresses')) return [];
    if (text.startsWith('insert into order_items')) { items.push(clone(values)); return []; }
    if (text.startsWith('insert into order_status_history')) { history.push(clone(values)); return []; }
    if (text.startsWith('insert into payment_events')) { events.push(clone(values)); return []; }
    if (text.startsWith('select * from orders where txnid')) return order?.txnid === values[0] ? [clone(order)] : [];
    if (text.startsWith('select * from orders where payu_mihpayid')) return order?.payu_mihpayid === values[0] ? [clone(order)] : [];
    if (text.startsWith('select * from orders where id')) return order?.id === values[0] ? [clone(order)] : [];
    if (text.startsWith('select id from orders where id')) return order?.id === values[0] ? [{ id: order.id }] : [];
    if (text.startsWith('update orders set status')) {
      assert.equal(values[13], order.id);
      Object.assign(order, { status: values[0], payu_mihpayid: values[1] ?? order.payu_mihpayid,
        paid_at: values[4], reservation_state: values[7], reservation_expires_at: values[8],
        processing_deadline: values[11] });
      return [];
    }
    if (text.startsWith('update orders set reservation_state')) {
      if (text.includes("reservation_state = 'consumed'")) {
        assert.equal(values[0], order.id);
        order.reservation_state = 'CONSUMED';
      } else {
        assert.equal(values[6], order.id);
        Object.assign(order, { reservation_state: values[0], reservation_released_at: new Date(now),
          reservation_released_reason: values[1], status: values[2], processing_deadline: null });
      }
      return [];
    }
    if (text.startsWith('update orders set payment_review_required')) {
      assert.equal(values[1], order.id);
      Object.assign(order, { payment_review_required: true, payment_review_reason: values[0] });
      return [];
    }
    if (text.startsWith('insert into refund_obligations')) {
      assert.match(text, /on conflict \(order_id\) where status = 'pending' do nothing returning id$/);
      if (obligations.some(row => row.order_id === values[1] && row.status === 'PENDING')) return [];
      obligations.push({ id: values[0], order_id: values[1], amount_paise: values[2], reason: values[3], status: 'PENDING' });
      return [{ id: values[0] }];
    }
    if (text.startsWith('select id from refund_obligations')) {
      return obligations.filter(row => row.order_id === values[0] && row.status === 'PENDING').map(row => ({ id: row.id }));
    }
    if (text.includes("to_regclass('coupon_redemptions')")) return [{ name: null }];
    if (text.startsWith('select product_id,variant_id,sum(delta)::int as quantity from stock_movements')) {
      const released = new Map();
      for (const movement of movements.filter(row => row.order_id === values[0] && row.reason === 'release')) {
        const identity = key(movement.product_id, movement.variant_id);
        const previous = released.get(identity);
        released.set(identity, { product_id: movement.product_id, variant_id: movement.variant_id,
          quantity: (previous?.quantity ?? 0) + movement.delta });
      }
      return [...released.values()].sort((a, b) => key(a.product_id, a.variant_id).localeCompare(key(b.product_id, b.variant_id)));
    }
    if (text.startsWith('select distinct product_id,variant_id from stock_movements')) {
      return [...new Map(movements.filter(m => m.order_id === values[0] && m.reason === 'sale')
        .map(m => [key(m.product_id, m.variant_id), { product_id: m.product_id, variant_id: m.variant_id }])).values()];
    }
    if (text.includes('from stock_movements where order_id=') && text.startsWith('select coalesce(sum')) {
      assert.match(text, /variant_id is not distinct from \$3::text/);
      const matches = movements.filter(m => m.order_id === values[0] && key(m.product_id, m.variant_id) === key(values[1], values[2]));
      return [{ claimed: matches.filter(m => m.reason === 'sale').reduce((n, m) => n - m.delta, 0),
        released: matches.filter(m => ['release', 'return'].includes(m.reason)).reduce((n, m) => n + m.delta, 0) }];
    }
    if (text.startsWith('insert into stock_movements')) {
      movements.push({ product_id: values[0], variant_id: values[1], delta: values[2],
        reason: text.includes("'release'") ? 'release' : 'sale', order_id: values[3] });
      return [];
    }
    if (text.startsWith('select product_id, variant_id, on_hand, reserved, track_inventory from stock where')) {
      assert.match(text, /for update$/);
      return stockIdentityRows(text, values).map(clone);
    }
    if (text.startsWith('update stock set on_hand=')) {
      const matches = stockIdentityRows(text, values);
      const decrement = text.includes('on_hand=on_hand-');
      const quantity = values[0];
      assert.ok(Number.isSafeInteger(quantity) && quantity > 0);
      const trackedClaim = text.includes('and track_inventory');
      if (decrement) assert.match(text, trackedClaim
        ? /and track_inventory and on_hand - reserved >= \$4/
        : /and on_hand-reserved>=\$4 returning id$/);
      const changed = matches.filter(row => !decrement || (!trackedClaim || row.track_inventory) && row.on_hand - row.reserved >= quantity);
      for (const row of changed) row.on_hand += decrement ? -quantity : quantity;
      return changed.map(row => ({ id: row.id, product_id: row.product_id }));
    }
    throw new Error(`Unexpected offline SQL: ${text}`);
  };
  function stockIdentityRows(text, values) {
    const product = text.match(/where product_id=\$(\d+)/);
    const variant = text.match(/and variant_id is not distinct from \$(\d+)::text/);
    assert.ok(product && variant, 'every stock read/write must bind both product_id and null-safe variant_id');
    return stocks.filter(row => key(row.product_id, row.variant_id) === key(values[Number(product[1]) - 1], values[Number(variant[1]) - 1]));
  }
  sql.json = value => value;
  sql.begin = async fn => {
    // In-memory rollback is a fixture convenience, not proof of DB atomicity.
    const snapshot = clone({ stocks, order, movements, items, history, events, obligations });
    try { return await fn(sql); }
    catch (error) { ({ stocks, order, movements, items, history, events, obligations } = snapshot); throw error; }
  };
  return { sql, queries, order: () => clone(order), movements: () => clone(movements),
    items: () => clone(items), history: () => clone(history), events: () => clone(events),
    obligations: () => clone(obligations), stocks: () => clone(stocks),
    stock: (productId, variantId = null) => clone(stocks.find(row => key(row.product_id, row.variant_id) === key(productId, variantId))),
    selected: () => clone(stocks.find(row => row.product_id === PRODUCT && row.variant_id === BLACK)),
    replaceSource() {
      eligibleVariants = [REPLACEMENT, BLUE];
      catalogPrice = 65000; // Changed current price cannot rewrite an old order.
      stocks.push(stockRow(PRODUCT, REPLACEMENT, 40));
    },
    blockHistoricalCatalog() { forbidCatalog = true; },
    advanceToExpiry() { now = new Date(order.reservation_expires_at); },
    setStock(productId, variantId, changes) {
      Object.assign(stocks.find(row => key(row.product_id, row.variant_id) === key(productId, variantId)), changes);
    },
    removeStock(productId, variantId) {
      stocks = stocks.filter(row => key(row.product_id, row.variant_id) !== key(productId, variantId));
    },
    assertUntouched: () => assert.deepEqual(untouched(), originalUntouched, 'Blue, iPhone15 and parent stock rows stay unchanged') };
}

const variantLine = (variantId = BLACK, quantity = 1, expectedUnitPaise = 50000) => ({
  id: `${PRODUCT}::variant::${variantId}`, variantId, quantity, expectedUnitPaise,
});
const mixedLines = () => [variantLine(BLACK, 2), variantLine(BLUE, 3),
  { id: `${SHARED}::colour::clear::model::iphone15`, quantity: 4, expectedUnitPaise: 12000 }];

async function reserve(f, cartItems = [variantLine()]) {
  return createOrderUsing(f.sql, {
    txnid: 'OFFLINE_SELECTED_VARIANT', cartItems,
    expectedTotalPaise: cartItems.reduce((total, line) => total + line.quantity * line.expectedUnitPaise, 0),
    currency: 'INR', reservationSeconds: policy.reservationSeconds,
    customerName: 'Offline Fixture', customerEmail: 'offline@example.test', customerPhone: '9000000000',
    shippingAddress: { name: 'Offline Fixture', phone: '9000000000', line1: '1 Fixture Lane',
      city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  });
}
async function callback(f, { verified = true, cancelled = false, failureGraceSeconds = 0 } = {}) {
  const amountPaise = f.order().total_paise;
  const amount = (amountPaise / 100).toFixed(2);
  const data = { key: process.env.PAYU_KEY, txnid: f.order().txnid, amount, currency: 'INR',
    status: cancelled ? 'failure' : 'success', unmappedstatus: cancelled ? 'userCancelled' : 'captured',
    mihpayid: 'offline_gateway_id' };
  const payload = { ...data, hash: computeReverseHash({ ...data, salt: process.env.PAYU_SALT }) };
  return processPayUCallback(payload, 'webhook', { sql: f.sql, policy: { ...policy, failureGraceSeconds }, sideEffects: false,
    verifier: async (txnid, expectedAmount) => {
      assert.equal(txnid, f.order().txnid);
      assert.equal(expectedAmount, amountPaise / 100);
      return { verified: verified && !cancelled, status: cancelled ? 'failure' : verified ? 'success' : 'UNKNOWN',
        unmappedstatus: cancelled ? 'userCancelled' : verified ? 'captured' : 'NETWORK_ERROR',
        amount, amountPaise, mihpayid: 'offline_gateway_id', mode: 'UPI', raw: null };
    } });
}

function assertClaim(f) {
  assert.equal(f.selected().on_hand, 9, 'one selected Black unit: 10 -> 9');
  assert.equal(f.selected().reserved, 0, 'checkout holds decrement on_hand, not the reserved counter');
  assert.deepEqual(f.movements(), [{ product_id: PRODUCT, variant_id: BLACK, delta: -1, reason: 'sale', order_id: f.order().id }]);
  f.assertUntouched();
}

// Match the Phase 4 exact-selection error, not infrastructure/stock failures.
function selectionUnavailable(error) {
  assert.equal(error.name, 'SelectionUnavailableError');
  assert.deepEqual(error.selection, { id: PRODUCT, variantId: BLACK });
  return true;
}

function savedSnapshots(f) {
  return { json: f.order().items, normalized: f.items(), totalPaise: f.order().total_paise };
}
function assertSnapshots(f, original) {
  assert.deepEqual(savedSnapshots(f), original, 'historical product/variant/SKU/quantity/price snapshots must not change');
}
function assertOtherStockUnchanged(f, before, identities) {
  const wanted = new Set(identities.map(([productId, variantId]) => key(productId, variantId)));
  assert.deepEqual(f.stocks().filter(row => !wanted.has(key(row.product_id, row.variant_id))),
    before.filter(row => !wanted.has(key(row.product_id, row.variant_id))),
    'replacement, siblings, other-model and retained parent stock must not substitute for original claims');
}
function stockWrites(f) {
  return f.queries.filter(q => /^(update stock|insert into stock_movements)/.test(q.text));
}
async function expire(f) {
  f.advanceToExpiry();
  return releaseOrderReservation({ txnid: f.order().txnid, state: 'EXPIRED',
    reason: 'Offline checkout window expired', cancelOrder: true }, f.sql);
}

function assertMixedSnapshots(f) {
  assert.deepEqual(f.order().items.map(item => ({ productId: item.id, variantId: item.variantId ?? null,
    sku: item.variantSku ?? null, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.totalPrice })), [
    { productId: PRODUCT, variantId: BLACK, sku: `SKU-${BLACK}`, quantity: 2, unitPrice: 500, totalPrice: 1000 },
    { productId: PRODUCT, variantId: BLUE, sku: `SKU-${BLUE}`, quantity: 3, unitPrice: 500, totalPrice: 1500 },
    { productId: SHARED, variantId: null, sku: null, quantity: 4, unitPrice: 120, totalPrice: 480 },
  ]);
  assert.deepEqual(f.items().map(row => ({ productId: row[2], quantity: row[4],
    unitPaise: row[5], totalPaise: row[6], variantId: row[9], sku: row[10] })), [
    { productId: PRODUCT, quantity: 2, unitPaise: 50000, totalPaise: 100000, variantId: BLACK, sku: `SKU-${BLACK}` },
    { productId: PRODUCT, quantity: 3, unitPaise: 50000, totalPaise: 150000, variantId: BLUE, sku: `SKU-${BLUE}` },
    { productId: SHARED, quantity: 4, unitPaise: 12000, totalPaise: 48000, variantId: null, sku: null },
  ]);
  assert.equal(f.order().total_paise, 298000);
}

test('actual checkout reserves selected Black stock; verified callback consumes in place and replay cannot decrement twice', async () => {
  const f = fixture();
  const created = await reserve(f);
  assert.equal(created.stockClaimed, true);
  assert.equal(created.order.reservationState, 'ACTIVE');
  assert.equal(created.order.items[0].variantId, BLACK);
  assert.equal(f.items()[0][2], PRODUCT, 'normalized order item keeps the base product');
  assert.equal(f.items()[0][9], BLACK, 'normalized order item keeps the selected variant');
  assertClaim(f);

  const paid = await callback(f);
  assert.equal(paid.ok, true);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.order.reservationState, 'CONSUMED');
  assertClaim(f);
  const writesBeforeReplay = f.queries.filter(q => /^(update stock|insert into stock_movements)/.test(q.text)).length;
  const replay = await callback(f);
  assert.equal(replay.status, 'PAID');
  assert.equal(replay.order.reservationState, 'CONSUMED');
  assert.equal(f.history().length, 2, 'CREATED and PAID only; replay writes no transition');
  assert.deepEqual(f.events().map(e => e[4]), ['paid', 'unchanged']);
  assert.equal(f.queries.filter(q => /^(update stock|insert into stock_movements)/.test(q.text)).length, writesBeforeReplay);
  assertClaim(f);
});

test('checkout snapshots the exact model, colour, price and photo when 0061 is applied', async () => {
  const f = fixture({ optionSnapshot: true });
  await reserve(f);
  const item = f.order().items[0];
  assert.equal(item.deviceModelId, 'iphone-16');
  assert.equal(item.deviceModelName, 'iPhone 16');
  assert.equal(item.colourId, 'black');
  assert.equal(item.colourName, 'Black');
  assert.equal(item.colourHex, '#1D1D1F');
  assert.equal(item.image, `/images/${BLACK}.png`);
  assert.equal(item.imageAlt, `iPhone 16 ${BLACK}`);
  assert.equal(item.unitPrice, 500, 'the snapshot amount is the row price that was charged');
  const inserted = f.items()[0];
  assert.equal(f.queries.find(q => q.text.startsWith('insert into order_items')).text.includes('variant_colour_id'), true);
  assert.deepEqual({ model: inserted[12], modelName: inserted[13], colour: inserted[14], colourName: inserted[15],
    hex: inserted[16], image: inserted[17], alt: inserted[18] },
  { model: 'iphone-16', modelName: 'iPhone 16', colour: 'black', colourName: 'Black',
    hex: '#1D1D1F', image: `/images/${BLACK}.png`, alt: `iPhone 16 ${BLACK}` });
  // A later rename or photo replacement cannot rewrite what the order sold.
  const saved = clone(f.order().items);
  await callback(f);
  assert.deepEqual(f.order().items, saved);
});

test('an older database keeps the previous order_items insert and still reserves stock', async () => {
  const f = fixture();
  await reserve(f);
  const insert = f.queries.find(q => q.text.startsWith('insert into order_items'));
  assert.doesNotMatch(insert.text, /image_url|variant_colour_id|variant_device_model_id/);
  assert.equal(f.items()[0][9], BLACK);
  assert.equal(f.order().items[0].deviceModelName, null, 'no snapshot column was written');
  assertClaim(f);
});

test('unverified success keeps the exact claim held; later verified capture consumes without another decrement', async () => {
  const f = fixture();
  await reserve(f);
  const pending = await callback(f, { verified: false });
  assert.equal(pending.status, 'PROCESSING');
  assert.equal(pending.order.reservationState, 'ACTIVE');
  assertClaim(f);
  const paid = await callback(f);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.order.reservationState, 'CONSUMED');
  assertClaim(f);
});

test('zero-grace cancellation releases only the selected row; callback and ledger-release replays are no-ops', async () => {
  const f = fixture();
  await reserve(f);
  assertClaim(f);
  const cancelled = await callback(f, { cancelled: true });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.order.reservationState, 'RELEASED');
  assert.equal(f.selected().on_hand, 10);
  assert.equal(f.selected().reserved, 0);
  assert.deepEqual(f.movements(), [
    { product_id: PRODUCT, variant_id: BLACK, delta: -1, reason: 'sale', order_id: f.order().id },
    { product_id: PRODUCT, variant_id: BLACK, delta: 1, reason: 'release', order_id: f.order().id },
  ]);
  await callback(f, { cancelled: true });
  assert.equal(await releaseClaimedStock(f.sql, f.order().id), false, 'actual release service uses outstanding exact-variant ledger balance');
  assert.equal(f.movements().length, 2);
  assert.equal(f.history().length, 2);
  assert.equal(f.selected().on_hand, 10);
  f.assertUntouched();
});

test('cancellation with the default failure grace keeps the selected claim for a later verified capture', async () => {
  const f = fixture();
  await reserve(f);
  const cancelled = await callback(f, { cancelled: true, failureGraceSeconds: 120 });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.order.reservationState, 'ACTIVE');
  assert.equal(cancelled.order.reservationExpiresAt.toISOString(), new Date(NOW.getTime() + 120_000).toISOString());
  assertClaim(f);
  const paid = await callback(f);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.order.reservationState, 'CONSUMED');
  assertClaim(f);
});

for (const [label, setup] of [['missing', { missingBlack: true }], ['empty', { blackOnHand: 0 }]]) {
  test(`${label} selected stock fails closed despite available sibling and parent inventory`, async () => {
    const f = fixture(setup);
    await assert.rejects(reserve(f), label === 'empty' ? { name: 'InsufficientStockError' } : selectionUnavailable);
    assert.equal(f.order(), null);
    assert.deepEqual(f.movements(), []);
    f.assertUntouched();
  });
}

test('actual stock exports lock only the requested identity and enforce its reserved availability at final claim', async () => {
  const f = fixture({ blackReserved: 10 });
  const request = { productId: PRODUCT, variantId: BLACK, quantity: 1, productName: 'iPhone 16 Black' };
  const locked = await lockStockIdentities(f.sql, [request, request]);
  assert.equal(locked.length, 1, 'duplicate requested identity locks once');
  assert.equal(locked[0].variant_id, BLACK);
  assert.equal(f.queries.length, 1);
  await assert.rejects(claimPlannedStock(f.sql, 'ord_offline', [request]), { name: 'InsufficientStockError', code: 'insufficient_stock' });
  assert.equal(f.selected().on_hand, 10);
  assert.equal(f.selected().reserved, 10);
  assert.deepEqual(f.movements(), []);
  f.assertUntouched();
});

test('retired source remains stocked but stale purchase is rejected; only explicit eligible replacement ID can buy', async () => {
  const f = fixture();
  f.replaceSource();
  const before = f.stocks();
  await assert.rejects(reserve(f), selectionUnavailable);
  assert.equal(f.order(), null);
  assert.deepEqual(f.movements(), []);
  assert.deepEqual(f.stocks(), before, 'a stale cart must not consume source, replacement, sibling or parent stock');

  const created = await reserve(f, [variantLine(REPLACEMENT, 2, 65000)]);
  assert.equal(created.stockClaimed, true);
  assert.equal(created.order.items[0].variantId, REPLACEMENT);
  assert.equal(created.order.items[0].variantSku, `SKU-${REPLACEMENT}`);
  assert.equal(created.order.items[0].quantity, 2);
  assert.equal(created.order.items[0].unitPrice, 650);
  assert.equal(created.order.totalPaise, 130000);
  assert.equal(f.stock(PRODUCT, REPLACEMENT).on_hand, 38);
  assert.deepEqual(f.movements(), [{ product_id: PRODUCT, variant_id: REPLACEMENT,
    delta: -2, reason: 'sale', order_id: created.order.id }]);
  assertOtherStockUnchanged(f, before, [[PRODUCT, REPLACEMENT]]);
});

test('historical cancellation releases original retired identity without current eligibility or snapshot replacement', async () => {
  const f = fixture();
  await reserve(f, [variantLine(BLACK, 2)]);
  const snapshots = savedSnapshots(f);
  f.replaceSource();
  f.blockHistoricalCatalog();
  const before = f.stocks();
  const cancelled = await callback(f, { cancelled: true });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.order.reservationState, 'RELEASED');
  assert.equal(f.selected().on_hand, 10);
  assert.deepEqual(f.movements().map(row => [row.variant_id, row.delta, row.reason]),
    [[BLACK, -2, 'sale'], [BLACK, 2, 'release']]);
  assertSnapshots(f, snapshots);
  assertOtherStockUnchanged(f, before, [[PRODUCT, BLACK]]);
  const writes = stockWrites(f).length;
  await callback(f, { cancelled: true });
  assert.equal(await releaseClaimedStock(f.sql, f.order().id), false);
  assert.equal(stockWrites(f).length, writes);
  assertSnapshots(f, snapshots);
});

const mixedIdentities = [[PRODUCT, BLACK], [PRODUCT, BLUE], [SHARED, null]];

test('mixed-order expiry restores every original claimed line only, including retired source and shared product pool', async () => {
  const f = fixture();
  await reserve(f, mixedLines());
  assertMixedSnapshots(f);
  assert.equal(f.selected().on_hand, 8);
  assert.equal(f.stock(PRODUCT, BLUE).on_hand, 17);
  assert.equal(f.stock(SHARED).on_hand, 76);
  const snapshots = savedSnapshots(f);
  f.replaceSource();
  f.blockHistoricalCatalog();
  const before = f.stocks();
  const expired = await expire(f);
  assert.equal(expired.outcome, 'released');
  assert.equal(expired.stockReleased, true);
  assert.equal(expired.statusChanged, true);
  assert.equal(expired.order.status, 'CANCELLED');
  assert.equal(expired.order.reservationState, 'EXPIRED');
  assert.equal(f.selected().on_hand, 10);
  assert.equal(f.stock(PRODUCT, BLUE).on_hand, 20);
  assert.equal(f.stock(SHARED).on_hand, 80);
  assert.deepEqual(f.movements().filter(row => row.reason === 'release')
    .map(row => [row.product_id, row.variant_id, row.delta]).sort(),
    [[PRODUCT, BLACK, 2], [PRODUCT, BLUE, 3], [SHARED, null, 4]].sort());
  assertOtherStockUnchanged(f, before, mixedIdentities);
  assertSnapshots(f, snapshots);
  const writes = stockWrites(f).length;
  assert.equal((await expire(f)).outcome, 'already-released');
  assert.equal(await releaseClaimedStock(f.sql, f.order().id), false);
  assert.equal(stockWrites(f).length, writes);
  assert.equal(f.history().length, 2);
  assertSnapshots(f, snapshots);
});

test('verified late capture reclaims exact mixed historical quantities after retirement; replay never claims twice', async () => {
  const f = fixture();
  await reserve(f, mixedLines());
  assertMixedSnapshots(f);
  const snapshots = savedSnapshots(f);
  f.replaceSource();
  f.blockHistoricalCatalog();
  await expire(f);
  const before = f.stocks();
  const paid = await callback(f);
  assert.equal(paid.ok, true);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.order.reservationState, 'CONSUMED');
  assert.equal(paid.order.paymentReviewRequired, false);
  assert.deepEqual(f.obligations(), []);
  assert.equal(f.selected().on_hand, 8);
  assert.equal(f.stock(PRODUCT, BLUE).on_hand, 17);
  assert.equal(f.stock(SHARED).on_hand, 76);
  assert.deepEqual(f.movements().slice(6).map(row => [row.product_id, row.variant_id, row.delta, row.reason]).sort(),
    [[PRODUCT, BLACK, -2, 'sale'], [PRODUCT, BLUE, -3, 'sale'], [SHARED, null, -4, 'sale']].sort());
  assertOtherStockUnchanged(f, before, mixedIdentities);
  assertSnapshots(f, snapshots);
  const stocks = f.stocks(), movements = f.movements(), writes = stockWrites(f).length;
  const replay = await callback(f);
  assert.equal(replay.status, 'PAID');
  assert.equal(replay.order.reservationState, 'CONSUMED');
  assert.deepEqual(f.stocks(), stocks);
  assert.deepEqual(f.movements(), movements);
  assert.equal(stockWrites(f).length, writes);
  assert.deepEqual(f.events().map(row => row[4]), ['paid', 'unchanged']);
  assert.equal(f.history().length, 3);
  assertSnapshots(f, snapshots);
});

for (const unavailable of ['missing', 'insufficient', 'reserved']) {
  test(`late capture with ${unavailable} original line refuses all reclaim and records one review/refund obligation`, async () => {
    const f = fixture();
    await reserve(f, mixedLines());
    const snapshots = savedSnapshots(f);
    f.replaceSource();
    f.blockHistoricalCatalog();
    await expire(f);
    // Blue sorts after the retired Black source; the helper must validate the
    // whole set before decrementing even that available first line. Parent and
    // replacement inventory remain plentiful but are not substitutes.
    if (unavailable === 'missing') f.removeStock(PRODUCT, BLUE);
    else f.setStock(PRODUCT, BLUE, unavailable === 'reserved'
      ? { on_hand: 20, reserved: 18 } : { on_hand: 2 });
    const stocks = f.stocks(), movements = f.movements(), writes = stockWrites(f).length;
    const paid = await callback(f);
    assert.equal(paid.ok, true, 'verified capture is recorded even when stock cannot be fulfilled');
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.order.reservationState, 'EXPIRED');
    assert.equal(paid.order.paymentReviewRequired, true);
    assert.equal(paid.order.paymentReviewReason, LATE_PAYMENT_REVIEW_REASON);
    assert.equal(f.order().fulfilment_status, 'PENDING');
    assert.deepEqual(f.stocks(), stocks, 'all-or-none refusal must leave all inventory unchanged');
    assert.deepEqual(f.movements(), movements);
    assert.equal(stockWrites(f).length, writes, 'preflight refusal writes no partial claim');
    assert.equal(f.obligations().length, 1);
    assert.deepEqual(f.obligations().map(row => ({ orderId: row.order_id, amountPaise: row.amount_paise, status: row.status })),
      [{ orderId: f.order().id, amountPaise: 298000, status: 'PENDING' }]);
    assert.match(f.obligations()[0].reason, /reserved stock had been released/);
    assertSnapshots(f, snapshots);

    const obligations = f.obligations();
    const replay = await callback(f);
    assert.equal(replay.order.paymentReviewRequired, true);
    assert.equal(replay.order.reservationState, 'EXPIRED');
    assert.deepEqual(f.obligations(), obligations, 'callback replay cannot create a second refund obligation');
    assert.deepEqual(f.stocks(), stocks);
    assert.deepEqual(f.movements(), movements);
    assert.equal(stockWrites(f).length, writes);
    assert.equal(f.history().length, 3);
    assert.deepEqual(f.events().map(row => row[4]), ['paid', 'unchanged']);
    assertSnapshots(f, snapshots);
  });
}

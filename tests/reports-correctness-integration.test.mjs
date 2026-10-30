/**
 * Every number in Store Admin reports must match an independent calculation.
 *
 * A throwaway schema is filled with orders whose totals are known, then each
 * report is run through the production code and compared paise-for-paise with
 * expectations computed in plain JavaScript from the fixture (never from the
 * SQL under test). The suite covers revenue statuses, POS typed prices,
 * shipping, coupons, sale prices, refunds, returns, cancelled-after-paid
 * orders, expenses, guest and registered buyers, orders around IST midnight
 * and month boundaries, filters, CSV agreement, pagination and formatting.
 *
 * Subtests are named `<report> | <check>` so a failure reads as one row of the
 * report | check | expected | actual table.
 *
 * Skipped when DATABASE_URL is unset or points at a transaction pooler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

import {
  CATALOGUE,
  addDays,
  buildOrder,
  diffDays,
  insertCatalogue,
  insertOrder,
  insertPayment,
  insertRefund,
  insertSession,
  insertUser,
  isCaptured,
  istDay,
  istMinute,
  itemIds,
  loadEnv,
  product,
  skipReason,
  withSchema,
} from './helpers/reports-fixture.mjs';

await loadEnv();
const skip = skipReason();

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});
const rules = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'report-rules.ts'));
const { getReport } = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'reports.ts'));
const analytics = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'analytics.ts'));
const ordersLib = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'orders.ts'));
const couponsLib = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'coupons.ts'));
const transactionsLib = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'transactions.ts'));
const { formatPaise } = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'amount.ts'));

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-10-30T06:00:00.000Z');

/* ---------------------------------------------------------------- helpers */

function filtersFor(params) {
  const parsed = rules.parseReportFilters(params, NOW, TZ);
  assert.equal(parsed.ok, true, `filters ${JSON.stringify(params)} should parse`);
  return parsed.filters;
}

async function run(key, params) {
  const result = await getReport(key, filtersFor(params));
  assert.equal(result.ok, true, `report ${key} should load`);
  return result.data;
}

/** Parse the CSV the export route would send (same builder as the route). */
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const col = (data, key) => data.rows.map((row) => row[key]);
const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
const day = (cell) => String(cell).slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The order report labels a day bucket `DD Mon YYYY`. */
const periodLabel = (d) => `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const dayRows = (data) => Object.fromEntries(data.rows.map((row) => [day(row.day), row]));

/* ----------------------------------------------------------- dataset A */

const RANGE = { from: '2026-03-28', to: '2026-04-02' };

const U0 = { id: 'u0', email: 'bob@example.com', first: 'Bob', last: 'Old', at: '2026-01-01T10:00:00+05:30' };
const U1 = { id: 'u1', email: 'rita@example.com', first: 'Rita', last: 'Sharma', at: '2026-03-31T23:55:00+05:30' };
const U2 = { id: 'u2', email: 'new@example.com', first: 'New', last: 'Person', at: '2026-04-01T00:30:00+05:30' };
const U3 = { id: 'u3', email: 'late@example.com', first: 'Late', last: 'Joiner', at: '2026-04-10T10:00:00+05:30' };
const USERS = [U0, U1, U2, U3];

const ORDERS = [
  // Online captured orders (PayU: no order_payments rows, only a gateway ref).
  { id: 'a1', at: '2026-03-30T10:00:00+05:30', email: 'alice@example.com', name: 'Alice A', method: 'upi', ref: 'MIH0000001',
    items: [{ pid: 'p1', qty: 2, unit: 123450 }], shipping: 5000 },
  { id: 'a2', at: '2026-03-31T23:50:00+05:30', userId: 'u1', email: 'rita@example.com', name: 'Rita Sharma', method: 'card', ref: 'MIH0000002',
    items: [{ pid: 'p2', qty: 1, unit: 49950, disc: 4995 }, { pid: 'p3', qty: 1, unit: 1234567, disc: 123457 }], coupon: 'SAVE10' },
  { id: 'a3', at: '2026-04-01T00:10:00+05:30', email: 'alice@example.com', name: 'Alice A', method: 'upi', ref: 'MIH0000003',
    items: [{ pid: 'p1', qty: 1, unit: 123450 }], coupon: 'FREESHIP' },
  { id: 'a4', at: '2026-04-01T18:00:00+05:30', userId: 'u1', email: 'rita@example.com', name: 'Rita Sharma', method: 'upi',
    items: [{ pid: 'p2', qty: 2, unit: 49950 }], shipping: 4900 },
  { id: 'a5', at: '2026-04-02T10:00:00+05:30', userId: 'u0', email: 'bob@example.com', name: 'Bob Old', method: 'card', ref: 'MIH0000005',
    items: [{ pid: 'p1', qty: 1, unit: 123450, disc: 20000 }], coupon: 'P1ONLY' },
  // POS: typed prices, walk-ins without an email.
  { id: 'a6', at: '2026-03-30T15:00:00+05:30', channel: 'pos', fulfil: 'DELIVERED', method: 'cash',
    items: [{ pid: 'p1', qty: 1, unit: 120000 }, { pid: 'p2', qty: 3, unit: 40000 }] },
  { id: 'a7', at: '2026-04-01T12:00:00+05:30', channel: 'pos', fulfil: 'DELIVERED', method: 'upi',
    items: [{ pid: 'p3', qty: 1, unit: 1000000 }] },
  { id: 'a8', at: '2026-03-30T16:00:00+05:30', channel: 'pos', status: 'CANCELLED', fulfil: 'CANCELED',
    items: [{ pid: 'p2', qty: 1, unit: 50000 }] },
  { id: 'a9', at: '2026-04-01T13:00:00+05:30', channel: 'pos', fulfil: 'DELIVERED',
    items: [{ pid: 'p4', qty: 1, unit: 0 }] },
  { id: 'a16', at: '2026-04-01T15:00:00+05:30', channel: 'pos', fulfil: 'DELIVERED', method: 'cash',
    items: [{ pid: 'p2', qty: 2, unit: 50000 }] },
  // Orders that are not revenue.
  { id: 'a10', at: '2026-03-30T11:00:00+05:30', status: 'FAILED', email: 'fail@example.com',
    items: [{ pid: 'p1', qty: 1, unit: 123450, disc: 12345 }], coupon: 'SAVE10' },
  { id: 'a11', at: '2026-03-30T12:00:00+05:30', status: 'CANCELLED', fulfil: 'CANCELED', email: 'cx@example.com',
    items: [{ pid: 'p4', qty: 2, unit: 25000 }], shipping: 20000 },
  { id: 'a12', at: '2026-03-31T09:00:00+05:30', status: 'PENDING', email: 'pend@example.com',
    items: [{ pid: 'p2', qty: 1, unit: 49950, disc: 4995 }], coupon: 'SAVE10' },
  { id: 'a13', at: '2026-03-31T10:00:00+05:30', status: 'PROCESSING', email: 'proc@example.com', ref: 'MIH0000013',
    items: [{ pid: 'p4', qty: 1, unit: 25000 }], shipping: 4900 },
  // Paid, then cancelled by staff (status stays PAID, fulfilment CANCELED), fully refunded.
  { id: 'a14', at: '2026-03-31T12:00:00+05:30', fulfil: 'CANCELED', email: 'back@example.com', method: 'upi', ref: 'MIH0000014',
    items: [{ pid: 'p5', qty: 30, unit: 10000, disc: 10000 }], coupon: 'FIXED100' },
  // Sale-price order, fully refunded but not cancelled.
  { id: 'a15', at: '2026-03-30T20:00:00+05:30', email: 'carol@example.com', name: 'Carol C', method: 'upi', ref: 'MIH0000015',
    items: [{ pid: 'p1', qty: 2, unit: 99000 }] },
  // Historical sale: returned in the main range with no in-range sales of p5.
  { id: 'a22', at: '2026-01-15T10:00:00+05:30', email: 'historical@example.com', method: 'upi', ref: 'MIH0000022',
    items: [{ pid: 'p5', qty: 2, unit: 10000 }] },
  // Outside the main range.
  { id: 'a17', at: '2026-03-10T10:00:00+05:30', userId: 'u0', email: 'bob@example.com', name: 'Bob Old', method: 'card', ref: 'MIH0000017',
    items: [{ pid: 'p1', qty: 1, unit: 123450 }] },
  { id: 'a18', at: '2026-04-05T10:00:00+05:30', email: 'later@example.com', method: 'upi', ref: 'MIH0000018',
    items: [{ pid: 'p2', qty: 1, unit: 49950 }] },
  // Day boundaries: exactly IST midnight, last millisecond of the day, next midnight.
  { id: 'a19', at: '2026-04-01T00:00:00+05:30', email: 'dave@example.com', method: 'upi', ref: 'MIH0000019',
    items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
  { id: 'a20', at: '2026-04-01T23:59:59.999+05:30', email: 'dave@example.com', method: 'upi', ref: 'MIH0000020',
    items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
  { id: 'a21', at: '2026-04-02T00:00:00+05:30', email: 'eve@example.com', method: 'upi', ref: 'MIH0000021',
    items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
].map(buildOrder);

const byId = Object.fromEntries(ORDERS.map((o) => [o.id, o]));

const PAYMENTS = [
  { orderId: 'a4', channel: 'online', method: 'upi', amount: 104800, at: '2026-04-01T18:03:00+05:30' },
  { orderId: 'a6', channel: 'pos', method: 'cash', amount: 240000, at: '2026-03-30T15:00:00+05:30' },
  { orderId: 'a7', channel: 'pos', method: 'upi', amount: 1000000, at: '2026-04-01T12:00:00+05:30' },
  { orderId: 'a8', channel: 'pos', method: 'cash', amount: 50000, status: 'CANCELLED', at: '2026-03-30T16:00:00+05:30' },
  { orderId: 'a16', channel: 'pos', method: 'cash', amount: 60000, at: '2026-04-01T15:00:00+05:30' },
];

const REFUNDS = [
  { id: 'r_a1', orderId: 'a1', amount: 50000, at: '2026-04-01T09:00:00+05:30' },
  { id: 'r_a14', orderId: 'a14', amount: 290000, at: '2026-04-01T10:00:00+05:30' },
  { id: 'r_a15', orderId: 'a15', amount: 198000, at: '2026-03-31T22:00:00+05:30' },
];

// Return lines address an order line by its position (1-based line number).
const RETURNS = [
  { id: 'ret1', orderId: 'a1', status: 'APPROVED', at: '2026-03-31T10:00:00+05:30', lines: [{ line: 1, qty: 1 }] },
  { id: 'ret2', orderId: 'a2', status: 'REQUESTED', at: '2026-03-31T11:00:00+05:30', lines: [{ line: 1, qty: 1 }] },
  { id: 'ret3', orderId: 'a15', status: 'REFUNDED', at: '2026-04-01T10:00:00+05:30', lines: [{ line: 1, qty: 2 }] },
  { id: 'ret4', orderId: 'a22', status: 'RECEIVED', at: '2026-04-01T11:00:00+05:30', lines: [{ line: 1, qty: 1 }] },
];

const COUPONS = [
  { id: 'cp1', code: 'SAVE10', type: 'PERCENT', value: 10 },
  { id: 'cp2', code: 'FREESHIP', type: 'FREE_SHIPPING', value: 0 },
  { id: 'cp3', code: 'P1ONLY', type: 'FIXED', value: 20000 },
  { id: 'cp4', code: 'FIXED100', type: 'FIXED', value: 10000 },
];
const REDEMPTIONS = [
  { coupon: 'cp1', orderId: 'a2', state: 'CONSUMED', discount: 128452 },
  { coupon: 'cp2', orderId: 'a3', state: 'CONSUMED', discount: 0 },
  { coupon: 'cp3', orderId: 'a5', state: 'CONSUMED', discount: 20000 },
  { coupon: 'cp1', orderId: 'a10', state: 'RELEASED', discount: 12345 },
  { coupon: 'cp1', orderId: 'a12', state: 'RESERVED', discount: 4995 },
  { coupon: 'cp4', orderId: 'a14', state: 'CONSUMED', discount: 10000 },
];

const EXPENSE_CATEGORIES = [
  { id: 'ec_rent', name: 'Rent' },
  { id: 'ec_ads', name: 'Advertising' },
];
const EXPENSES = [
  { id: 'e1', cat: 'ec_rent', title: 'March rent', amount: 1500000, on: '2026-03-31' },
  { id: 'e2', cat: 'ec_ads', title: 'Ad run', amount: 250050, on: '2026-04-01' },
  { id: 'e3', cat: 'ec_ads', title: 'Ad run 2', amount: 100025, on: '2026-04-01' },
  { id: 'e4', cat: null, title: 'Misc', amount: 33333, on: '2026-04-02' },
  { id: 'e5', cat: 'ec_rent', title: 'Deleted', amount: 999999, on: '2026-04-01', deleted: true },
  { id: 'e6', cat: 'ec_rent', title: 'April rent (outside)', amount: 1500000, on: '2026-04-20' },
];

// Filler rows far outside every report range, to force several order-list pages.
const FILLER = Array.from({ length: 40 }, (_, i) =>
  buildOrder({
    id: `f${String(i).padStart(2, '0')}`,
    at: `2026-02-${String(1 + (i % 20)).padStart(2, '0')}T12:${String(i).padStart(2, '0')}:00+05:30`,
    status: i % 3 === 0 ? 'FAILED' : i % 3 === 1 ? 'PENDING' : 'PAID',
    ref: i % 3 === 2 ? `MIHF${i}` : null,
    items: [{ pid: 'p4', qty: 1, unit: 25000 + i }],
  }),
);

async function loadDatasetA(sql) {
  await insertCatalogue(sql);
  for (const u of USERS) await insertUser(sql, u);
  for (const o of [...ORDERS, ...FILLER]) await insertOrder(sql, o);
  for (const p of PAYMENTS) await insertPayment(sql, p);
  for (const r of REFUNDS) await insertRefund(sql, r);

  for (const r of RETURNS) {
    await sql`
      insert into return_requests (id, order_id, status, created_at, updated_at)
      values (${r.id}, ${r.orderId}, ${r.status}, ${r.at}::timestamptz, ${r.at}::timestamptz)
    `;
    const ids = await itemIds(sql, r.orderId);
    for (const line of r.lines) {
      await sql`
        insert into return_items (return_id, order_item_id, quantity)
        values (${r.id}, ${ids[line.line - 1].id}, ${line.qty})
      `;
    }
  }

  for (const c of COUPONS) {
    await sql`insert into coupons (id, code, name, type, value) values (${c.id}, ${c.code}, ${c.code}, ${c.type}, ${c.value})`;
  }
  for (const r of REDEMPTIONS) {
    const o = byId[r.orderId];
    await sql`
      insert into coupon_redemptions (coupon_id, order_id, customer_email, discount_paise, state, created_at)
      values (${r.coupon}, ${r.orderId}, ${o.email}, ${r.discount}, ${r.state}, ${o.at}::timestamptz)
    `;
  }

  for (const c of EXPENSE_CATEGORIES) {
    await sql`insert into expense_categories (id, name) values (${c.id}, ${c.name})`;
  }
  for (const e of EXPENSES) {
    await sql`
      insert into expenses (id, category_id, title, amount_paise, spent_on, deleted_at)
      values (${e.id}, ${e.cat}, ${e.title}, ${e.amount}, ${e.on}::date, ${e.deleted ? '2026-04-03T00:00:00Z' : null}::timestamptz)
    `;
  }

  // Stock movements for the low-stock "last movement" column.
  await sql`
    insert into stock_movements (product_id, delta, reason, created_at)
    values ('p2', -1, 'sale', '2026-04-01T00:30:00+05:30'::timestamptz),
           ('p3', -1, 'sale', '2026-03-31T23:45:00+05:30'::timestamptz)
  `;
}

/* ------------------------------------------------------ expectation model */

const rangeOf = (from, to) => (o) => istDay(o.at) >= from && istDay(o.at) <= to;
const inDays = (at, from, to) => istDay(at) >= from && istDay(at) <= to;
const refundsOf = (orderId) => REFUNDS.filter((r) => r.orderId === orderId);
const channelOk = (channel) => (o) => channel === 'all' || o.channel === channel;
const cancelledLike = (o) => o.status !== 'FAILED' && (o.status === 'CANCELLED' || o.fulfil === 'CANCELED');

/** Captured-order refunds recorded inside the range (sales view). */
function salesRefunds(from, to, channel = 'all') {
  return REFUNDS.filter((r) => {
    const o = byId[r.orderId];
    return inDays(r.at, from, to) && isCaptured(o) && channelOk(channel)(o);
  });
}

function orderAggregate(list, refunds) {
  const captured = list.filter(isCaptured);
  const revenue = sum(captured, (o) => o.total);
  const refundTotal = sum(refunds, (r) => r.amount);
  return {
    orders: list.length,
    paid: captured.length,
    cancelled: list.filter(cancelledLike).length,
    failed: list.filter((o) => o.status === 'FAILED').length,
    units: sum(captured, (o) => sum(o.items, (l) => l.quantity)),
    revenue,
    discount: sum(captured, (o) => o.discount),
    refunds: refundTotal,
    net: revenue - refundTotal,
  };
}

function itemModel(from, to, { cat = null, brand = null } = {}) {
  const map = new Map();
  for (const o of ORDERS.filter((x) => isCaptured(x) && inDays(x.at, from, to))) {
    for (const line of o.items) {
      const p = product(line.productId);
      if (cat && p.cat !== cat) continue;
      if (brand && p.brand !== brand) continue;
      const entry = map.get(p.id) ?? { name: p.name, units: 0, revenue: 0, orders: new Set(), returned: 0 };
      entry.units += line.quantity;
      entry.revenue += line.lineTotalPaise - line.discountPaise;
      entry.orders.add(o.id);
      map.set(p.id, entry);
    }
  }
  for (const r of RETURNS.filter((x) => inDays(x.at, from, to) && ['APPROVED', 'RECEIVED', 'REFUNDED'].includes(x.status))) {
    const o = byId[r.orderId];
    for (const line of r.lines) {
      const p = product(o.items[line.line - 1].productId);
      if (cat && p.cat !== cat) continue;
      if (brand && p.brand !== brand) continue;
      const entry = map.get(p.id) ?? { name: p.name, units: 0, revenue: 0, orders: new Set(), returned: 0 };
      entry.returned += line.qty;
      map.set(p.id, entry);
    }
  }
  return map;
}

function buyerKey(o) {
  if (o.userId) return o.userId;
  if (o.email) return `guest:${o.email.toLowerCase()}`;
  return `order:${o.id}`;
}

/* ============================================================ the suite */

test('reports match independent calculations on a known dataset', { skip }, async (t) => {
  await withSchema('reports', async (sql) => {
    await loadDatasetA(sql);

    const everything = filtersFor(RANGE);
    assert.ok(everything.fromDay);

    /* ------------------------------------------------------- order report */

    const inMain = ORDERS.filter(rangeOf(RANGE.from, RANGE.to));

    await t.test('order report | totals for the range (status, revenue, discount, refunds, net)', async () => {
      const data = await run('orders', RANGE);
      const expected = orderAggregate(inMain, salesRefunds(RANGE.from, RANGE.to));
      assert.deepEqual(
        {
          orders: data.totals.orders, paid: data.totals.paid, cancelled: data.totals.cancelled,
          failed: data.totals.failed, units: data.totals.units, revenue: data.totals.revenue,
          discount: data.totals.discount, refunds: data.totals.refunds, net: data.totals.net,
        },
        expected,
      );
    });

    await t.test('order report | day buckets follow the STORE timezone (IST), not UTC', async () => {
      const data = await run('orders', RANGE);
      const rows = Object.fromEntries(data.rows.map((row) => [row.period, row]));
      for (let d = RANGE.from; d <= RANGE.to; d = addDays(d, 1)) {
        const list = inMain.filter((o) => istDay(o.at) === d);
        const refunds = salesRefunds(d, d);
        const expected = orderAggregate(list, refunds);
        const row = rows[periodLabel(d)];
        assert.ok(row, `bucket for ${d} exists`);
        assert.equal(row.revenue, expected.revenue, `revenue on ${d}`);
        assert.equal(row.orders, expected.orders, `orders on ${d}`);
        assert.equal(row.paid, expected.paid, `captured on ${d}`);
        assert.equal(row.refunds, expected.refunds, `refunds on ${d}`);
        assert.equal(row.net, expected.net, `net on ${d}`);
      }
    });

    await t.test('order report | bucket rows add up to the totals row', async () => {
      const data = await run('orders', RANGE);
      for (const key of ['orders', 'paid', 'cancelled', 'failed', 'units', 'revenue', 'discount', 'refunds', 'net']) {
        assert.equal(sum(data.rows, (r) => r[key]), data.totals[key], `column ${key}`);
      }
    });

    await t.test('order report | month grouping puts 31 Mar 23:50 IST and 1 Apr 00:10 IST in different months', async () => {
      const params = { from: '2026-03-01', to: '2026-04-30', group: 'month' };
      const data = await run('orders', params);
      assert.equal(data.rows.length, 2);
      const inMonth = (prefix) => ORDERS.filter((o) => istDay(o.at).startsWith(prefix) && inDays(o.at, params.from, params.to));
      const march = orderAggregate(inMonth('2026-03'), salesRefunds('2026-03-01', '2026-03-31'));
      const april = orderAggregate(inMonth('2026-04'), salesRefunds('2026-04-01', '2026-04-30'));
      assert.equal(data.rows[0].revenue, march.revenue, 'March revenue');
      assert.equal(data.rows[1].revenue, april.revenue, 'April revenue');
      assert.equal(data.rows[0].refunds, march.refunds, 'March refunds');
      assert.equal(data.rows[1].refunds, april.refunds, 'April refunds');
    });

    await t.test('order report | week grouping adds up to the same revenue', async () => {
      const data = await run('orders', { ...RANGE, group: 'week' });
      assert.equal(sum(data.rows, (r) => r.revenue), data.totals.revenue);
      assert.equal(data.totals.revenue, orderAggregate(inMain, []).revenue);
    });

    await t.test('order report | range is inclusive of both end days (00:00:00 and 23:59:59.999 IST)', async () => {
      const data = await run('orders', { from: '2026-04-01', to: '2026-04-01' });
      const list = ORDERS.filter(rangeOf('2026-04-01', '2026-04-01'));
      assert.ok(list.some((o) => o.id === 'a19') && list.some((o) => o.id === 'a20'));
      assert.ok(!list.some((o) => o.id === 'a21'));
      assert.equal(data.totals.orders, list.length);
      assert.equal(data.totals.revenue, orderAggregate(list, []).revenue);
    });

    await t.test('order report | channel filter (pos and web)', async () => {
      for (const channel of ['pos', 'web']) {
        const data = await run('orders', { ...RANGE, channel });
        const list = inMain.filter(channelOk(channel));
        const expected = orderAggregate(list, salesRefunds(RANGE.from, RANGE.to, channel));
        assert.equal(data.totals.orders, expected.orders, `${channel} orders`);
        assert.equal(data.totals.revenue, expected.revenue, `${channel} revenue`);
        assert.equal(data.totals.refunds, expected.refunds, `${channel} refunds`);
      }
    });

    await t.test('order report | status filter (PAID, FAILED, CANCELLED, PENDING, PROCESSING)', async () => {
      for (const status of ['PAID', 'FAILED', 'CANCELLED', 'PENDING', 'PROCESSING']) {
        const data = await run('orders', { ...RANGE, status });
        const list = inMain.filter((o) => o.status === status);
        const expected = orderAggregate(list, salesRefunds(RANGE.from, RANGE.to).filter((r) => byId[r.orderId].status === status));
        assert.equal(data.totals.orders, expected.orders, `${status} orders`);
        assert.equal(data.totals.revenue, expected.revenue, `${status} revenue`);
        assert.equal(data.totals.refunds, expected.refunds, `${status} refunds`);
      }
    });

    await t.test('order report | failed, cancelled, pending and processing orders are never revenue', async () => {
      for (const status of ['FAILED', 'CANCELLED', 'PENDING', 'PROCESSING']) {
        const data = await run('orders', { ...RANGE, status });
        assert.equal(data.totals.revenue, 0, `${status} revenue`);
        assert.equal(data.totals.paid, 0, `${status} captured`);
      }
    });

    await t.test('order report | a paid order cancelled afterwards is not revenue and its refund is not netted twice', async () => {
      const data = await run('orders', { from: '2026-03-31', to: '2026-03-31' });
      const list = ORDERS.filter(rangeOf('2026-03-31', '2026-03-31'));
      assert.equal(data.totals.revenue, sum(list.filter(isCaptured), (o) => o.total));
      const april = await run('orders', { from: '2026-04-01', to: '2026-04-01' });
      // a14 (cancelled after paid) was fully refunded on 1 Apr: that refund must not reduce sales net.
      assert.equal(april.totals.refunds, 50000, 'only the refund on a captured order (a1) counts');
    });

    await t.test('order report | cancelled column counts orders cancelled before or after payment', async () => {
      const data = await run('orders', RANGE);
      assert.equal(data.totals.cancelled, inMain.filter(cancelledLike).length);
      assert.equal(
        data.totals.orders,
        data.totals.paid + data.totals.cancelled + data.totals.failed + inMain.filter((o) => ['PENDING', 'PROCESSING', 'CREATED'].includes(o.status)).length,
      );
    });

    /* --------------------------------------------------------- day-wise */

    await t.test('day-wise report | one row per IST day with revenue, orders, AOV, new customers, refunds, net', async () => {
      const data = await run('daily', RANGE);
      assert.equal(data.rows.length, 6);
      const rows = dayRows(data);
      for (let d = RANGE.from; d <= RANGE.to; d = addDays(d, 1)) {
        const captured = inMain.filter((o) => isCaptured(o) && istDay(o.at) === d);
        const refunds = salesRefunds(d, d);
        const revenue = sum(captured, (o) => o.total);
        const newCustomers = USERS.filter((u) => istDay(u.at) === d).length;
        const row = rows[d];
        assert.equal(row.revenue, revenue, `revenue ${d}`);
        assert.equal(row.orders, captured.length, `orders ${d}`);
        assert.equal(row.aov, captured.length ? Math.round(revenue / captured.length) : 0, `aov ${d}`);
        assert.equal(row.newCustomers, newCustomers, `new customers ${d}`);
        assert.equal(row.refunds, sum(refunds, (r) => r.amount), `refunds ${d}`);
        assert.equal(row.net, revenue - sum(refunds, (r) => r.amount), `net ${d}`);
      }
    });

    await t.test('day-wise report | totals equal the order report and the sum of rows', async () => {
      const daily = await run('daily', RANGE);
      const orders = await run('orders', RANGE);
      assert.equal(daily.totals.revenue, orders.totals.revenue);
      assert.equal(daily.totals.orders, orders.totals.paid);
      assert.equal(daily.totals.refunds, orders.totals.refunds);
      assert.equal(daily.totals.net, orders.totals.net);
      assert.equal(sum(daily.rows, (r) => r.revenue), daily.totals.revenue);
      assert.equal(sum(daily.rows, (r) => r.newCustomers), daily.totals.newCustomers);
    });

    await t.test('day-wise report | channel filter', async () => {
      for (const channel of ['pos', 'web']) {
        const data = await run('daily', { ...RANGE, channel });
        const captured = inMain.filter((o) => isCaptured(o) && channelOk(channel)(o));
        assert.equal(data.totals.revenue, sum(captured, (o) => o.total), `${channel} revenue`);
        assert.equal(data.totals.orders, captured.length, `${channel} orders`);
        assert.equal(data.totals.refunds, sum(salesRefunds(RANGE.from, RANGE.to, channel), (r) => r.amount), `${channel} refunds`);
      }
    });

    /* -------------------------------------------------------- item-wise */

    await t.test('item-wise report | units, net line revenue (after discount, before shipping), orders, returns per product', async () => {
      const data = await run('items', RANGE);
      const model = itemModel(RANGE.from, RANGE.to);
      assert.equal(data.rows.length, model.size);
      for (const row of data.rows) {
        const entry = [...model.values()].find((e) => e.name === row.product);
        assert.ok(entry, `product ${row.product}`);
        assert.equal(row.units, entry.units, `${row.product} units`);
        assert.equal(row.revenue, entry.revenue, `${row.product} revenue`);
        assert.equal(row.orders, entry.orders.size, `${row.product} orders`);
        assert.equal(row.returned, entry.returned, `${row.product} returned`);
      }
    });

    await t.test('item-wise report | totals, products sold and return rate', async () => {
      const data = await run('items', RANGE);
      const model = [...itemModel(RANGE.from, RANGE.to).values()];
      assert.equal(data.totals.units, sum(model, (e) => e.units));
      assert.equal(data.totals.revenue, sum(model, (e) => e.revenue));
      assert.equal(data.totals.returned, sum(model, (e) => e.returned));
      assert.equal(data.stats.find((s) => s.label === 'Products sold').value, model.filter((e) => e.units > 0).length);
      assert.equal(sum(data.rows, (r) => r.revenue), data.totals.revenue);
    });

    await t.test('item-wise report | historical-sale returns appear without in-range sales and respect product filters', async () => {
      const returnedProduct = product('p5');
      const data = await run('items', RANGE);
      const row = data.rows.find((r) => r.productId === 'p5');
      assert.ok(row, 'a historical sale returned in range has its own row');
      assert.equal(row.units, 0);
      assert.equal(row.orders, 0);
      assert.equal(row.revenue, 0);
      assert.equal(row.returned, 1);
      assert.equal(row.returnRate, null, 'no sales denominator');
      assert.equal(data.totals.returned, 4);
      const included = await run('items', { ...RANGE, category: returnedProduct.cat });
      assert.equal(included.rows.find((r) => r.productId === 'p5').returned, 1);
      const otherCategory = CATALOGUE.categories.find((c) => c.id !== returnedProduct.cat).id;
      const excluded = await run('items', { ...RANGE, category: otherCategory });
      assert.ok(!excluded.rows.some((r) => r.productId === 'p5'));
    });

    await t.test('item-wise report | item revenue plus shipping equals order-level revenue', async () => {
      const items = await run('items', RANGE);
      const orders = await run('orders', RANGE);
      const shipping = sum(inMain.filter(isCaptured), (o) => o.shipping);
      assert.equal(items.totals.revenue + shipping, orders.totals.revenue);
    });

    await t.test('item-wise report | category and brand filters', async () => {
      for (const params of [{ category: 'c_a' }, { category: 'c_b' }, { brand: 'b_x' }, { brand: 'b_y' }, { category: 'c_b', brand: 'b_y' }]) {
        const data = await run('items', { ...RANGE, ...params });
        const model = [...itemModel(RANGE.from, RANGE.to, { cat: params.category ?? null, brand: params.brand ?? null }).values()];
        assert.equal(data.totals.units, sum(model, (e) => e.units), `${JSON.stringify(params)} units`);
        assert.equal(data.totals.revenue, sum(model, (e) => e.revenue), `${JSON.stringify(params)} revenue`);
        assert.equal(data.rows.length, model.length, `${JSON.stringify(params)} rows`);
      }
    });

    await t.test('item-wise report | stock columns (available, sell-through)', async () => {
      const data = await run('items', RANGE);
      const p1 = data.rows.find((r) => r.product === 'Case');
      assert.equal(p1.available, 8);
      assert.equal(p1.sellThrough, Math.round((p1.units / (p1.units + 8)) * 1000) / 10);
      const strap = data.rows.find((r) => r.product === 'Strap');
      assert.equal(strap.available, null, 'untracked inventory shows no availability');
    });

    /* ----------------------------------------------- transaction statement */

    function statementModel(from, to, channel = 'all') {
      const lines = [];
      for (const p of PAYMENTS) {
        const o = byId[p.orderId];
        if (inDays(p.at, from, to) && channelOk(channel)((o))) {
          lines.push({ kind: 'Payment', order: p.orderId, at: p.at, amount: p.amount, status: p.status ?? 'PAID', method: p.method || o.method || 'other' });
        }
      }
      for (const o of ORDERS) {
        if (o.status !== 'PAID' || PAYMENTS.some((p) => p.orderId === o.id) || o.total <= 0) continue;
        const paidAt = new Date(Date.parse(o.at) + 60_000).toISOString();
        if (inDays(paidAt, from, to) && channelOk(channel)(o)) {
          lines.push({ kind: 'Payment', order: o.id, at: paidAt, amount: o.total, status: 'PAID', method: o.method || 'payu' });
        }
      }
      for (const r of REFUNDS) {
        if (inDays(r.at, from, to) && channelOk(channel)(byId[r.orderId])) {
          lines.push({ kind: 'Refund', order: r.orderId, at: r.at, amount: -r.amount, status: 'RECORDED', method: r.method ?? 'cash' });
        }
      }
      return lines;
    }

    await t.test('transaction statement | money in, money out, net and counts', async () => {
      const data = await run('transactions', RANGE);
      const lines = statementModel(RANGE.from, RANGE.to);
      const settled = lines.filter((l) => l.kind === 'Payment' && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(l.status));
      const moneyIn = sum(settled, (l) => l.amount);
      const moneyOut = -sum(lines.filter((l) => l.kind === 'Refund'), (l) => l.amount);
      const stat = (label) => data.stats.find((s) => s.label === label).value;
      assert.equal(stat('Money in'), moneyIn);
      assert.equal(stat('Money out'), moneyOut);
      assert.equal(stat('Net'), moneyIn - moneyOut);
      assert.equal(data.totals.amount, moneyIn - moneyOut);
      assert.equal(stat('Settled payments'), settled.length);
      assert.equal(stat('Unsettled attempts'), lines.filter((l) => l.kind === 'Payment').length - settled.length);
      assert.equal(data.rows.length, lines.length);
    });

    await t.test('transaction statement | refund lines are negative, settled rows add up to net', async () => {
      const data = await run('transactions', RANGE);
      const refundRows = data.rows.filter((r) => r.type === 'Refund');
      assert.equal(refundRows.length, REFUNDS.filter((r) => inDays(r.at, RANGE.from, RANGE.to)).length);
      for (const row of refundRows) assert.ok(row.amount < 0);
      const settled = data.rows.filter((r) => r.type === 'Refund' || ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(r.status));
      assert.equal(sum(settled, (r) => r.amount), data.totals.amount);
    });

    await t.test('transaction statement | dates are shown in the store timezone', async () => {
      const data = await run('transactions', RANGE);
      const row = data.rows.find((r) => r.order === 'a3');
      assert.ok(row, 'a3 line exists');
      assert.equal(String(row.date).slice(0, 10), istDay(byId.a3.at), 'a3 is on its IST day (1 Apr), not the UTC day (31 Mar)');
      const refund = data.rows.find((r) => r.type === 'Refund' && r.order === 'a15');
      assert.equal(String(refund.date).slice(0, 10), '2026-03-31');
    });

    await t.test('transaction statement | a gateway order without payment rows appears once; one with payment rows is not doubled', async () => {
      const data = await run('transactions', RANGE);
      assert.equal(data.rows.filter((r) => r.type === 'Payment' && r.order === 'a1').length, 1);
      assert.equal(data.rows.filter((r) => r.type === 'Payment' && r.order === 'a4').length, 1);
      assert.equal(data.rows.filter((r) => r.type === 'Payment' && r.order === 'a9').length, 0, 'a zero-value free sale is not a payment');
    });

    await t.test('transaction statement | channel filter', async () => {
      for (const channel of ['pos', 'web']) {
        const data = await run('transactions', { ...RANGE, channel });
        const lines = statementModel(RANGE.from, RANGE.to, channel);
        assert.equal(data.rows.length, lines.length, `${channel} rows`);
        const settled = lines.filter((l) => l.kind === 'Refund' || ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(l.status));
        assert.equal(data.totals.amount, sum(settled, (l) => l.amount), `${channel} net`);
      }
    });

    await t.test('transaction statement | cash filter reconciles rows, full totals and CSV before truncation', async () => {
      const expected = statementModel(RANGE.from, RANGE.to).filter((line) => line.method.toLowerCase() === 'cash');
      assert.ok(expected.length > 1, 'fixture has multiple cash movements');
      const settled = expected.filter((line) => line.kind === 'Refund' || ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(line.status));
      const net = sum(settled, (line) => line.amount);
      const data = await run('transactions', { ...RANGE, method: 'cash' });
      assert.equal(data.rows.length, expected.length);
      assert.ok(data.rows.every((row) => row.method.toLowerCase() === 'cash'));
      assert.equal(data.totals.amount, net);
      assert.equal(sum(data.rows.filter((row) => row.type === 'Refund' || ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.status)), (row) => row.amount), net);
      const table = parseCsv(rules.reportCsv(data));
      const methodIndex = data.columns.findIndex((column) => column.key === 'method');
      const amountIndex = data.columns.findIndex((column) => column.key === 'amount');
      assert.equal(table.length, expected.length + 2);
      assert.ok(table.slice(1, -1).every((row) => row[methodIndex].toLowerCase() === 'cash'));
      assert.equal(table.at(-1)[amountIndex], (net / 100).toFixed(2));
      data.rows.forEach((row, i) => assert.equal(table[i + 1][amountIndex], (row.amount / 100).toFixed(2)));
      const limited = await getReport('transactions', { ...filtersFor({ ...RANGE, method: 'cash' }), rowLimit: 1 });
      assert.equal(limited.ok, true);
      assert.equal(limited.data.rows.length, 1);
      assert.equal(limited.data.rows[0].method.toLowerCase(), 'cash');
      assert.equal(limited.data.truncated, true);
      assert.equal(limited.data.totals.amount, net, 'cap does not shrink filtered totals');
    });

    /* ------------------------------------------------------ reconciliation */

    function reconciliationModel() {
      const out = [];
      for (const o of inMain) {
        const pays = PAYMENTS.filter((p) => p.orderId === o.id);
        if (!(o.status === 'PAID' || pays.length || o.ref)) continue;
        const recorded = sum(pays.filter((p) => (p.status ?? 'PAID') === 'PAID'), (p) => p.amount);
        const refunded = sum(refundsOf(o.id), (r) => r.amount);
        let state;
        if (o.status === 'PAID') {
          state = o.total === 0 || (o.ref && recorded <= o.total) || recorded === o.total ? 'Matched' : 'Unmatched';
        } else if (['FAILED', 'CANCELLED'].includes(o.status) && recorded === 0) state = 'Failed';
        else if (['CREATED', 'PENDING'].includes(o.status) && recorded === 0 && !o.ref) state = 'Open';
        else state = 'Unmatched';
        out.push({ o, recorded, refunded, state });
      }
      return out;
    }

    await t.test('payment reconciliation | per-order state, expected, recorded and refunded', async () => {
      const data = await run('reconciliation', RANGE);
      const model = reconciliationModel();
      assert.equal(data.rows.length, model.length);
      for (const m of model) {
        const row = data.rows.find((r) => r.order === m.o.id);
        assert.ok(row, `row for ${m.o.id}`);
        assert.equal(row.state, m.state, `${m.o.id} state`);
        assert.equal(row.expected, m.o.status === 'PAID' ? m.o.total : 0, `${m.o.id} expected`);
        assert.equal(row.recorded, m.recorded, `${m.o.id} recorded`);
        assert.equal(row.refunded, m.refunded, `${m.o.id} refunded`);
      }
    });

    await t.test('payment reconciliation | totals and gateway / POS stats', async () => {
      const data = await run('reconciliation', RANGE);
      const model = reconciliationModel();
      const stat = (label) => data.stats.find((s) => s.label === label).value;
      const count = (state) => model.filter((m) => m.state === state).length;
      assert.equal(stat('Matched'), count('Matched'));
      assert.equal(stat('Unmatched'), count('Unmatched'));
      assert.equal(stat('Failed'), count('Failed'));
      const paid = model.filter((m) => m.o.status === 'PAID' && ['Matched', 'Unmatched'].includes(m.state));
      assert.equal(data.totals.expected, sum(paid, (m) => m.o.total), 'expected counts PAID orders only');
      assert.equal(data.totals.recorded, sum(model, (m) => m.recorded));
      assert.equal(data.totals.refunded, sum(model, (m) => m.refunded));
      assert.equal(stat('Gateway captured'), sum(model.filter((m) => m.o.status === 'PAID' && m.o.ref), (m) => m.o.total));
      assert.equal(stat('POS recorded'), sum(model.filter((m) => m.o.channel === 'pos' && m.o.status === 'PAID'), (m) => m.recorded));
      assert.equal(stat('Refunded'), data.totals.refunded);
    });

    await t.test('payment reconciliation | an underpaid POS sale is Unmatched and a free sale is Matched', async () => {
      const data = await run('reconciliation', RANGE);
      assert.equal(data.rows.find((r) => r.order === 'a16').state, 'Unmatched');
      assert.equal(data.rows.find((r) => r.order === 'a9').state, 'Matched');
    });

    await t.test('payment reconciliation | dates use the store timezone', async () => {
      const data = await run('reconciliation', RANGE);
      assert.equal(String(data.rows.find((r) => r.order === 'a3').date).slice(0, 10), '2026-04-01');
    });

    /* ------------------------------------------------------------ expenses */

    const liveExpenses = (from, to, cat = null) =>
      EXPENSES.filter((e) => !e.deleted && e.on >= from && e.on <= to && (!cat || e.cat === cat));

    await t.test('expense report | totals, entries, largest category, average per active day', async () => {
      const data = await run('expenses', RANGE);
      const list = liveExpenses(RANGE.from, RANGE.to);
      const stat = (label) => data.stats.find((s) => s.label === label);
      assert.equal(data.totals.total, sum(list, (e) => e.amount));
      assert.equal(data.totals.entries, list.length);
      assert.equal(stat('Largest category').value, 'Rent');
      const activeDays = new Set(list.map((e) => e.on)).size;
      assert.equal(stat('Average per day').value, Math.round(sum(list, (e) => e.amount) / activeDays));
      assert.equal(sum(data.rows, (r) => r.total), data.totals.total);
    });

    await t.test('expense report | category filter and deleted entries are excluded', async () => {
      for (const cat of ['ec_rent', 'ec_ads']) {
        const data = await run('expenses', { ...RANGE, category: cat });
        assert.equal(data.totals.total, sum(liveExpenses(RANGE.from, RANGE.to, cat), (e) => e.amount), cat);
      }
    });

    await t.test('expense report | date range is inclusive', async () => {
      const data = await run('expenses', { from: '2026-04-01', to: '2026-04-01' });
      assert.equal(data.totals.total, 250050 + 100025);
    });

    /* ---------------------------------------------------------------- stock */

    await t.test('stock report | on hand, reserved, available, value at cost and retail', async () => {
      const data = await run('stock', {});
      const stocked = CATALOGUE.products;
      const onHand = sum(stocked, (p) => (p.stock ? p.stock[0] : 0));
      assert.equal(data.totals.onHand, onHand);
      assert.equal(data.totals.reserved, sum(stocked, (p) => (p.stock ? p.stock[1] : 0)));
      assert.equal(data.totals.available, data.totals.onHand - data.totals.reserved);
      assert.equal(data.totals.retailValue, sum(stocked, (p) => p.price * (p.stock ? p.stock[0] : 0)));
      assert.equal(data.totals.costValue, sum(stocked.filter((p) => p.cost !== null), (p) => p.cost * (p.stock ? p.stock[0] : 0)));
      assert.equal(data.stats.find((s) => s.label === 'Low stock').value, 2);
    });

    await t.test('stock report | category and brand filters', async () => {
      const data = await run('stock', { category: 'c_a' });
      assert.equal(data.rows.length, 2);
      assert.equal(data.totals.onHand, 13);
      const brand = await run('stock', { brand: 'b_x' });
      assert.equal(brand.rows.length, 2);
      assert.equal(brand.totals.onHand, 10);
    });

    await t.test('low-stock report | items at or below threshold, reorder quantity, totals', async () => {
      const data = await run('low-stock', {});
      assert.deepEqual(col(data, 'product').sort(), ['Cable', 'Charger']);
      const cable = data.rows.find((r) => r.product === 'Cable');
      assert.equal(cable.available, 2);
      assert.equal(cable.reorder, 8);
      const charger = data.rows.find((r) => r.product === 'Charger');
      assert.equal(charger.reorder, 4);
      assert.equal(data.totals.reorder, 12);
      assert.equal(data.stats.find((s) => s.label === 'Out of stock').value, 1);
      assert.equal(String(cable.lastMoved).slice(0, 10), '2026-04-01', 'last movement is shown on its IST day');
    });

    await t.test('low-stock report | brand filter', async () => {
      const data = await run('low-stock', { brand: 'b_x' });
      assert.deepEqual(col(data, 'product'), ['Charger']);
    });

    /* ------------------------------------------------------------ customers */

    await t.test('customer report | buyers, new vs returning, guest vs registered, revenue', async () => {
      const data = await run('customers', RANGE);
      const captured = inMain.filter(isCaptured);
      const groups = new Map();
      for (const o of captured) {
        const key = buyerKey(o);
        const entry = groups.get(key) ?? { orders: 0, revenue: 0, registered: Boolean(o.userId) };
        entry.orders += 1;
        entry.revenue += o.total;
        groups.set(key, entry);
      }
      const priorKeys = new Set(
        ORDERS.filter((o) => isCaptured(o) && istDay(o.at) < RANGE.from).map(buyerKey),
      );
      const stat = (label) => data.stats.find((s) => s.label === label).value;
      assert.equal(stat('Buyers'), groups.size);
      assert.equal(stat('New buyers'), [...groups.keys()].filter((k) => !priorKeys.has(k)).length);
      assert.equal(stat('Returning buyers'), [...groups.keys()].filter((k) => priorKeys.has(k)).length);
      assert.equal(stat('Guest buyers'), [...groups.values()].filter((g) => !g.registered).length);
      assert.equal(stat('Registered buyers'), [...groups.values()].filter((g) => g.registered).length);
      assert.equal(data.totals.orders, captured.length);
      assert.equal(data.totals.revenue, sum(captured, (o) => o.total));
      assert.equal(sum(data.rows, (r) => r.revenue), data.totals.revenue);
      assert.equal(data.rows.length, groups.size, 'every walk-in sale without an email is its own buyer');
      const repeat = [...groups.values()].filter((g) => g.orders > 1).length;
      assert.equal(stat('Repeat rate'), Math.round((repeat / groups.size) * 1000) / 10);
    });

    await t.test('customer report | customer revenue equals the order report revenue', async () => {
      const customers = await run('customers', RANGE);
      const orders = await run('orders', RANGE);
      assert.equal(customers.totals.revenue, orders.totals.revenue);
      assert.equal(customers.totals.orders, orders.totals.paid);
    });

    await t.test('customer report | first and last order dates use the store timezone', async () => {
      const data = await run('customers', RANGE);
      const alice = data.rows.find((r) => r.email.startsWith('a') && r.type === 'Guest' && r.orders === 2);
      assert.ok(alice, 'alice has two orders in range');
      assert.equal(String(alice.firstOrder).slice(0, 10), '2026-03-30');
      assert.equal(String(alice.lastOrder).slice(0, 10), '2026-04-01');
    });

    /* ----------------------------------------------------- category & brand */

    await t.test('category and brand report | each rollup equals the item-wise net revenue', async () => {
      const data = await run('categories', RANGE);
      const model = itemModel(RANGE.from, RANGE.to);
      const byCat = new Map();
      const byBrand = new Map();
      for (const [pid, entry] of model) {
        const p = product(pid);
        const cat = CATALOGUE.categories.find((c) => c.id === p.cat).name;
        const brand = p.brand ? CATALOGUE.brands.find((b) => b.id === p.brand).name : 'No brand';
        byCat.set(cat, (byCat.get(cat) ?? 0) + entry.revenue);
        byBrand.set(brand, (byBrand.get(brand) ?? 0) + entry.revenue);
      }
      for (const row of data.rows.filter((r) => r.scope === 'Category')) assert.equal(row.revenue, byCat.get(row.name), `category ${row.name}`);
      for (const row of data.rows.filter((r) => r.scope === 'Brand')) assert.equal(row.revenue, byBrand.get(row.name), `brand ${row.name}`);
      assert.equal(sum(data.rows.filter((r) => r.scope === 'Category'), (r) => r.revenue), data.totals.revenue);
      assert.equal(sum(data.rows.filter((r) => r.scope === 'Brand'), (r) => r.revenue), data.totals.revenue);
      assert.equal(data.totals.revenue, sum([...model.values()], (e) => e.revenue));
    });

    await t.test('category and brand report | category and brand filters change the numbers', async () => {
      for (const params of [{ category: 'c_a' }, { brand: 'b_x' }]) {
        const data = await run('categories', { ...RANGE, ...params });
        const model = [...itemModel(RANGE.from, RANGE.to, { cat: params.category ?? null, brand: params.brand ?? null }).values()];
        assert.equal(data.totals.revenue, sum(model, (e) => e.revenue), JSON.stringify(params));
        assert.equal(data.totals.units, sum(model, (e) => e.units), JSON.stringify(params));
      }
    });

    /* ----------------------------------------------------------- coupons */

    await t.test('coupon usage | redemptions count held uses, discount and revenue count captured consumed uses', async () => {
      const result = await couponsLib.couponUsageReport({ fromDay: RANGE.from, toDay: RANGE.to, timeZone: TZ });
      assert.equal(result.ok, true);
      const inRangeRedemptions = REDEMPTIONS.filter((r) => inDays(byId[r.orderId].at, RANGE.from, RANGE.to));
      const held = inRangeRedemptions.filter((r) => ['RESERVED', 'CONSUMED'].includes(r.state));
      const counted = inRangeRedemptions.filter((r) => r.state === 'CONSUMED' && isCaptured(byId[r.orderId]));
      assert.equal(result.data.totals.redemptions, held.length);
      assert.equal(result.data.totals.discountPaise, sum(counted, (r) => r.discount));
      assert.equal(result.data.totals.revenuePaise, sum(counted, (r) => byId[r.orderId].total));
      assert.equal(result.data.rows.length, inRangeRedemptions.length, 'released rows stay visible');
    });

    await t.test('coupon usage | consumed discount equals the order-level discount on captured orders', async () => {
      const result = await couponsLib.couponUsageReport({ fromDay: RANGE.from, toDay: RANGE.to, timeZone: TZ });
      const orders = await run('orders', RANGE);
      assert.equal(result.data.totals.discountPaise, orders.totals.discount);
    });

    await t.test('coupon usage | day range is by store day and a code filter narrows it', async () => {
      const result = await couponsLib.couponUsageReport({ fromDay: '2026-04-01', toDay: '2026-04-01', timeZone: TZ });
      assert.equal(result.data.rows.length, 1, 'only a3 (00:10 IST) is on 1 Apr');
      const one = await couponsLib.couponUsageReport({ fromDay: RANGE.from, toDay: RANGE.to, code: 'save10', timeZone: TZ });
      assert.equal(one.data.rows.length, 3);
    });

    /* ------------------------------------------------------ orders list */

    await t.test('orders list | date filters use the store day and pages neither drop nor repeat rows', async () => {
      const day1 = await ordersLib.listOrders({ dateFrom: '2026-04-01', dateTo: '2026-04-01', page: 1 });
      assert.equal(day1.ok, true);
      const expected = ORDERS.filter(rangeOf('2026-04-01', '2026-04-01'));
      assert.equal(day1.data.total, expected.length);
      assert.deepEqual(day1.data.orders.map((o) => o.txnid).sort(), expected.map((o) => o.id).sort());

      const seen = [];
      let pages = 1;
      for (let page = 1; page <= pages; page += 1) {
        const result = await ordersLib.listOrders({ page });
        assert.equal(result.ok, true);
        pages = result.data.pageCount;
        seen.push(...result.data.orders.map((o) => o.txnid));
      }
      const all = [...ORDERS, ...FILLER];
      assert.equal(pages, Math.ceil(all.length / ordersLib.ORDERS_PAGE_SIZE));
      assert.equal(seen.length, all.length, 'no dropped rows');
      assert.equal(new Set(seen).size, seen.length, 'no repeated rows');
    });

    await t.test('orders list | summed amount of captured rows equals report revenue', async () => {
      let total = 0;
      let pages = 1;
      for (let page = 1; page <= pages; page += 1) {
        const result = await ordersLib.listOrders({ dateFrom: RANGE.from, dateTo: RANGE.to, page });
        pages = result.data.pageCount;
        for (const order of result.data.orders) {
          if (order.paymentStatus === 'PAID' && order.fulfilmentStatus !== 'CANCELED') total += order.totalPaise;
        }
      }
      const orders = await run('orders', RANGE);
      assert.equal(total, orders.totals.revenue);
    });

    await t.test('orders list | CSV export amounts and date filter agree with the list', async () => {
      const result = await ordersLib.listOrdersForExport({ dateFrom: '2026-04-01', dateTo: '2026-04-01' });
      assert.equal(result.ok, true);
      const expected = ORDERS.filter(rangeOf('2026-04-01', '2026-04-01'));
      assert.equal(result.data.length, expected.length);
      assert.equal(sum(result.data, (r) => r.amountPaise), sum(expected, (o) => o.total));
    });

    /* ------------------------------------- CSV agrees with on-screen totals */

    await t.test('every report | CSV totals row equals the on-screen totals and rows add up', async () => {
      const additive = {
        orders: ['orders', 'paid', 'cancelled', 'failed', 'units', 'revenue', 'discount', 'refunds', 'net'],
        daily: ['orders', 'revenue', 'newCustomers', 'refunds', 'net'],
        items: ['units', 'revenue', 'returned'],
        transactions: [],
        reconciliation: ['expected', 'recorded', 'refunded'],
        expenses: ['entries', 'total'],
        customers: ['orders', 'revenue'],
        stock: ['onHand', 'reserved', 'available', 'retailValue'],
        'low-stock': ['onHand', 'reserved', 'available', 'reorder'],
      };
      for (const key of rules.REPORT_KEYS) {
        const data = await run(key, RANGE);
        const csv = rules.reportCsv(data);
        const table = parseCsv(csv);
        assert.equal(table[0].length, data.columns.length, `${key} header width`);
        assert.equal(table.length, data.rows.length + 2, `${key} csv rows`);
        const last = table[table.length - 1];
        data.columns.forEach((column, index) => {
          const total = data.totals?.[column.key];
          if (column.format === 'money' && typeof total === 'number') {
            assert.equal(last[index], (total / 100).toFixed(2), `${key} csv total ${column.key}`);
          }
        });
        for (const columnKey of additive[key] ?? []) {
          const column = data.columns.find((c) => c.key === columnKey);
          const index = data.columns.indexOf(column);
          const divisor = column.format === 'money' ? 100 : 1;
          const csvSum = Math.round(sum(table.slice(1, -1), (r) => Number(r[index] || 0)) * 100) / 100;
          assert.equal(csvSum, Math.round((Number(last[index]) * 100)) / 100, `${key} csv rows add up (${columnKey})`);
          assert.equal(Math.round(Number(last[index]) * divisor), data.totals[columnKey], `${key} csv total equals screen (${columnKey})`);
        }
      }
    });

    /* ------------------------------------------------------- formatting */

    await t.test('formatting | rupee symbol, Indian grouping, two decimals, negatives for refunds', () => {
      assert.equal(formatPaise(1234567), '₹12,345.67');
      assert.equal(formatPaise(12345678900), '₹12,34,56,789.00');
      assert.equal(formatPaise(5), '₹0.05');
      assert.equal(formatPaise(-50000), '-₹500.00');
      assert.equal(rules.formatReportValue(-50000, 'money'), '-₹500.00');
      assert.equal(rules.formatReportValue(1234567, 'int'), '12,34,567');
    });

    await t.test('formatting | no report cell, stat, total or CSV shows NaN, null or undefined', async () => {
      const ranges = [RANGE, { from: '2025-01-01', to: '2025-01-03' }];
      for (const range of ranges) {
        for (const key of rules.REPORT_KEYS) {
          const data = await run(key, range);
          const cells = [];
          for (const row of [...data.rows, data.totals].filter(Boolean)) {
            for (const column of data.columns) cells.push(rules.formatReportValue(row[column.key] ?? null, column.format));
          }
          for (const stat of data.stats) cells.push(stat.label, rules.formatReportValue(stat.value, stat.format), stat.hint ?? '');
          cells.push(data.note ?? '', rules.reportCsv(data));
          for (const cell of cells) {
            assert.ok(!/NaN|undefined|\bnull\b|Infinity/.test(cell), `${key}: "${cell.slice(0, 80)}"`);
          }
        }
      }
    });

    await t.test('formatting | an empty range gives zero totals and no rows rather than errors', async () => {
      const data = await run('orders', { from: '2025-01-01', to: '2025-01-01' });
      assert.equal(data.totals.revenue, 0);
      assert.equal(data.totals.orders, 0);
      for (const key of ['items', 'transactions', 'reconciliation', 'expenses', 'customers', 'categories']) {
        const empty = await run(key, { from: '2025-01-01', to: '2025-01-01' });
        assert.equal(empty.rows.length, 0, `${key} has no rows`);
      }
    });
  });
});

/* ======================================================== dataset B: Overview */

test('Overview figures match the reports under one revenue definition', { skip }, async (t) => {
  await withSchema('overview', async (sql) => {
    await insertCatalogue(sql);
    const today = (await sql`select (now() at time zone 'Asia/Kolkata')::date::text as d`)[0].d;
    const at = (daysAgo, time) => `${addDays(today, -daysAgo)}T${time}+05:30`;

    const B = [
      { id: 'b1', at: at(0, '10:00:00'), email: 'g1@example.com', method: 'upi', ref: 'M1', items: [{ pid: 'p1', qty: 1, unit: 123450 }], shipping: 4000 },
      { id: 'b2', at: at(1, '23:40:00'), userId: 'u1', email: 'rita@example.com', method: 'card', ref: 'M2', items: [{ pid: 'p2', qty: 2, unit: 49950 }] },
      { id: 'b3', at: at(3, '15:00:00'), channel: 'pos', fulfil: 'DELIVERED', method: 'cash', items: [{ pid: 'p1', qty: 1, unit: 100000 }] },
      { id: 'b4', at: at(3, '16:00:00'), channel: 'pos', fulfil: 'DELIVERED', method: 'upi', items: [{ pid: 'p3', qty: 1, unit: 55000 }] },
      { id: 'b5', at: at(6, '23:59:00'), email: 'g1@example.com', method: 'upi', ref: 'M5', items: [{ pid: 'p4', qty: 3, unit: 25000 }], shipping: 5000 },
      { id: 'b6', at: at(7, '00:01:00'), userId: 'u1', email: 'rita@example.com', method: 'card', ref: 'M6', items: [{ pid: 'p2', qty: 1, unit: 49950 }] },
      { id: 'b7', at: at(10, '12:00:00'), userId: 'u2', email: 'new@example.com', method: 'upi', ref: 'M7', items: [{ pid: 'p1', qty: 1, unit: 123450, disc: 12345 }], coupon: 'SAVE10' },
      { id: 'b8', at: at(20, '12:00:00'), email: 'g2@example.com', method: 'card', ref: 'M8', items: [{ pid: 'p3', qty: 1, unit: 1234567 }] },
      { id: 'b9', at: at(45, '12:00:00'), channel: 'pos', fulfil: 'DELIVERED', method: 'cash', items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
      { id: 'b10', at: at(364, '12:00:00'), email: 'g3@example.com', method: 'upi', ref: 'M10', items: [{ pid: 'p5', qty: 1, unit: 10000 }] },
      { id: 'b11', at: at(365, '12:00:00'), email: 'g3@example.com', method: 'upi', ref: 'M11', items: [{ pid: 'p5', qty: 1, unit: 10000 }] },
      { id: 'b12', at: at(0, '09:00:00'), status: 'FAILED', email: 'f@example.com', items: [{ pid: 'p1', qty: 1, unit: 123450 }] },
      { id: 'b13', at: at(1, '09:00:00'), status: 'PENDING', email: 'p@example.com', items: [{ pid: 'p2', qty: 1, unit: 49950 }] },
      { id: 'b14', at: at(2, '09:00:00'), status: 'PROCESSING', email: 'q@example.com', ref: 'M14', items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
      { id: 'b15', at: at(2, '10:00:00'), status: 'CANCELLED', fulfil: 'CANCELED', email: 'c@example.com', items: [{ pid: 'p4', qty: 2, unit: 25000 }] },
      { id: 'b17', at: at(6, '00:10:00'), email: 'g4@example.com', method: 'upi', ref: 'M17', items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
      { id: 'b18', at: at(0, '00:10:00'), email: 'g5@example.com', method: 'upi', ref: 'M18', items: [{ pid: 'p4', qty: 1, unit: 25000 }] },
      { id: 'b16', at: at(1, '11:00:00'), fulfil: 'CANCELED', email: 'x@example.com', method: 'upi', ref: 'M16', items: [{ pid: 'p5', qty: 7, unit: 10000 }], shipping: 7700 },
    ].map(buildOrder);
    const bById = Object.fromEntries(B.map((o) => [o.id, o]));
    for (const o of B) await insertOrder(sql, o);

    const BREFUNDS = [
      { id: 'br2', orderId: 'b2', amount: 20000, at: at(0, '12:00:00') },
      { id: 'br16', orderId: 'b16', amount: 77700, at: at(0, '13:00:00') },
      { id: 'br8', orderId: 'b8', amount: 100000, at: at(5, '12:00:00') },
    ];
    for (const r of BREFUNDS) await insertRefund(sql, r);

    const BUSERS = [
      { id: 'u1', email: 'rita@example.com', first: 'Rita', last: 'Sharma', at: at(0, '08:00:00') },
      { id: 'u2', email: 'new@example.com', first: 'New', last: 'Person', at: at(1, '23:50:00') },
      { id: 'u3', email: 'u3@example.com', first: 'Three', last: 'Old', at: at(8, '12:00:00') },
      { id: 'u4', email: 'u4@example.com', first: 'Four', last: 'Older', at: at(40, '12:00:00') },
    ];
    for (const u of BUSERS) await insertUser(sql, u);
    const SESSIONS = [
      { token: 's1', userId: 'u1', at: at(0, '08:01:00') },
      { token: 's2', userId: 'u1', at: at(0, '09:01:00') },
      { token: 's3', userId: 'u2', at: at(1, '23:51:00') },
      { token: 's4', userId: 'u3', at: at(9, '12:00:00') },
      { token: 's5', userId: 'u4', at: at(50, '12:00:00') },
    ];
    for (const s of SESSIONS) await insertSession(sql, s);

    const ago = (iso) => diffDays(today, istDay(iso));
    const inWindow = (iso, days, offset = 0) => ago(iso) >= offset && ago(iso) < offset + days;
    const RANGES = { today: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

    const sales = async (range) => {
      const result = await analytics.getSalesAnalytics(range);
      assert.equal(result.ok, true);
      return result.data;
    };
    const capturedIn = (days, offset = 0) => B.filter((o) => isCaptured(o) && inWindow(o.at, days, offset));

    for (const [range, days] of Object.entries(RANGES)) {
      await t.test(`Overview sales (${range}) | revenue, orders, AOV, units use IST days and the captured predicate`, async () => {
        const data = await sales(range);
        const now = capturedIn(days);
        const before = capturedIn(days, days);
        assert.equal(data.revenue.current, sum(now, (o) => o.total), 'revenue');
        assert.equal(data.revenue.previous, sum(before, (o) => o.total), 'previous revenue');
        assert.equal(data.orders.current, now.length, 'orders');
        assert.equal(data.orders.previous, before.length, 'previous orders');
        assert.equal(data.aov.current, now.length ? Math.round(sum(now, (o) => o.total) / now.length) : 0, 'aov');
        assert.equal(data.units, sum(now, (o) => sum(o.items, (l) => l.quantity)), 'units');
        assert.equal(data.productCount, new Set(now.flatMap((o) => o.items.map((l) => l.productId))).size, 'products');
      });

      await t.test(`Overview sales (${range}) | revenue series adds up to the headline and sits on the right IST days`, async () => {
        const data = await sales(range);
        assert.equal(sum(data.series, (p) => p.revenuePaise), data.revenue.current, 'series total');
        assert.equal(sum(data.series, (p) => p.orders), data.orders.current, 'series orders');
        if (range !== '12m') {
          assert.equal(data.series.length, days);
          const now = capturedIn(days);
          for (let i = 0; i < days; i += 1) {
            const dayAgo = days - 1 - i;
            assert.equal(data.series[i].revenuePaise, sum(now.filter((o) => ago(o.at) === dayAgo), (o) => o.total), `${dayAgo} days ago`);
          }
        }
      });

      await t.test(`Overview sales (${range}) | categories, top products and channels reconcile with revenue`, async () => {
        const data = await sales(range);
        const now = capturedIn(days);
        const net = sum(now, (o) => o.subtotal - o.discount);
        const shipping = sum(now, (o) => o.shipping);
        assert.equal(sum(data.categories, (c) => c.revenuePaise), net, 'categories (net, before shipping)');
        assert.equal(sum(data.channels, (c) => c.revenuePaise), data.revenue.current, 'channels');
        assert.equal(sum(data.channels, (c) => c.orders), data.orders.current, 'channel orders');
        assert.equal(net + shipping, data.revenue.current, 'item revenue + shipping = revenue');
        const perProduct = new Map();
        for (const o of now) for (const l of o.items) perProduct.set(l.productId, (perProduct.get(l.productId) ?? 0) + l.lineTotalPaise - l.discountPaise);
        const top = [...perProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        assert.deepEqual(data.topProducts.map((p) => [p.productId, p.revenuePaise]), top);
      });
    }

    await t.test('Overview sales (7d) | refunds are reported on captured orders by refund day', async () => {
      const data = await sales('7d');
      const refunds = BREFUNDS.filter((r) => isCaptured(bById[r.orderId]) && inWindow(r.at, 7));
      assert.equal(data.refundedOrders, new Set(refunds.map((r) => r.orderId)).size);
      assert.equal(data.refundsPaise, sum(refunds, (r) => r.amount));
    });

    await t.test('Overview vs reports | Overview revenue = order report = day-wise = customer report for the same days', async () => {
      const range = { from: addDays(today, -6), to: today };
      const overview = await sales('7d');
      const filters = rules.parseReportFilters(range, new Date(), TZ).filters;
      const orders = (await getReport('orders', filters)).data;
      const daily = (await getReport('daily', filters)).data;
      const customers = (await getReport('customers', filters)).data;
      const items = (await getReport('items', filters)).data;
      assert.equal(orders.totals.revenue, overview.revenue.current);
      assert.equal(daily.totals.revenue, overview.revenue.current);
      assert.equal(customers.totals.revenue, overview.revenue.current);
      assert.equal(orders.totals.paid, overview.orders.current);
      assert.equal(orders.totals.units, overview.units);
      assert.equal(items.totals.revenue + sum(capturedIn(7), (o) => o.shipping), overview.revenue.current);
      const list = await ordersLib.listOrders({ dateFrom: range.from, dateTo: range.to, page: 1 });
      let total = 0;
      let pages = list.data.pageCount;
      for (let page = 1; page <= pages; page += 1) {
        const result = await ordersLib.listOrders({ dateFrom: range.from, dateTo: range.to, page });
        for (const order of result.data.orders) if (order.paymentStatus === 'PAID' && order.fulfilmentStatus !== 'CANCELED') total += order.totalPaise;
      }
      assert.equal(total, overview.revenue.current, 'orders list amount');
    });

    for (const [range, days] of Object.entries(RANGES)) {
      await t.test(`Overview customers (${range}) | new users, sessions, buyers, repeat, guest vs registered`, async () => {
        const result = await analytics.getUsersAnalytics(range);
        assert.equal(result.ok, true);
        const data = result.data;
        const now = capturedIn(days);
        assert.equal(data.newUsers.current, BUSERS.filter((u) => inWindow(u.at, days)).length, 'new users');
        assert.equal(data.newUsers.previous, BUSERS.filter((u) => inWindow(u.at, days, days)).length, 'previous new users');
        assert.equal(data.sessions.current, SESSIONS.filter((s) => inWindow(s.at, days)).length, 'sessions');
        assert.equal(data.sessions.previous, SESSIONS.filter((s) => inWindow(s.at, days, days)).length, 'previous sessions');
        const groups = new Map();
        for (const o of now) groups.set(buyerKey(o), (groups.get(buyerKey(o)) ?? 0) + 1);
        assert.equal(data.buyers, groups.size, 'buyers (walk-ins without email are separate buyers)');
        assert.equal(data.repeatBuyers, [...groups.values()].filter((n) => n > 1).length, 'repeat buyers');
        assert.equal(data.registeredOrders, now.filter((o) => o.userId).length, 'registered orders');
        assert.equal(data.guestOrders, now.filter((o) => !o.userId).length, 'guest orders');
        assert.equal(data.registeredBuyers, new Set(now.filter((o) => o.userId).map((o) => o.userId)).size, 'registered buyers');
        if (range !== '12m') {
          assert.equal(data.series.length, days);
          assert.equal(sum(data.series, (p) => p.signups), data.newUsers.current, 'signup series total');
        } else {
          assert.equal(sum(data.series, (p) => p.signups), data.newUsers.current, 'signup series total (12m)');
        }
      });
    }

    await t.test('Overview customers (30d) | top customers by revenue', async () => {
      const result = await analytics.getUsersAnalytics('30d');
      const now = capturedIn(30);
      const groups = new Map();
      for (const o of now) {
        const g = groups.get(buyerKey(o)) ?? { orders: 0, revenue: 0 };
        g.orders += 1;
        g.revenue += o.total;
        groups.set(buyerKey(o), g);
      }
      const top = [...groups.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
      assert.deepEqual(result.data.topCustomers.map((c) => [c.orders, c.revenuePaise]), top.map((g) => [g.orders, g.revenue]));
    });

    for (const [range, days] of Object.entries(RANGES)) {
      await t.test(`Overview payments (${range}) | captured, failed, pending, outcomes by status and methods`, async () => {
        const result = await analytics.getTransactionsAnalytics(range);
        assert.equal(result.ok, true);
        const data = result.data;
        const created = B.filter((o) => inWindow(o.at, days));
        const previous = B.filter((o) => inWindow(o.at, days, days));
        const effective = (o) => (o.fulfil === 'CANCELED' ? 'CANCELLED' : o.status);
        const capturedNow = created.filter(isCaptured);
        assert.equal(data.captured.current, capturedNow.length, 'captured (same as Sales captured orders)');
        assert.equal(data.captured.previous, previous.filter(isCaptured).length, 'previous captured');
        assert.equal(data.failed, created.filter((o) => effective(o) === 'FAILED').length, 'failed (current window only)');
        assert.equal(data.pending, created.filter((o) => ['CREATED', 'PENDING', 'PROCESSING'].includes(effective(o))).length, 'pending (current window only)');
        for (const status of ['PAID', 'FAILED', 'PENDING', 'PROCESSING', 'CANCELLED']) {
          const bucket = data.statuses.find((s) => s.status === status);
          const list = created.filter((o) => effective(o) === status);
          assert.equal(bucket?.count ?? 0, list.length, `${status} count`);
          assert.equal(bucket?.amountPaise ?? 0, sum(list, (o) => o.total), `${status} amount`);
        }
        assert.equal(sum(data.methods, (m) => m.amountPaise), sum(capturedNow, (o) => o.total), 'methods add up to revenue');
        assert.equal(sum(data.channels, (c) => c.revenuePaise), sum(capturedNow, (o) => o.total), 'channels add up to revenue');
        const refunds = BREFUNDS.filter((r) => inWindow(r.at, days));
        assert.equal(data.refundedOrders, new Set(refunds.map((r) => r.orderId)).size, 'refunded orders (by refund day, any order)');
        assert.equal(data.refundedPaise, sum(refunds, (r) => r.amount), 'refunded money');
        const recent = [...created].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8).map((o) => o.id);
        assert.deepEqual(data.recent.map((r) => r.txnid), recent, 'recent transactions');
      });
    }

    await t.test('Overview payments | payment outcomes PAID amount equals Sales revenue', async () => {
      const sales7 = await sales('7d');
      const tx = (await analytics.getTransactionsAnalytics('7d')).data;
      assert.equal(tx.statuses.find((s) => s.status === 'PAID').amountPaise, sales7.revenue.current);
      assert.equal(tx.captured.current, sales7.orders.current);
    });

    await t.test('Overview regressions | unpaid cancellation, actual methods, split instruments and own payment dates', async () => {
      await sql.begin(async (tx) => {
        await tx`savepoint overview_regressions`;
        const previousSql = globalThis.__gadzioSql;
        globalThis.__gadzioSql = tx;
        try {
          const before = (await analytics.getTransactionsAnalytics('7d')).data;
          const specs = [
            { id: 'reg_cancel', at: at(0, '08:00:00'), status: 'PENDING', fulfil: 'CANCELED', items: [{ pid: 'p1', qty: 1, unit: 1100 }] },
            { id: 'reg_payu', at: at(0, '08:10:00'), method: 'payu', ref: 'REG_PAYU', items: [{ pid: 'p1', qty: 1, unit: 2200 }] },
            { id: 'reg_split', at: at(0, '08:20:00'), method: 'payu', items: [{ pid: 'p1', qty: 1, unit: 3300 }] },
            { id: 'reg_pending', at: at(0, '08:30:00'), method: 'payu', items: [{ pid: 'p1', qty: 1, unit: 4400 }] },
          ];
          for (const spec of specs) await insertOrder(tx, buildOrder(spec));
          await tx`update orders set payu_mode = 'UPI' where id = 'reg_payu'`;
          await insertPayment(tx, { orderId: 'reg_split', channel: 'manual', method: 'cash', amount: 1000, at: at(0, '08:21:00') });
          await insertPayment(tx, { orderId: 'reg_split', channel: 'manual', method: 'upi', amount: 2300, at: at(0, '08:22:00') });
          await insertPayment(tx, { orderId: 'reg_pending', channel: 'manual', method: 'cash', amount: 4400, at: at(0, '08:31:00') });
          await tx`
            insert into order_payments (order_id, channel, method, amount_paise, status, paid_at, created_at)
            values ('reg_pending', 'manual', 'bank_transfer', 4400, 'PENDING', null, ${at(10, '08:00:00')}::timestamptz)
          `;

          const afterResult = await analytics.getTransactionsAnalytics('7d');
          assert.equal(afterResult.ok, true);
          const after = afterResult.data;
          const statusCount = (data, status) => data.statuses.find((s) => s.status === status)?.count ?? 0;
          assert.equal(after.pending, before.pending, 'cancelled unpaid order is not pending');
          assert.equal(statusCount(after, 'CANCELLED'), statusCount(before, 'CANCELLED') + 1);
          assert.equal(after.captured.current, before.captured.current + 3);
          const methodAmount = (data, method) => data.methods.find((m) => m.method === method)?.amountPaise ?? 0;
          assert.equal(methodAmount(after, 'UPI') - methodAmount(before, 'UPI'), 2200, 'PayU mode, not generic gateway label');
          assert.equal(methodAmount(after, 'mixed') - methodAmount(before, 'mixed'), 3300, 'split instruments use mixed');
          assert.equal(methodAmount(after, 'cash') - methodAmount(before, 'cash'), 4400, 'settled row determines method; pending attempt does not');
          assert.equal(methodAmount(after, 'payu'), methodAmount(before, 'payu'), 'generic order label gains no revenue');

          const exported = await transactionsLib.listTransactionsForExport({ range: '7d' });
          assert.equal(exported.ok, true);
          assert.equal(exported.data.find((r) => r.txnid === 'reg_payu').method, 'UPI');
          const paymentRows = exported.data.filter((r) => r.txnid === 'reg_pending');
          assert.equal(paymentRows.length, 1, 'old unsettled attempt stays outside the window despite the order paid_at');
          assert.equal(paymentRows[0].status, 'PAID');
          assert.equal(paymentRows[0].recordedAt, `${today} 08:31:00`);

          const statement = await run('transactions', { from: addDays(today, -6), to: today });
          assert.equal(statement.rows.find((r) => r.order === 'reg_payu').method, 'UPI');
        } finally {
          await tx`rollback to savepoint overview_regressions`;
          globalThis.__gadzioSql = previousSql;
        }
      });
    });

    await t.test('Overview payments | transaction CSV export covers the same days as the Overview range', async () => {
      const result = await transactionsLib.listTransactionsForExport({ range: '7d' });
      assert.equal(result.ok, true);
      const expected = B.filter((o) => o.status === 'PAID' && inWindow(o.at, 7));
      const ids = new Set(result.data.map((r) => r.txnid));
      for (const o of expected) assert.ok(ids.has(o.id), `${o.id} is in the 7 day export`);
      for (const o of B.filter((x) => x.status === 'PAID' && !inWindow(x.at, 7))) assert.ok(!ids.has(o.id), `${o.id} is not in the 7 day export`);
    });
  });
});

// Keep a reference so lint-style tools do not flag the imported helper.
void istMinute;

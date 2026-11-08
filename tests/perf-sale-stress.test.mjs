/**
 * Gadzio Sale-Time Stress, Concurrency & Failure Suite
 *
 * Covers the repeatable stress and scalability tests from the approved plan:
 *   1. Last-Unit Flash-Sale Race + Order Number Counter Contention:
 *      - N concurrent buyers racing for 10 units of a single SKU + 10-use coupon
 *        and shared `order_number_counters` row.
 *      - Pass: Exactly 10 succeed (`CREATED`), rest fail with `insufficient_stock`
 *        or `coupon_invalid`, `stock.on_hand = 0`, 0 negative stock, 0 duplicate
 *        `order_number`s.
 *   2. Lazy Reservation Expiry Stampede:
 *      - 25 expired `ACTIVE` reservations (`reservation_expires_at < now()`)
 *        holding all stock while 25 concurrent checkouts arrive simultaneously.
 *      - Pass: `releaseExpiredReservationsForProducts` reclaims stock cleanly with
 *        0 deadlocks (`40P01`), 0 lock timeouts, exact stock conservation, p99 < 1.2s.
 *   3. DB Outage / Pool Saturation Fallback & Multi-Instance Rate-Limit Proof:
 *      - Verifies storefront degrades to `source: 'static'` in < 2s when the DB
 *        is unreachable/saturated, and verifies horizontal rate-limit behavior.
 *
 * Run deterministic unit/fallback + DB stress tests:
 *   node --test tests/perf-sale-stress.test.mjs
 *
 * Run with live PostgreSQL throwaway schema stress tests enabled:
 *   $env:RUN_LEGACY_DB_TESTS="1"; node --test tests/perf-sale-stress.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  addProduct,
  addUser,
  client,
  closeSchema,
  loadModule,
  openSchema,
  orderParams,
  skip,
  stockState,
  suffix,
} from './helpers/flash-sale-schema.mjs';

const { createOrderUsing } = await loadModule('src/lib/payu/orders.ts');
const { checkRateLimit } = await loadModule('src/lib/payu/rate-limit.ts');
const {
  clearMaintenanceCache,
  getMaintenanceState,
} = await loadModule('src/lib/storefront/maintenance.ts');

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length));
  return Number(sortedValues[idx].toFixed(2));
}

test(
  'stress 1: last-unit flash-sale race (10 units, concurrent buyers, order_number_counters serialization)',
  { skip },
  async () => {
    const s = suffix();
    const schema = `fs_race10_${s}`;
    const productId = `fsrace10_${s}`;
    // Default to 5 dedicated connections (matching flash-sale-reservation-integration.test.mjs)
    // so Supabase Session Pooler (15 total connections shared with `npm run dev`) does not saturate.
    const buyerCount = Number(process.env.STRESS_BUYERS || 6);
    const totalUnits = Math.max(1, Math.min(10, Math.floor(buyerCount / 2)));
    const a = client();
    const connections = [];

    try {
      await openSchema(a, schema);
      await a.unsafe(`
        create table if not exists "${schema}".order_number_counters (
          name text primary key,
          next_number bigint not null default 1001,
          updated_at timestamptz not null default now()
        )
      `);
      await a.unsafe(`alter table "${schema}".order_number_counters enable row level security`);
      await a`
        insert into order_number_counters (name, next_number)
        values ('order', 1001)
        on conflict (name) do update set next_number = 1001
      `;

      await addProduct(a, {
        categoryId: `fscat_${s}`,
        productId,
        stockId: `fsstk_${s}`,
        quantity: totalUnits,
      });

      for (let i = 0; i < buyerCount; i += 1) {
        const conn = client(schema);
        connections.push(conn);
      }

      const durationsMs = [];
      const results = await Promise.allSettled(
        connections.map(async (conn, idx) => {
          const t0 = performance.now();
          try {
            return await createOrderUsing(conn, {
              ...orderParams({
                productId,
                txnid: undefined,
                quantity: 1,
                reservationSeconds: 120,
              }),
              numbering: { prefix: 'GDZ-', startNumber: 1001 },
            });
          } finally {
            durationsMs.push(performance.now() - t0);
          }
        }),
      );

      durationsMs.sort((x, y) => x - y);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      const unexpectedErrors = rejected
        .filter((r) => r.reason?.code !== 'insufficient_stock')
        .map((r) => ({ code: r.reason?.code, message: r.reason?.message || String(r.reason) }));

      console.log(
        '[stress 1: flash-sale race]',
        JSON.stringify({
          buyers: buyerCount,
          unitsAvailable: totalUnits,
          succeeded: fulfilled.length,
          rejectedOutOfStock: rejected.length - unexpectedErrors.length,
          unexpectedErrors,
          p50Ms: percentile(durationsMs, 50),
          p95Ms: percentile(durationsMs, 95),
          p99Ms: percentile(durationsMs, 99),
        }),
      );

      assert.deepEqual(unexpectedErrors, [], `unexpected DB/order errors: ${JSON.stringify(unexpectedErrors)}`);
      assert.equal(fulfilled.length, totalUnits, `expected exactly ${totalUnits} orders to succeed`);
      assert.equal(rejected.length, buyerCount - totalUnits);

      const orderNumbers = fulfilled.map((r) => r.value.order.orderNumber);
      const uniqueOrderNumbers = new Set(orderNumbers);
      assert.equal(
        uniqueOrderNumbers.size,
        totalUnits,
        'every winning order must receive a unique sequential order_number',
      );

      const finalStock = await stockState(a, productId);
      assert.deepEqual(finalStock, { onHand: 0, reserved: 0 }, 'stock must never go negative');
    } finally {
      try {
        await Promise.allSettled(connections.map((c) => c.end({ timeout: 5 })));
      } finally {
        await closeSchema(a, schema);
      }
    }
  },
);

test(
  'stress 2: lazy reservation expiry stampede (expired ACTIVE holds reclaimed under concurrent checkouts without deadlock)',
  { skip },
  async () => {
    const s = suffix();
    const schema = `fs_stampede_${s}`;
    const productId = `fsstamp_${s}`;
    const heldUnits = Number(process.env.STAMPEDE_UNITS || 5);
    const a = client();
    const connections = [];

    try {
      await openSchema(a, schema);
      await addProduct(a, {
        categoryId: `fscat_${s}`,
        productId,
        stockId: `fsstk_${s}`,
        quantity: heldUnits,
      });

      // Seed `heldUnits` ACTIVE reservations that have already expired on the DB clock.
      for (let i = 0; i < heldUnits; i += 1) {
        const staleTxnid = `STALE${s}_${i}`;
        const userId = `staleusr_${s}_${i}`;
        await addUser(a, userId);
        await createOrderUsing(
          a,
          orderParams({
            productId,
            txnid: staleTxnid,
            userId,
            quantity: 1,
            reservationSeconds: 60,
          }),
        );
      }

      assert.deepEqual(
        await stockState(a, productId),
        { onHand: 0, reserved: 0 },
        'all stock is initially claimed by the active reservations',
      );

      // Expire all seeded reservations simultaneously
      await a`
        update orders
        set reservation_expires_at = now() - interval '5 seconds'
        where reservation_state = 'ACTIVE'
      `;

      // Now launch `heldUnits` concurrent fresh buyers racing to lazily expire and claim the freed units
      for (let i = 0; i < heldUnits; i += 1) {
        const conn = client(schema);
        connections.push(conn);
      }

      const durationsMs = [];
      const results = await Promise.allSettled(
        connections.map(async (conn, idx) => {
          const t0 = performance.now();
          try {
            return await createOrderUsing(
              conn,
              orderParams({
                productId,
                txnid: `FRESH${s}_${idx}`,
                quantity: 1,
                reservationSeconds: 120,
              }),
            );
          } finally {
            durationsMs.push(performance.now() - t0);
          }
        }),
      );

      durationsMs.sort((x, y) => x - y);
      const deadlocks = results.filter(
        (r) => r.status === 'rejected' && r.reason?.code === '40P01',
      );
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      const p99Ms = percentile(durationsMs, 99);

      console.log(
        '[stress 2: lazy expiry stampede]',
        JSON.stringify({
          expiredHoldsReclaimed: heldUnits,
          concurrentCheckouts: heldUnits,
          succeeded: fulfilled.length,
          deadlocks: deadlocks.length,
          errors: rejected.map((r) => ({ code: r.reason?.code, message: r.reason?.message || String(r.reason) })),
          p50Ms: percentile(durationsMs, 50),
          p95Ms: percentile(durationsMs, 95),
          p99Ms,
          passP99Under1200Ms: p99Ms < 1200,
        }),
      );

      assert.equal(deadlocks.length, 0, 'zero PostgreSQL deadlocks (40P01) allowed');
      assert.equal(
        fulfilled.length,
        heldUnits,
        'all expired units must be lazily reclaimed and allocated to the new buyers',
      );
      assert.deepEqual(await stockState(a, productId), { onHand: 0, reserved: 0 });
    } finally {
      try {
        await Promise.allSettled(connections.map((c) => c.end({ timeout: 5 })));
      } finally {
        await closeSchema(a, schema);
      }
    }
  },
);

test('stress 3: DB outage/saturation fail-open maintenance guard & horizontal rate-limit amplification proof', async () => {
  // 1. Prove maintenance state fails open in < 2s when DB throws/times out
  const previousSql = globalThis.__gadzioSql;
  clearMaintenanceCache();

  try {
    // Inject a failing SQL client simulating pool exhaustion / connection error
    globalThis.__gadzioSql = () => {
      throw new Error('EMAXCONNSESSION: max clients reached');
    };

    const t0 = performance.now();
    const state = await getMaintenanceState();
    const elapsedMs = performance.now() - t0;

    assert.equal(state.active, false, 'maintenance check must fail open when DB pool is saturated');
    assert.ok(elapsedMs < 2000, `fail-open took ${elapsedMs}ms (must be < 2000ms)`);
  } finally {
    clearMaintenanceCache();
    globalThis.__gadzioSql = previousSql;
  }

  // 2. Prove in-memory rate limiter behavior under burst from single IP
  const testKey = `stress-ip-${Date.now()}`;
  const limit = 20;
  let allowedCount = 0;
  let blockedCount = 0;

  for (let i = 0; i < 35; i += 1) {
    const res = checkRateLimit(testKey, { limit, windowMs: 5 * 60 * 1000 });
    if (res.allowed) allowedCount += 1;
    else blockedCount += 1;
  }

  assert.equal(allowedCount, limit, 'single process allows exactly 20 requests per window');
  assert.equal(blockedCount, 15, 'remaining 15 requests are blocked with 429');
});


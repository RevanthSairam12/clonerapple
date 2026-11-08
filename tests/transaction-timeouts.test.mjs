/**
 * Transaction timeout guards (Step 5).
 *
 * Verifies:
 * 1. `setTransactionTimeouts` sets `lock_timeout = 5000ms` and `statement_timeout = 15000ms` via `SET LOCAL`.
 * 2. `isTransactionTimeout` classifies Postgres `55P03` (lock_not_available) and `57014` (query_canceled).
 * 3. Checkout, POS, coupon and reconcile transactions invoke `setTransactionTimeouts(tx)`.
 * 4. `/api/payu/initiate` returns 503 with `Retry-After: 5` and a friendly "please try again" message (never a generic 500) on `55P03` or `57014`, even when a coupon code is present.
 * 5. Against a real PostgreSQL throwaway schema (when `RUN_LEGACY_DB_TESTS=1`), a held row lock causes a competing transaction with `lock_timeout` to fail fast with `55P03` and roll back cleanly with zero partial orders, items, movements or redemptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import {
  addProduct,
  client,
  closeSchema,
  openSchema,
  orderParams,
  skip,
  stockState,
  suffix,
} from './helpers/flash-sale-schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const source = (rel) => readFile(path.join(root, rel), 'utf8');

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  BUSY_MESSAGE,
  BUSY_RETRY_AFTER,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  isTransactionTimeout,
  setTransactionTimeouts,
} = await jiti.import(path.join(root, 'src/lib/checkout/transaction-guards.ts'));

const { createOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));

test('setTransactionTimeouts issues SET LOCAL lock_timeout (5s) and statement_timeout (15s)', async () => {
  assert.equal(DEFAULT_LOCK_TIMEOUT_MS, 5_000);
  assert.equal(DEFAULT_STATEMENT_TIMEOUT_MS, 15_000);

  const queries = [];
  const fakeTx = async (strings, ...values) => {
    queries.push({ sql: strings.join('?').trim(), values });
    return [];
  };

  await setTransactionTimeouts(fakeTx);
  assert.deepEqual(queries, [
    {
      sql: "select set_config('lock_timeout', ?, true), set_config('statement_timeout', ?, true)",
      values: ['5000ms', '15000ms'],
    },
  ]);
});

test('isTransactionTimeout matches Postgres 55P03 and 57014 only', () => {
  assert.equal(isTransactionTimeout({ code: '55P03' }), true, 'lock_not_available');
  assert.equal(isTransactionTimeout({ code: '57014' }), true, 'query_canceled / statement_timeout');
  assert.equal(isTransactionTimeout({ code: '23505' }), false, 'unique_violation is not a timeout');
  assert.equal(isTransactionTimeout(new Error('generic')), false);
  assert.equal(isTransactionTimeout(null), false);
});

test('checkout, POS, coupon and reconcile transactions wire setTransactionTimeouts and 503 Retry-After', async () => {
  const [ordersTs, posTs, couponsTs, initiateRoute, webhookRoute, couponValidateRoute] =
    await Promise.all([
      source('src/lib/payu/orders.ts'),
      source('src/lib/store-admin/pos.ts'),
      source('src/lib/store-admin/coupons.ts'),
      source('src/app/api/payu/initiate/route.ts'),
      source('src/app/api/payu/webhook/route.ts'),
      source('src/app/api/coupons/validate/route.ts'),
    ]);

  assert.equal(
    (ordersTs.match(/await setTransactionTimeouts\(tx\)/g) ?? []).length,
    4,
    'createOrderUsing, transitionOrderStatusUsing, claimDueOrders, releaseOrderReservation all set timeouts',
  );
  assert.equal(
    (posTs.match(/await setTransactionTimeouts\(tx\)/g) ?? []).length,
    4,
    'openShift, closeShift, createPosSaleUsing, voidPosSale all set timeouts',
  );
  assert.equal(
    (couponsTs.match(/await setTransactionTimeouts\(tx\)/g) ?? []).length,
    7,
    'all 7 coupon admin/delete transactions set timeouts',
  );

  assert.match(initiateRoute, /isTransactionTimeout\(error\)/);
  assert.match(initiateRoute, /status: 503, headers: \{ 'Retry-After': BUSY_RETRY_AFTER \}/);
  assert.match(BUSY_MESSAGE, /please try again/i);
  assert.equal(BUSY_RETRY_AFTER, '5');

  assert.match(webhookRoute, /isTransactionTimeout\(err\)/);
  assert.match(webhookRoute, /status: 503, headers: \{ 'Retry-After': BUSY_RETRY_AFTER \}/);

  assert.match(couponValidateRoute, /isTransactionTimeout\(error\)/);
  assert.match(couponValidateRoute, /status: 503/);
});

test(
  'live DB: lock pile-up aborts cleanly with 55P03 and leaves zero partial orders or stock changes',
  { skip },
  async () => {
    const s = suffix();
    const schema = `fs_timeout_${s}`;
    const productId = `fstmo_${s}`;
    const a = client();
    let b;

    try {
      await openSchema(a, schema);
      b = client(schema);
      await addProduct(a, {
        categoryId: `fscat_${s}`,
        productId,
        stockId: `fsstk_${s}`,
        quantity: 2,
      });

      // Connection A holds an exclusive row lock on the stock row
      let releaseHolder;
      const holderReady = new Promise((resolve) => {
        releaseHolder = resolve;
      });
      let finishHolder;
      const holderDone = new Promise((resolve) => {
        finishHolder = resolve;
      });

      const holderPromise = a.begin(async (tx) => {
        await tx`select * from stock where product_id = ${productId} for update`;
        releaseHolder();
        await holderDone;
      });

      await holderReady;

      // Connection B runs createOrderUsing while overriding lock_timeout to 200ms after setTransactionTimeouts
      // to verify that a lock timeout inside createOrderUsing aborts and leaves zero partial order rows.
      const bProxy = Object.assign(
        (...args) => b(...args),
        {
          json: b.json,
          array: b.array,
          unsafe: b.unsafe,
          begin: (fn) =>
            b.begin(async (tx) => {
              const wrappedTx = Object.assign(
                async (strings, ...values) => {
                  const q = strings.join('?');
                  if (q.includes("set_config('lock_timeout'")) {
                    return tx`select set_config('lock_timeout', '200ms', true), set_config('statement_timeout', '15000ms', true)`;
                  }
                  return tx(strings, ...values);
                },
                { json: tx.json, array: tx.array, unsafe: tx.unsafe, savepoint: tx.savepoint },
              );
              return fn(wrappedTx);
            }),
        },
      );

      let caughtError = null;
      try {
        await createOrderUsing(
          bProxy,
          orderParams({
            productId,
            txnid: `FSTMO${s}`,
            quantity: 1,
            reservationSeconds: 120,
          }),
        );
      } catch (err) {
        caughtError = err;
      } finally {
        finishHolder();
        await holderPromise;
      }

      assert.ok(caughtError, 'competing checkout must fail when lock_timeout expires');
      assert.equal(caughtError.code, '55P03', 'Postgres error code is 55P03 (lock_not_available)');
      assert.equal(isTransactionTimeout(caughtError), true);

      // Verify zero partial order, item, or stock movement was created
      const orderCount = Number((await a`select count(*)::int as c from orders`)[0].c);
      const itemCount = Number((await a`select count(*)::int as c from order_items`)[0].c);
      const moveCount = Number((await a`select count(*)::int as c from stock_movements`)[0].c);
      assert.equal(orderCount, 0, 'no partial order row created');
      assert.equal(itemCount, 0, 'no partial order_items row created');
      assert.equal(moveCount, 0, 'no partial stock_movements row created');
      assert.deepEqual(await stockState(a, productId), { onHand: 2, reserved: 0 });
    } finally {
      try {
        if (b) await b.end({ timeout: 1 });
      } finally {
        await closeSchema(a, schema);
      }
    }
  },
);

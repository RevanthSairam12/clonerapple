import test from 'node:test';
import assert from 'node:assert/strict';

import {
  outstandingClaimQuantity,
  planStockClaim,
} from '../src/lib/checkout/stock-rules.ts';

function row(overrides = {}) {
  return { product_id: 'p1', on_hand: 5, reserved: 0, track_inventory: true, ...overrides };
}

function line(productId, quantity, productName) {
  return { productId, quantity, productName };
}

test('an untracked product never blocks checkout and is never claimed', () => {
  const result = planStockClaim(
    [line('p1', 99)],
    [row({ track_inventory: false, on_hand: 0 })],
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.untracked, ['p1']);
});

test('a product with no stock row is untracked', () => {
  const result = planStockClaim([line('p9', 3)], []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.untracked, ['p9']);
});

test('available stock is on_hand minus reserved', () => {
  assert.equal(planStockClaim([line('p1', 3)], [row({ on_hand: 5, reserved: 2 })]).ok, true);
  assert.equal(planStockClaim([line('p1', 4)], [row({ on_hand: 5, reserved: 2 })]).ok, false);
});

test('out-of-stock and short quantities are rejected with a customer-safe message', () => {
  const soldOut = planStockClaim([line('p1', 1, 'USB-C Cable')], [row({ on_hand: 0 })]);
  assert.equal(soldOut.ok, false);
  assert.match(soldOut.error, /Out of stock: USB-C Cable/);

  const short = planStockClaim([line('p1', 2, 'USB-C Cable')], [row({ on_hand: 1 })]);
  assert.equal(short.ok, false);
  assert.match(short.error, /Only 1 left of USB-C Cable/);
});

test('duplicate lines for one product are aggregated before the check', () => {
  const result = planStockClaim(
    [line('p1', 1), line('p1', 1)],
    [row({ on_hand: 1 })],
  );
  assert.equal(result.ok, false, 'two lines of one unit cannot both pass against one unit');
});

test('invalid quantities are rejected rather than truncated', () => {
  assert.equal(planStockClaim([line('p1', 0)], [row()]).ok, false);
  assert.equal(planStockClaim([line('p1', -2)], [row()]).ok, false);
  assert.equal(planStockClaim([line('p1', 1.5)], [row()]).ok, false);
  assert.equal(planStockClaim([{ productId: '', quantity: 1 }], [row()]).ok, false);
});

test('exactly one of two buyers can claim the last unit', () => {
  // Mirrors the database flow: each attempt re-reads the locked row, the
  // guarded claim only succeeds while the units are still there, and the
  // losing transaction is rolled back as a whole.
  const stock = new Map([['p1', { on_hand: 1, reserved: 0, track_inventory: true }]]);
  const ledger = [];

  function buy(quantity) {
    const plan = planStockClaim(
      [line('p1', quantity, 'Last Unit')],
      [{ product_id: 'p1', ...stock.get('p1') }],
    );
    if (!plan.ok) return { ok: false, error: plan.error };
    // The guarded update: `where on_hand - reserved >= qty`.
    const current = stock.get('p1');
    if (current.on_hand - current.reserved < quantity) {
      return { ok: false, error: 'race lost' };
    }
    stock.set('p1', { ...current, on_hand: current.on_hand - quantity });
    ledger.push({ delta: -quantity, reason: 'sale' });
    return { ok: true };
  }

  const first = buy(1);
  const second = buy(1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(stock.get('p1').on_hand, 0);
  assert.deepEqual(ledger, [{ delta: -1, reason: 'sale' }]);
});

test('release arithmetic is based on the movement ledger, so a duplicate callback is a no-op', () => {
  assert.equal(outstandingClaimQuantity(2, 0), 2);
  assert.equal(outstandingClaimQuantity(2, 1), 1);
  assert.equal(outstandingClaimQuantity(2, 2), 0);
  assert.equal(outstandingClaimQuantity(2, 5), 0, 'never release more than was claimed');
  assert.equal(outstandingClaimQuantity('abc', undefined), 0);

  // First FAILED callback releases the claim; the duplicate finds nothing.
  let claimed = 3;
  let released = 0;
  const releaseOnce = () => {
    const outstanding = outstandingClaimQuantity(claimed, released);
    if (outstanding === 0) return 0;
    released += outstanding;
    return outstanding;
  };
  assert.equal(releaseOnce(), 3);
  assert.equal(releaseOnce(), 0);
  assert.equal(released, 3);
});

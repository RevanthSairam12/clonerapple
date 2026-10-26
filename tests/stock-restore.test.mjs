import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { restoreableQuantity } from '../src/lib/checkout/stock-rules.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(path.join(here, '..', relative), 'utf8');

test('an order created before Phase 2 has no sale movement and restores nothing', () => {
  // Legacy paid order: the customer paid, but stock was never decremented on
  // the order, so a cancel, void or return must not add stock.
  assert.equal(restoreableQuantity(3, 0, 0), 0);
});

test('a restore is capped at what the order still holds', () => {
  assert.equal(restoreableQuantity(5, 5, 0), 5);
  assert.equal(restoreableQuantity(9, 5, 0), 5, 'cannot put back more than was taken');
  assert.equal(restoreableQuantity(5, 5, 2), 3, 'partial return leaves three units');
  assert.equal(restoreableQuantity(5, 5, 5), 0, 'a second receive is a no-op');
  assert.equal(restoreableQuantity(1, 5, 0), 1);
});

test('invalid quantities never invent stock', () => {
  assert.equal(restoreableQuantity(0, 5, 0), 0);
  assert.equal(restoreableQuantity(-2, 5, 0), 0);
  assert.equal(restoreableQuantity(1.9, 5, 0), 1);
  assert.equal(restoreableQuantity('abc', 5, 0), 0);
  assert.equal(restoreableQuantity(2, 'abc', 0), 0);
  assert.equal(restoreableQuantity(2, 5, 'abc'), 2);
});

test('every order-linked restore path is ledger-guarded', () => {
  const stock = read('src/lib/payu/stock.ts');
  const returns = read('src/lib/store-admin/returns.ts');
  const pos = read('src/lib/store-admin/pos.ts');

  // Only stock.ts may add to on_hand for an order; the callers use the helper.
  assert.doesNotMatch(returns, /on_hand\s*=\s*on_hand\s*\+/);
  assert.doesNotMatch(pos, /on_hand\s*=\s*on_hand\s*\+/);
  assert.match(stock, /reason in \('return', 'release'\)/);
  assert.match(stock, /restoreableQuantity\(/);

  assert.match(returns, /restoreSoldStock\(/, 'return receiving restocks through the ledger');
  assert.match(pos, /restoreSoldStock\(/, 'POS void restocks through the ledger');

  // Cancelling a paid order never restocks: only an unpaid claim is released.
  assert.match(returns, /holdsUnpaidClaim/);
});

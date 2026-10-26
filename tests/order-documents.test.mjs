import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const { orderTotals } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'order-documents.ts'),
);

function order(overrides = {}) {
  return {
    items: [
      { lineTotalPaise: 3000 },
      { lineTotalPaise: 2000 },
    ],
    subtotalPaise: 0,
    discountPaise: 0,
    shippingPaise: 0,
    totalPaise: 0,
    amount: 50,
    paymentStatus: 'PAID',
    ...overrides,
  };
}

test('legacy web orders fall back to item lines and the amount column', () => {
  const totals = orderTotals(order());
  assert.equal(totals.subtotalPaise, 5000);
  assert.equal(totals.totalPaise, 5000);
  assert.equal(totals.balancePaise, 0);
  assert.equal(totals.paid, true);
});

test('discount and shipping are passed through when stored', () => {
  const totals = orderTotals(
    order({ subtotalPaise: 10000, discountPaise: 1500, shippingPaise: 990, totalPaise: 9490 }),
  );
  assert.equal(totals.subtotalPaise, 10000);
  assert.equal(totals.discountPaise, 1500);
  assert.equal(totals.shippingPaise, 990);
  assert.equal(totals.totalPaise, 9490);
});

test('a stored total wins over the legacy amount column', () => {
  const totals = orderTotals(
    order({ subtotalPaise: 10000, discountPaise: 0, shippingPaise: 0, totalPaise: 8800, amount: 100 }),
  );
  assert.equal(totals.totalPaise, 8800);
});

test('an unpaid order carries the balance due', () => {
  const totals = orderTotals(order({ totalPaise: 5000, paymentStatus: 'PENDING' }));
  assert.equal(totals.paid, false);
  assert.equal(totals.balancePaise, 5000);
});

test('a discount can never exceed the subtotal', () => {
  const totals = orderTotals(order({ subtotalPaise: 3000, discountPaise: 9000, totalPaise: 0 }));
  assert.equal(totals.discountPaise, 3000);
});

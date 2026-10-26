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

const {
  canTransitionReturn,
  cancellationAllowed,
  checkRefund,
  checkReturnLines,
  isReturnOpen,
  restockEligible,
  returnableQuantity,
  validateRefundReference,
  validateReturnReason,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'return-rules.ts'));

/* -------------------------------------------------------- transitions */

test('a return only moves forward through its workflow', () => {
  assert.equal(canTransitionReturn('REQUESTED', 'APPROVED'), true);
  assert.equal(canTransitionReturn('REQUESTED', 'REJECTED'), true);
  assert.equal(canTransitionReturn('REQUESTED', 'RECEIVED'), false);
  assert.equal(canTransitionReturn('REQUESTED', 'REFUNDED'), false);
  assert.equal(canTransitionReturn('APPROVED', 'RECEIVED'), true);
  assert.equal(canTransitionReturn('APPROVED', 'REFUNDED'), false);
  assert.equal(canTransitionReturn('RECEIVED', 'REFUNDED'), true);
});

test('terminal return states never move again', () => {
  for (const terminal of ['REFUNDED', 'REJECTED', 'CANCELLED']) {
    for (const target of ['REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'CANCELLED']) {
      assert.equal(canTransitionReturn(terminal, target), false, `${terminal} → ${target}`);
    }
  }
});

test('open returns are the ones still waiting on staff', () => {
  assert.equal(isReturnOpen('REQUESTED'), true);
  assert.equal(isReturnOpen('APPROVED'), true);
  assert.equal(isReturnOpen('RECEIVED'), true);
  assert.equal(isReturnOpen('REFUNDED'), false);
  assert.equal(isReturnOpen('REJECTED'), false);
  assert.equal(isReturnOpen('CANCELLED'), false);
});

/* ------------------------------------------------------------- refunds */

test('a partial refund leaves the rest of the capture available', () => {
  const check = checkRefund({ amountPaise: 30000, capturedPaise: 100000, refundedPaise: 0 });
  assert.deepEqual(check, { ok: true, remainingPaise: 70000 });
});

test('the last refund can exactly empty the capture', () => {
  const check = checkRefund({ amountPaise: 70000, capturedPaise: 100000, refundedPaise: 30000 });
  assert.deepEqual(check, { ok: true, remainingPaise: 0 });
});

test('refunds can never exceed what was captured', () => {
  const check = checkRefund({ amountPaise: 70001, capturedPaise: 100000, refundedPaise: 30000 });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'refund-exceeds-captured');
  assert.match(check.error, /₹700\.00 is left/);
});

test('a second refund cannot spend money the first one already returned', () => {
  const check = checkRefund({ amountPaise: 60000, capturedPaise: 100000, refundedPaise: 50000 });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'refund-exceeds-captured');
});

test('an order with no capture cannot be refunded at all', () => {
  const check = checkRefund({ amountPaise: 100, capturedPaise: 0, refundedPaise: 0 });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'refund-exceeds-captured');
  assert.match(check.error, /nothing to refund/);
});

test('refund amounts must be whole paise above zero', () => {
  for (const amountPaise of [0, -100, 12.5]) {
    const check = checkRefund({ amountPaise, capturedPaise: 100000, refundedPaise: 0 });
    assert.equal(check.ok, false, String(amountPaise));
    assert.equal(check.code, 'invalid-amount');
  }
});

test('UPI and bank refunds need a reference, the rest do not', () => {
  assert.equal(validateRefundReference('upi', '  '), null);
  assert.equal(validateRefundReference('bank_transfer', ''), null);
  assert.equal(validateRefundReference('upi', ' UTR12345 '), 'UTR12345');
  assert.equal(validateRefundReference('cash', ''), null);
  assert.equal(validateRefundReference('card_machine', undefined), null);
});

/* ------------------------------------------------------------- restock */

test('only resellable and opened goods go back on the shelf', () => {
  assert.equal(restockEligible('RESELLABLE', true), true);
  assert.equal(restockEligible('OPENED', true), true);
  assert.equal(restockEligible('DAMAGED', true), false);
  assert.equal(restockEligible('DEFECTIVE', true), false);
  assert.equal(restockEligible('RESELLABLE', false), false);
});

/* ------------------------------------------------------------ line math */

test('returnable quantity is what is left after earlier returns', () => {
  assert.equal(returnableQuantity(3, 1), 2);
  assert.equal(returnableQuantity(2, 2), 0);
  assert.equal(returnableQuantity(1, 5), 0);
  assert.equal(returnableQuantity(-1, 0), 0);
});

const prices = new Map([
  [11, 499900],
  [12, 129900],
]);
const unitPrice = (id) => prices.get(id) ?? 0;

test('a valid return computes the value of the goods coming back', () => {
  const check = checkReturnLines(
    [
      { orderItemId: 11, quantity: 1, purchased: 2, alreadyReturned: 0 },
      { orderItemId: 12, quantity: 2, purchased: 2, alreadyReturned: 0 },
    ],
    unitPrice,
  );
  assert.deepEqual(check, { ok: true, expectedPaise: 499900 + 2 * 129900 });
});

test('a line cannot return more than was bought', () => {
  const check = checkReturnLines(
    [{ orderItemId: 12, quantity: 2, purchased: 2, alreadyReturned: 1 }],
    unitPrice,
  );
  assert.equal(check.ok, false);
  assert.equal(check.code, 'quantity-exceeds-purchased');
  assert.match(check.error, /Only 1/);
});

test('a line already returned in full is refused', () => {
  const check = checkReturnLines(
    [{ orderItemId: 11, quantity: 1, purchased: 1, alreadyReturned: 1 }],
    unitPrice,
  );
  assert.equal(check.ok, false);
  assert.match(check.error, /already been returned in full/);
});

test('duplicate and zero-quantity lines are rejected', () => {
  const duplicate = checkReturnLines(
    [
      { orderItemId: 11, quantity: 1, purchased: 2, alreadyReturned: 0 },
      { orderItemId: 11, quantity: 1, purchased: 2, alreadyReturned: 0 },
    ],
    unitPrice,
  );
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'invalid-input');

  const zero = checkReturnLines(
    [{ orderItemId: 11, quantity: 0, purchased: 2, alreadyReturned: 0 }],
    unitPrice,
  );
  assert.equal(zero.ok, false);
  assert.equal(zero.code, 'invalid-input');

  const empty = checkReturnLines([], unitPrice);
  assert.equal(empty.ok, false);
});

test('the reason is trimmed and bounded', () => {
  assert.equal(validateReturnReason('  damaged  '), 'damaged');
  assert.equal(validateReturnReason('  ab  '), null);
  assert.equal(validateReturnReason('x'.repeat(301)), null);
  assert.equal(validateReturnReason(undefined), null);
});

/* ------------------------------------------------------- cancellation */

test('a delivered order is not cancellable — it takes a return', () => {
  const allowed = cancellationAllowed({ paymentStatus: 'PAID', fulfilmentStatus: 'DELIVERED' });
  assert.equal(allowed.ok, false);
  assert.equal(allowed.code, 'already-delivered');
});

test('an order already cancelled cannot be cancelled twice', () => {
  assert.equal(
    cancellationAllowed({ paymentStatus: 'PAID', fulfilmentStatus: 'CANCELED' }).code,
    'already-cancelled',
  );
  assert.equal(
    cancellationAllowed({ paymentStatus: 'CANCELLED', fulfilmentStatus: 'PENDING' }).code,
    'already-cancelled',
  );
});

test('an in-flight order can be cancelled by staff', () => {
  assert.deepEqual(cancellationAllowed({ paymentStatus: 'PAID', fulfilmentStatus: 'PROCESSING' }), {
    ok: true,
  });
  assert.deepEqual(cancellationAllowed({ paymentStatus: 'PENDING', fulfilmentStatus: 'ACCEPTED' }), {
    ok: true,
  });
});

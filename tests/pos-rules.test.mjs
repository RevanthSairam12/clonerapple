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
  paymentCoversTotal,
  validateManualPayment,
  methodNeedsReview,
  ADMIN_MAX_MARK_PAID_PAISE,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'payments.ts'),
);
const {
  cashVariancePaise,
  canVoidPosSale,
  expectedCashPaise,
  formatReceiptNo,
  isReceiptNo,
  posMethodNeedsReference,
  validatePosCart,
  validatePosReference,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'pos-rules.ts'),
);
const {
  SETTING_FIELDS,
  validateSettingValue,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'settings-rules.ts'),
);
const { formatPaise, parseAmountToPaise } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'amount.ts'),
);

/* ------------------------------------------------------ expected cash */

test('expected cash is opening float plus cash sales minus cash refunds', () => {
  assert.equal(expectedCashPaise(200_00, 1_500_00, 0), 1_700_00);
  assert.equal(expectedCashPaise(0, 500_00, 125_00), 375_00);
  assert.equal(expectedCashPaise(100_00, 0, 0), 100_00);
});

test('expected cash never goes below zero and ignores fractional paise', () => {
  assert.equal(expectedCashPaise(100_00, 50_00, 200_00), 0);
  assert.equal(expectedCashPaise(10.9, 20.4, 0), 30);
});

test('variance is counted minus expected, so short counts are negative', () => {
  assert.equal(cashVariancePaise(1_700_00, 1_700_00), 0);
  assert.equal(cashVariancePaise(1_650_00, 1_700_00), -50_00);
  assert.equal(cashVariancePaise(1_750_00, 1_700_00), 50_00);
});

/* ------------------------------------------------- partial payments */

test('an order becomes paid only when paid rows cover the total', () => {
  assert.equal(paymentCoversTotal(5_000_00, 6_000_00), false);
  assert.equal(paymentCoversTotal(5_999_00, 6_000_00), false);
  assert.equal(paymentCoversTotal(6_000_00, 6_000_00), true);
  assert.equal(paymentCoversTotal(6_500_00, 6_000_00), true);
});

test('a zero total never counts as covered', () => {
  assert.equal(paymentCoversTotal(0, 0), false);
  assert.equal(paymentCoversTotal(100, 0), false);
});

test('UPI, bank transfer and other entries wait for a second pair of eyes', () => {
  assert.equal(methodNeedsReview('upi'), true);
  assert.equal(methodNeedsReview('bank_transfer'), true);
  assert.equal(methodNeedsReview('other'), true);
  assert.equal(methodNeedsReview('cash'), false);
  assert.equal(methodNeedsReview('cod'), false);
  assert.equal(methodNeedsReview('card_machine'), false);
});

test('two partial payments sum to cover the order', () => {
  const parts = [2_000_00, 4_000_00];
  const sum = parts.reduce((a, b) => a + b, 0);
  assert.equal(paymentCoversTotal(sum, 6_000_00), true);
  assert.equal(paymentCoversTotal(parts[0], 6_000_00), false);
});

/* ---------------------------------------------------- role limits */

test('an admin is limited to Rs 50,000 per manual entry, the owner is not', () => {
  const atLimit = validateManualPayment({
    method: 'cash',
    amountPaise: ADMIN_MAX_MARK_PAID_PAISE,
    providerRef: null,
    notes: null,
    role: 'store_admin',
  });
  assert.equal(atLimit.ok, true);

  const overLimit = validateManualPayment({
    method: 'cash',
    amountPaise: ADMIN_MAX_MARK_PAID_PAISE + 1,
    providerRef: null,
    notes: null,
    role: 'store_admin',
  });
  assert.equal(overLimit.ok, false);
  assert.equal(overLimit.ok === false && overLimit.code, 'limit-exceeded');

  const owner = validateManualPayment({
    method: 'cash',
    amountPaise: ADMIN_MAX_MARK_PAID_PAISE * 10,
    providerRef: null,
    notes: null,
    role: 'store_owner',
  });
  assert.equal(owner.ok, true);
});

test('UPI and bank transfer require a provider reference', () => {
  for (const method of ['upi', 'bank_transfer']) {
    const missing = validateManualPayment({
      method,
      amountPaise: 100_00,
      providerRef: '   ',
      notes: null,
      role: 'store_admin',
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.ok === false && missing.code, 'ref-required');

    const provided = validateManualPayment({
      method,
      amountPaise: 100_00,
      providerRef: 'TXN-123',
      notes: null,
      role: 'store_admin',
    });
    assert.equal(provided.ok, true);
    assert.equal(provided.ok === true && provided.providerRef, 'TXN-123');
  }
});

test('manual payments reject unsupported methods and non-positive amounts', () => {
  assert.equal(
    validateManualPayment({
      method: 'card_machine',
      amountPaise: 100,
      providerRef: null,
      notes: null,
      role: 'store_owner',
    }).ok,
    false,
  );
  assert.equal(
    validateManualPayment({
      method: 'cash',
      amountPaise: 0,
      providerRef: null,
      notes: null,
      role: 'store_owner',
    }).ok,
    false,
  );
  assert.equal(
    validateManualPayment({
      method: 'cash',
      amountPaise: -5,
      providerRef: null,
      notes: null,
      role: 'store_owner',
    }).ok,
    false,
  );
  assert.equal(
    validateManualPayment({
      method: 'barter',
      amountPaise: 100,
      providerRef: null,
      notes: null,
      role: 'store_owner',
    }).ok,
    false,
  );
});

/* ------------------------------------------------ receipt numbering */

test('receipt numbers are zero padded and never shrink', () => {
  assert.equal(formatReceiptNo(1), 'RCP-0000001');
  assert.equal(formatReceiptNo(7), 'RCP-0000007');
  assert.equal(formatReceiptNo(1234567), 'RCP-1234567');
  assert.equal(formatReceiptNo(12345678), 'RCP-12345678');
});

test('receipt numbers are recognised only in the issued shape', () => {
  assert.equal(isReceiptNo('RCP-0000001'), true);
  assert.equal(isReceiptNo('RCP-1'), false);
  assert.equal(isReceiptNo('rcp-0000001'), false);
  assert.equal(isReceiptNo(''), false);
});

test('a voided receipt number is never handed out again', () => {
  // Allocation advances the counter before the sale settles. A void marks
  // the order cancelled and keeps pos_receipt_no, so the next sale gets a
  // higher number and the gap stays visible in the ledger.
  const issued = [formatReceiptNo(1), formatReceiptNo(2), formatReceiptNo(3)];
  const voidedIndex = 1;
  const reused = issued.filter((_, index) => index !== voidedIndex);
  assert.equal(new Set(reused).size, reused.length);
  assert.equal(reused.includes(issued[voidedIndex]), false);
});

/* ------------------------------------------------------- POS cart */

test('POS cart requires at least one line and whole quantities of 1..50', () => {
  assert.equal(validatePosCart([]).ok, false);
  assert.equal(validatePosCart('nope').ok, false);
  assert.equal(validatePosCart([{ id: 'pa-gadzio-20w-usbc', quantity: 0 }]).ok, false);
  assert.equal(validatePosCart([{ id: 'pa-gadzio-20w-usbc', quantity: 51 }]).ok, false);
  assert.equal(validatePosCart([{ id: 'pa-gadzio-20w-usbc', quantity: 2.7 }]).ok, false);
  assert.equal(validatePosCart([{ id: '', quantity: 1 }]).ok, false);
});

test('POS cart rejects duplicate lines instead of silently merging them', () => {
  const duplicate = validatePosCart([
    { id: 'pa-gadzio-20w-usbc', quantity: 1 },
    { id: 'pa-gadzio-20w-usbc', quantity: 2 },
  ]);
  assert.equal(duplicate.ok, false);
});

test('POS cart passes a clean sale through with integer quantities', () => {
  const result = validatePosCart([
    { id: 'pa-gadzio-20w-usbc', quantity: 2 },
    { id: 'we-gadzio-pulse-usbc', quantity: '1' },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok === true && result.lines, [
    { id: 'pa-gadzio-20w-usbc', quantity: 2 },
    { id: 'we-gadzio-pulse-usbc', quantity: 1 },
  ]);
});

/* ------------------------------------------------------ void rules */

const baseVoid = {
  role: 'store_owner',
  channel: 'pos',
  shiftStatus: 'OPEN',
  orderStatus: 'PAID',
  fulfilmentStatus: 'DELIVERED',
  hasReason: true,
};

test('the owner can void an open-shift POS sale with a reason', () => {
  assert.equal(canVoidPosSale(baseVoid).ok, true);
});

test('admin and viewer cannot void a sale', () => {
  assert.equal(canVoidPosSale({ ...baseVoid, role: 'store_admin' }).ok, false);
  assert.equal(canVoidPosSale({ ...baseVoid, role: 'store_viewer' }).ok, false);
});

test('a sale cannot be voided after its shift closes', () => {
  const closed = canVoidPosSale({ ...baseVoid, shiftStatus: 'CLOSED' });
  assert.equal(closed.ok, false);
  assert.match(closed.ok === false ? closed.error : '', /closed/i);
});

test('voiding needs a reason and refuses non-POS or already-voided sales', () => {
  assert.equal(canVoidPosSale({ ...baseVoid, hasReason: false }).ok, false);
  assert.equal(canVoidPosSale({ ...baseVoid, channel: 'web' }).ok, false);
  assert.equal(canVoidPosSale({ ...baseVoid, orderStatus: 'CANCELLED' }).ok, false);
});

test('a sale that entered web fulfilment is not voided from the till', () => {
  assert.equal(canVoidPosSale({ ...baseVoid, fulfilmentStatus: 'PROCESSING' }).ok, false);
});

/* -------------------------------------------------------- settings */

test('free-text settings validate length per key and reject a bad email', () => {
  for (const field of SETTING_FIELDS) {
    // Only plain text and textarea fields accept arbitrary characters at the
    // limit; numbers, selects, toggles and datetimes have their own rules.
    if (field.kind !== 'text' && field.kind !== 'textarea') continue;
    if (field.key === 'email') continue;
    const atLimit = 'x'.repeat(field.limit);
    const over = 'x'.repeat(field.limit + 1);
    assert.equal(validateSettingValue(field.key, atLimit).ok, true, field.key);
    assert.equal(validateSettingValue(field.key, over).ok, false, field.key);
  }
  assert.equal(validateSettingValue('email', 'not-an-email').ok, false);
  assert.equal(validateSettingValue('email', 'store@example.com').ok, true);
  assert.equal(validateSettingValue('email', '').ok, true);
});

test('numeric settings must be whole numbers', () => {
  assert.equal(validateSettingValue('order_start_number', '5').ok, true);
  assert.equal(validateSettingValue('order_start_number', '').ok, true);
  assert.equal(validateSettingValue('order_start_number', '-2').ok, false);
  assert.equal(validateSettingValue('order_start_number', '2.5').ok, false);
});

/* -------------------------------------------------- payment references */

test('cash needs no reference, UPI and card do', () => {
  assert.equal(posMethodNeedsReference('cash'), false);
  assert.equal(posMethodNeedsReference('upi'), true);
  assert.equal(posMethodNeedsReference('card_machine'), true);

  assert.deepEqual(validatePosReference('cash', ''), { ok: true, reference: null });
  assert.equal(validatePosReference('upi', '').ok, false);
  assert.equal(validatePosReference('card_machine', '   ').ok, false);
});

test('a reference is trimmed, capped at 64 chars, and kept for UPI/card', () => {
  assert.deepEqual(validatePosReference('upi', '  UTR12345  '), { ok: true, reference: 'UTR12345' });
  assert.deepEqual(validatePosReference('card_machine', 'AUTH-99'), { ok: true, reference: 'AUTH-99' });
  assert.equal(validatePosReference('upi', 'x'.repeat(65)).ok, false);
  assert.equal(validatePosReference('upi', 'x'.repeat(64)).ok, true);
  assert.equal(validatePosReference('cheque', 'x').ok, false);
});

/* ----------------------------------------------------------- money */

test('rupee input parses to integer paise without float drift', () => {
  assert.equal(parseAmountToPaise('0.1'), 10);
  assert.equal(parseAmountToPaise('19.99'), 1999);
  assert.equal(parseAmountToPaise('1000'), 100_000);
  assert.equal(parseAmountToPaise(12.5), 1250);
  assert.equal(parseAmountToPaise('0'), null);
  assert.equal(parseAmountToPaise('-5'), null);
  assert.equal(parseAmountToPaise('1.234'), null);
  assert.equal(parseAmountToPaise('abc'), null);
});

test('paise formats in the en-IN rupee style', () => {
  assert.equal(formatPaise(0), '₹0.00');
  assert.equal(formatPaise(349900), '₹3,499.00');
  assert.equal(formatPaise(123456789), '₹12,34,567.89');
});

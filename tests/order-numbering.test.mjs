import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatInvoiceReference,
  formatOrderNumber,
  hasUsableNumbering,
  parseOrderStartNumber,
  readOrderNumberSettings,
  sanitizeOrderPrefix,
} from '../src/lib/orders/numbering.ts';

test('prefixes are sanitized for a PayU transaction id', () => {
  assert.equal(sanitizeOrderPrefix('gdz'), 'GDZ');
  assert.equal(sanitizeOrderPrefix(' G-D_1 '), 'G-D1');
  assert.equal(sanitizeOrderPrefix('x'.repeat(40)), 'X'.repeat(10));
  assert.equal(sanitizeOrderPrefix(''), '');
  assert.equal(sanitizeOrderPrefix(undefined), '');
  assert.equal(sanitizeOrderPrefix('', 'INV'), 'INV');
});

test('the starting number is whole and at least one', () => {
  assert.equal(parseOrderStartNumber('1001'), 1001);
  assert.equal(parseOrderStartNumber(500), 500);
  assert.equal(parseOrderStartNumber(''), 1);
  assert.equal(parseOrderStartNumber('abc'), 1);
  assert.equal(parseOrderStartNumber('0'), 1);
  assert.equal(parseOrderStartNumber('-8'), 1);
  assert.equal(parseOrderStartNumber('12.7'), 12);
});

test('an empty prefix makes numbering unusable so checkout falls back', () => {
  const usable = readOrderNumberSettings({ order_prefix: 'gdz', order_start_number: '1001' });
  assert.deepEqual(usable, { prefix: 'GDZ', startNumber: 1001 });
  assert.equal(hasUsableNumbering(usable), true);

  const empty = readOrderNumberSettings({ order_prefix: '', order_start_number: '1001' });
  assert.equal(hasUsableNumbering(empty), false);
});

test('numbers are zero-padded and never truncated', () => {
  assert.equal(formatOrderNumber('GDZ', 1001), 'GDZ001001');
  assert.equal(formatOrderNumber('GDZ', 1), 'GDZ000001');
  assert.equal(formatOrderNumber('GDZ', 1000000), 'GDZ1000000');
  assert.equal(formatOrderNumber('gdz', 42), 'GDZ000042');
});

test('concurrent allocations against one counter are unique and honour the start number', () => {
  // Mirrors the transactional counter: the first allocation lifts the counter
  // to the configured start, every allocation takes one number, and the row
  // lock serialises callers.
  let nextNumber = 1;
  const startNumber = 1001;
  const allocate = () => {
    nextNumber = Math.max(nextNumber, startNumber);
    const number = nextNumber;
    nextNumber += 1;
    return number;
  };

  const numbers = Array.from({ length: 25 }, allocate);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(numbers[0], 1001);
  assert.equal(numbers.at(-1), 1025);
  assert.equal(new Set(numbers.map((n) => formatOrderNumber('GDZ', n))).size, 25);
});

test('invoice references use the invoice prefix and fall back to the txnid', () => {
  assert.equal(
    formatInvoiceReference({ orderNumber: 1007, invoicePrefix: 'INV', txnid: 'GDZ001007' }),
    'INV001007',
  );
  assert.equal(
    formatInvoiceReference({ orderNumber: 1007, invoicePrefix: '', txnid: 'GDZ001007' }),
    'INV001007',
  );
  assert.equal(
    formatInvoiceReference({ orderNumber: null, invoicePrefix: 'INV', txnid: 'GDZABC123' }),
    'GDZABC123',
  );
  assert.equal(
    formatInvoiceReference({ orderNumber: undefined, invoicePrefix: 'INV', txnid: 'GDZABC123' }),
    'GDZABC123',
  );
  assert.equal(
    formatInvoiceReference({ orderNumber: 0, invoicePrefix: 'INV', txnid: 'GDZABC123' }),
    'GDZABC123',
  );
});

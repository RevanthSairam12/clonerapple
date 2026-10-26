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
  EXPENSE_AMOUNT_MAX_PAISE,
  EXPENSE_CATEGORY_NAME_MAX,
  EXPENSE_NOTE_MAX,
  EXPENSE_TITLE_MAX,
  validateExpenseAmount,
  validateExpenseCategoryName,
  validateExpenseNote,
  validateExpenseTitle,
  validateSpentOn,
} = await jiti.import('../src/lib/store-admin/expense-rules.ts');

const TODAY = new Date('2026-10-24T13:45:00.000Z');

test('a title is required and trimmed', () => {
  assert.deepEqual(validateExpenseTitle('  October rent  '), {
    ok: true,
    value: 'October rent',
  });
  assert.equal(validateExpenseTitle('').ok, false);
  assert.equal(validateExpenseTitle('   ').ok, false);
  assert.equal(validateExpenseTitle(null).ok, false);
  assert.equal(validateExpenseTitle('x'.repeat(EXPENSE_TITLE_MAX)).ok, true);
  assert.equal(validateExpenseTitle('x'.repeat(EXPENSE_TITLE_MAX + 1)).ok, false);
});

test('amounts are rupees in, integer paise out', () => {
  assert.deepEqual(validateExpenseAmount('12500.50'), { ok: true, value: 1250050 });
  assert.deepEqual(validateExpenseAmount('349'), { ok: true, value: 34900 });
  assert.deepEqual(validateExpenseAmount(0.01), { ok: true, value: 1 });

  assert.equal(validateExpenseAmount('0').ok, false);
  assert.equal(validateExpenseAmount(0).ok, false);
  assert.equal(validateExpenseAmount('-40').ok, false);
  assert.equal(validateExpenseAmount('10.999').ok, false);
  assert.equal(validateExpenseAmount('abc').ok, false);
  assert.equal(validateExpenseAmount(null).ok, false);
  assert.equal(
    validateExpenseAmount((EXPENSE_AMOUNT_MAX_PAISE / 100).toString()).ok,
    true,
  );
  assert.equal(
    validateExpenseAmount((EXPENSE_AMOUNT_MAX_PAISE / 100 + 1).toString()).ok,
    false,
  );
});

test('the spend date must be a real day and never in the future', () => {
  assert.deepEqual(validateSpentOn('2026-10-24', TODAY), { ok: true, value: '2026-10-24' });
  assert.deepEqual(validateSpentOn('2026-10-01', TODAY), { ok: true, value: '2026-10-01' });

  assert.equal(validateSpentOn('2026-10-25', TODAY).ok, false);
  assert.equal(validateSpentOn('2026-02-30', TODAY).ok, false);
  assert.equal(validateSpentOn('24/10/2026', TODAY).ok, false);
  assert.equal(validateSpentOn('', TODAY).ok, false);
  assert.equal(validateSpentOn(null, TODAY).ok, false);
});

test('the note is optional and capped', () => {
  assert.deepEqual(validateExpenseNote(undefined), { ok: true, value: '' });
  assert.deepEqual(validateExpenseNote(null), { ok: true, value: '' });
  assert.deepEqual(validateExpenseNote('  paid by UPI '), { ok: true, value: 'paid by UPI' });
  assert.equal(validateExpenseNote(42).ok, false);
  assert.equal(validateExpenseNote('x'.repeat(EXPENSE_NOTE_MAX)).ok, true);
  assert.equal(validateExpenseNote('x'.repeat(EXPENSE_NOTE_MAX + 1)).ok, false);
});

test('category names are required and capped', () => {
  assert.deepEqual(validateExpenseCategoryName('  Courier charges '), {
    ok: true,
    value: 'Courier charges',
  });
  assert.equal(validateExpenseCategoryName('').ok, false);
  assert.equal(validateExpenseCategoryName('x'.repeat(EXPENSE_CATEGORY_NAME_MAX)).ok, true);
  assert.equal(
    validateExpenseCategoryName('x'.repeat(EXPENSE_CATEGORY_NAME_MAX + 1)).ok,
    false,
  );
});

/** Expense ledger validation. Pure — the queries live in `expenses.ts`. */

import { parseAmountToPaise } from './amount';
import { parseIsoDay } from './customer-rules';

export const EXPENSE_TITLE_MAX = 160;
export const EXPENSE_NOTE_MAX = 1000;
export const EXPENSE_CATEGORY_NAME_MAX = 80;
/** ₹10,00,00,000 — well above any single shop expense. */
export const EXPENSE_AMOUNT_MAX_PAISE = 100_000_000_00;

export type ExpenseValidation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateExpenseTitle(value: unknown): ExpenseValidation<string> {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length < 1) return { ok: false, error: 'Give the expense a title.' };
  if (title.length > EXPENSE_TITLE_MAX) {
    return { ok: false, error: `Keep the title under ${EXPENSE_TITLE_MAX} characters.` };
  }
  return { ok: true, value: title };
}

/** Accepts rupees (number or decimal string) and returns integer paise. */
export function validateExpenseAmount(value: unknown): ExpenseValidation<number> {
  const paise = parseAmountToPaise(value);
  if (paise === null) {
    return { ok: false, error: 'Enter an amount greater than zero, with at most two decimals.' };
  }
  if (paise > EXPENSE_AMOUNT_MAX_PAISE) {
    return { ok: false, error: 'That amount is larger than this ledger accepts.' };
  }
  return { ok: true, value: paise };
}

/** `YYYY-MM-DD`, not in the future. Returns the normalised day string. */
export function validateSpentOn(
  value: unknown,
  today: Date = new Date(),
): ExpenseValidation<string> {
  const day = typeof value === 'string' ? value.trim() : '';
  const parsed = parseIsoDay(day);
  if (!parsed) return { ok: false, error: 'Choose a valid expense date.' };

  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (parsed.getTime() > todayUtc.getTime()) {
    return { ok: false, error: 'The expense date cannot be in the future.' };
  }
  return { ok: true, value: parsed.toISOString().slice(0, 10) };
}

export function validateExpenseNote(value: unknown): ExpenseValidation<string> {
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, error: 'The note must be text.' };
  const note = value.trim();
  if (note.length > EXPENSE_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${EXPENSE_NOTE_MAX} characters.` };
  }
  return { ok: true, value: note };
}

export function validateExpenseCategoryName(value: unknown): ExpenseValidation<string> {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1) return { ok: false, error: 'Give the category a name.' };
  if (name.length > EXPENSE_CATEGORY_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${EXPENSE_CATEGORY_NAME_MAX} characters.` };
  }
  return { ok: true, value: name };
}

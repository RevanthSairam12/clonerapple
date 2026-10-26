import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

import {
  validateExpenseAmount,
  validateExpenseCategoryName,
  validateExpenseNote,
  validateExpenseTitle,
  validateSpentOn,
} from './expense-rules';

/**
 * Manual expense ledger.
 *
 * Rows are soft-deleted: a removal stamps `deleted_at` and the audit row keeps
 * pointing at a real entry. Nothing here touches order or payment money — an
 * expense is a cost the shop paid, recorded by staff.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Expenses must be read and written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const EXPENSES_PAGE_SIZE = 50;

export type ExpenseLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-input' | 'conflict' };

export interface ExpenseCategory {
  id: string;
  name: string;
  isActive: boolean;
}

export async function listExpenseCategories(): Promise<ExpenseLoad<ExpenseCategory[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select id, name, is_active
      from expense_categories
      order by is_active desc, name asc
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        name: text(row.name),
        isActive: row.is_active === true || text(row.is_active) === 'true',
      })),
    };
  } catch {
    console.warn('[store-admin/expenses] could not read expense categories');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface ExpenseSummary {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string;
  amountPaise: number;
  spentOn: string;
  note: string;
  attachmentId: string | null;
  attachmentUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseListData {
  expenses: ExpenseSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  totalPaise: number;
  categoryId: string | null;
}

const EXPENSE_COLUMNS = `
  e.id, e.title, e.category_id, c.name as category_name, e.amount_paise,
  e.spent_on, e.note, e.attachment_media_id, m.url as attachment_url,
  e.created_at, e.updated_at
`;

function expenseFromRow(row: Row): ExpenseSummary {
  return {
    id: text(row.id),
    title: text(row.title),
    categoryId: nullableText(row.category_id),
    categoryName: text(row.category_name) || 'Uncategorised',
    amountPaise: number(row.amount_paise),
    spentOn: iso(row.spent_on).slice(0, 10),
    note: text(row.note),
    attachmentId: nullableText(row.attachment_media_id),
    attachmentUrl: nullableText(row.attachment_url),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listExpenses(options: {
  fromDay: string;
  toDay: string;
  categoryId?: string | null;
  page?: number;
}): Promise<ExpenseLoad<ExpenseListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const offset = (requestedPage - 1) * EXPENSES_PAGE_SIZE;
  const categoryId = options.categoryId ?? null;

  try {
    const rows = (await sql`
      select ${sql.unsafe(EXPENSE_COLUMNS)}, count(*) over() as total
      from expenses e
      left join expense_categories c on c.id = e.category_id
      left join store_media m on m.id = e.attachment_media_id and m.deleted_at is null
      where e.deleted_at is null
        and e.spent_on >= ${options.fromDay}::date
        and e.spent_on <= ${options.toDay}::date
        and (${categoryId}::text is null or e.category_id = ${categoryId})
      order by e.spent_on desc, e.id desc
      limit ${EXPENSES_PAGE_SIZE} offset ${offset}
    `) as Row[];

    const sumRows = (await sql`
      select count(*)::int as count, coalesce(sum(e.amount_paise), 0)::bigint as total_paise
      from expenses e
      where e.deleted_at is null
        and e.spent_on >= ${options.fromDay}::date
        and e.spent_on <= ${options.toDay}::date
        and (${categoryId}::text is null or e.category_id = ${categoryId})
    `) as Row[];
    const summary = sumRows[0] ?? {};

    const total = rows.length > 0 ? number(rows[0].total) : 0;
    const totalPaise = number(summary.total_paise);
    const pageCount = Math.max(1, Math.ceil(total / EXPENSES_PAGE_SIZE));

    return {
      ok: true,
      data: {
        expenses: rows.map(expenseFromRow),
        total,
        page: Math.min(requestedPage, pageCount),
        pageCount,
        pageSize: EXPENSES_PAGE_SIZE,
        totalPaise,
        categoryId,
      },
    };
  } catch {
    console.warn('[store-admin/expenses] could not read the expense ledger');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getExpense(id: string): Promise<ExpenseLoad<ExpenseSummary>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select ${sql.unsafe(EXPENSE_COLUMNS)}
      from expenses e
      left join expense_categories c on c.id = e.category_id
      left join store_media m on m.id = e.attachment_media_id and m.deleted_at is null
      where e.id = ${id.trim()} and e.deleted_at is null
      limit 1
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'not-found' };
    return { ok: true, data: expenseFromRow(rows[0]) };
  } catch {
    console.warn('[store-admin/expenses] could not read an expense');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface ExpenseInput {
  title: unknown;
  amount: unknown;
  spentOn: unknown;
  categoryId?: unknown;
  note?: unknown;
  attachmentMediaId?: unknown;
}

type ValidExpense = {
  title: string;
  amountPaise: number;
  spentOn: string;
  categoryId: string | null;
  note: string;
  attachmentMediaId: string | null;
};

function validateExpense(input: ExpenseInput, now = new Date()):
  | { ok: true; value: ValidExpense }
  | { ok: false; error: string } {
  const title = validateExpenseTitle(input.title);
  if (!title.ok) return title;
  const amount = validateExpenseAmount(input.amount);
  if (!amount.ok) return amount;
  const spentOn = validateSpentOn(input.spentOn, now);
  if (!spentOn.ok) return spentOn;
  const note = validateExpenseNote(input.note);
  if (!note.ok) return note;

  const rawCategory = typeof input.categoryId === 'string' ? input.categoryId.trim() : '';
  const rawAttachment =
    typeof input.attachmentMediaId === 'string' ? input.attachmentMediaId.trim() : '';

  return {
    ok: true,
    value: {
      title: title.value,
      amountPaise: amount.value,
      spentOn: spentOn.value,
      categoryId: rawCategory || null,
      note: note.value,
      attachmentMediaId: rawAttachment || null,
    },
  };
}

export async function createExpense(
  input: ExpenseInput,
  staffId: string,
): Promise<ExpenseLoad<ExpenseSummary>> {
  const validation = validateExpense(input);
  if (!validation.ok) return { ok: false, reason: 'invalid-input' };
  const value = validation.value;

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    if (value.categoryId) {
      const categories = (await sql`
        select 1 from expense_categories where id = ${value.categoryId} limit 1
      `) as Row[];
      if (!categories[0]) return { ok: false, reason: 'invalid-input' };
    }

    const id = `exp_${randomBytes(8).toString('hex')}`;
    const rows = (await sql`
      insert into expenses (
        id, category_id, title, amount_paise, spent_on, note,
        attachment_media_id, created_by, updated_by
      ) values (
        ${id}, ${value.categoryId}, ${value.title}, ${value.amountPaise},
        ${value.spentOn}::date, ${value.note}, ${value.attachmentMediaId},
        ${staffId}, ${staffId}
      )
      returning id
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'unavailable' };
    return getExpense(id);
  } catch {
    console.warn('[store-admin/expenses] could not create an expense');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function updateExpense(
  id: string,
  input: ExpenseInput,
  staffId: string,
): Promise<ExpenseLoad<{ before: ExpenseSummary; after: ExpenseSummary }>> {
  const validation = validateExpense(input);
  if (!validation.ok) return { ok: false, reason: 'invalid-input' };
  const value = validation.value;

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    return await sql.begin(async (tx) => {
      const beforeRows = (await tx`
        select e.id, e.title, e.category_id, c.name as category_name,
               e.amount_paise, e.spent_on, e.note, e.attachment_media_id,
               null::text as attachment_url, e.created_at, e.updated_at
        from expenses e
        left join expense_categories c on c.id = e.category_id
        where e.id = ${id.trim()} and e.deleted_at is null
        for update of e
      `) as Row[];
      const before = beforeRows[0];
      if (!before) return { ok: false as const, reason: 'not-found' as const };

      if (value.categoryId) {
        const categories = (await tx`
          select 1 from expense_categories where id = ${value.categoryId} limit 1
        `) as Row[];
        if (!categories[0]) {
          return { ok: false as const, reason: 'invalid-input' as const };
        }
      }

      await tx`
        update expenses
        set category_id = ${value.categoryId},
            title = ${value.title},
            amount_paise = ${value.amountPaise},
            spent_on = ${value.spentOn}::date,
            note = ${value.note},
            attachment_media_id = ${value.attachmentMediaId},
            updated_by = ${staffId},
            updated_at = now()
        where id = ${id.trim()}
      `;

      const afterRows = (await tx`
        select e.id, e.title, e.category_id, c.name as category_name,
               e.amount_paise, e.spent_on, e.note, e.attachment_media_id,
               m.url as attachment_url, e.created_at, e.updated_at
        from expenses e
        left join expense_categories c on c.id = e.category_id
        left join store_media m on m.id = e.attachment_media_id and m.deleted_at is null
        where e.id = ${id.trim()}
      `) as Row[];

      return {
        ok: true as const,
        data: { before: expenseFromRow(before), after: expenseFromRow(afterRows[0] ?? {}) },
      };
    });
  } catch {
    console.warn('[store-admin/expenses] could not update an expense');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function deleteExpense(
  id: string,
  staffId: string,
): Promise<ExpenseLoad<ExpenseSummary>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    // The category join must stay optional: an expense can have no category,
    // and an inner join here would silently refuse to delete it.
    const rows = (await sql`
      update expenses e
      set deleted_at = now(), updated_by = ${staffId}, updated_at = now()
      where e.id = ${id.trim()} and e.deleted_at is null
      returning e.id, e.title, e.category_id,
                (select c.name from expense_categories c where c.id = e.category_id) as category_name,
                e.amount_paise, e.spent_on, e.note, e.attachment_media_id,
                e.created_at, e.updated_at
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'not-found' };
    return { ok: true, data: expenseFromRow(rows[0]) };
  } catch {
    console.warn('[store-admin/expenses] could not remove an expense');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function createExpenseCategory(
  name: unknown,
  staffId: string,
): Promise<ExpenseLoad<ExpenseCategory>> {
  const validation = validateExpenseCategoryName(name);
  if (!validation.ok) return { ok: false, reason: 'invalid-input' };

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const existing = (await sql`
      select id from expense_categories where lower(name) = lower(${validation.value}) limit 1
    `) as Row[];
    if (existing[0]) return { ok: false, reason: 'conflict' };

    const id = `expcat_${randomBytes(6).toString('hex')}`;
    const rows = (await sql`
      insert into expense_categories (id, name, is_active, created_at, updated_at)
      values (${id}, ${validation.value}, true, now(), now())
      returning id, name, is_active
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'unavailable' };
    return {
      ok: true,
      data: {
        id: text(rows[0].id),
        name: text(rows[0].name),
        isActive: true,
      },
    };
  } catch {
    console.warn('[store-admin/expenses] could not create an expense category');
    return { ok: false, reason: 'unavailable' };
  }
}

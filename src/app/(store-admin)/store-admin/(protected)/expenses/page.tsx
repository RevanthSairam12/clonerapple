import Link from 'next/link';

import { formatPaise } from '@/lib/store-admin/amount';
import { listExpenseCategories, listExpenses } from '@/lib/store-admin/expenses';
import { parseReportFilters, reportQuery } from '@/lib/store-admin/report-rules';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function flatParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function preview(note: string): string {
  const clean = note.trim();
  return clean.length > 90 ? `${clean.slice(0, 90)}…` : clean;
}

/**
 * Expense ledger.
 *
 * Entries are soft-deleted and every change is audited, so the list is the
 * current view rather than the whole history. The report page rolls the same
 * rows up by day and category.
 */
export default async function StoreAdminExpensesPage({ searchParams }: Props) {
  const raw = flatParams(await searchParams);
  const parsed = parseReportFilters(raw);

  if (!parsed.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Expenses</h1>
        <p className="sa-error">{parsed.error}</p>
        <Link className="sa-back" href="/store-admin/expenses">← Reset filters</Link>
      </div>
    );
  }

  const filters = parsed.filters;
  const page = Number.parseInt(raw.page ?? '1', 10);
  const [result, categories] = await Promise.all([
    listExpenses({
      fromDay: filters.fromDay,
      toDay: filters.toDay,
      categoryId: filters.categoryId,
      page: Number.isFinite(page) ? page : 1,
    }),
    listExpenseCategories(),
  ]);

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Expenses</h1>
        <p className="sa-notice">
          The expense ledger is not available. Check the database configuration and that
          migration 0027 is applied.
        </p>
      </div>
    );
  }

  const { expenses, total, page: currentPage, pageCount, pageSize, totalPaise } = result.data;
  const firstRow = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = Math.min(currentPage * pageSize, total);
  const categoryOptions = categories.ok ? categories.data : [];
  const average = total > 0 ? Math.round(totalPaise / total) : 0;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Expenses</h1>
          <p className="sa-page-sub">
            What the shop paid out — rent, packaging, salaries, software and the rest.
            Entries can be corrected; removals stay in the audit log.
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/reports/expenses">
            Expense report
          </Link>
          <Link className="sa-btn sa-btn-primary sa-btn-small" href="/store-admin/expenses/new">
            Add expense
          </Link>
        </div>
      </div>

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Total spend</span>
          </div>
          <p className="sa-stat-value">{formatPaise(totalPaise)}</p>
          <span className="sa-stat-meta">
            {filters.fromDay} to {filters.toDay}
          </span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Entries</span>
          </div>
          <p className="sa-stat-value">{total.toLocaleString('en-IN')}</p>
          <span className="sa-stat-meta">
            {categoryOptions.length} categories available
          </span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Average entry</span>
          </div>
          <p className="sa-stat-value">{formatPaise(average)}</p>
          <span className="sa-stat-meta">Across the selected range</span>
        </div>
      </div>

      <form className="sa-filter-bar" method="get" action="/store-admin/expenses">
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="expense-from">From</label>
          <input
            id="expense-from"
            className="sa-input"
            type="date"
            name="from"
            defaultValue={filters.fromDay}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="expense-to">To</label>
          <input
            id="expense-to"
            className="sa-input"
            type="date"
            name="to"
            defaultValue={filters.toDay}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="expense-filter-category">Category</label>
          <select
            id="expense-filter-category"
            className="sa-input"
            name="category"
            defaultValue={filters.categoryId ?? ''}
          >
            <option value="">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sa-filter-actions">
          <button type="submit" className="sa-btn sa-btn-primary sa-btn-small">Apply</button>
          <Link className="sa-back sa-back-inline" href="/store-admin/expenses">Clear</Link>
        </div>
      </form>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Expense</th>
              <th>Category</th>
              <th>Receipt</th>
              <th className="sa-num">Amount</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td className="sa-empty" colSpan={6}>
                  No expenses in this range.{' '}
                  <Link className="sa-product-link" href="/store-admin/expenses/new">
                    Record the first one.
                  </Link>
                </td>
              </tr>
            ) : (
              expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="sa-date">{expense.spentOn}</td>
                  <td>
                    <Link
                      className="sa-product-link"
                      href={`/store-admin/expenses/${encodeURIComponent(expense.id)}`}
                    >
                      {expense.title}
                    </Link>
                    {expense.note ? (
                      <span className="sa-row-sub">{preview(expense.note)}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="sa-pill">{expense.categoryName}</span>
                  </td>
                  <td>
                    {expense.attachmentUrl ? (
                      <a
                        className="sa-product-link"
                        href={expense.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="sa-num">{formatPaise(expense.amountPaise)}</td>
                  <td>
                    <Link
                      className="sa-btn sa-btn-quiet sa-btn-small"
                      href={`/store-admin/expenses/${encodeURIComponent(expense.id)}`}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <nav className="sa-pagination" aria-label="Expense pages">
          <span>
            Showing {firstRow}–{lastRow} of {total}
          </span>
          <div className="sa-inline-actions">
            {currentPage > 1 ? (
              <Link
                className="sa-btn sa-btn-quiet sa-btn-small"
                href={`/store-admin/expenses${reportQuery(filters, { page: String(currentPage - 1) })}`}
              >
                Previous
              </Link>
            ) : null}
            <span>Page {currentPage} of {pageCount}</span>
            {currentPage < pageCount ? (
              <Link
                className="sa-btn sa-btn-quiet sa-btn-small"
                href={`/store-admin/expenses${reportQuery(filters, { page: String(currentPage + 1) })}`}
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

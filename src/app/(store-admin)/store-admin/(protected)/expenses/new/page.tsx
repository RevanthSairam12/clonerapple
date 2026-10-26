import Link from 'next/link';

import { ExpenseCategoryForm } from '@/components/store-admin/ExpenseCategoryForm';
import { ExpenseForm } from '@/components/store-admin/ExpenseForm';
import { listExpenseCategories } from '@/lib/store-admin/expenses';

export const dynamic = 'force-dynamic';

export default async function StoreAdminNewExpensePage() {
  const categories = await listExpenseCategories();

  return (
    <div>
      <Link className="sa-back" href="/store-admin/expenses">
        ← Expense ledger
      </Link>
      <h1 className="sa-page-title">Add expense</h1>
      <p className="sa-page-sub">
        One line per payment. The receipt is optional, and a date cannot be in the future.
      </p>

      {!categories.ok ? (
        <p className="sa-notice">
          Expense categories are not available. Check the database configuration and that
          migration 0027 is applied.
        </p>
      ) : (
        <div className="sa-detail-grid">
          <ExpenseForm categories={categories.data} />
          <section className="sa-panel">
            <h2 className="sa-card-title">Categories</h2>
            <p className="sa-card-note">
              Nine categories ship with the ledger. Add your own here; they become available
              in every expense form and in the report filter.
            </p>
            <ul className="sa-plain-list">
              {categories.data.map((category) => (
                <li key={category.id}>{category.name}</li>
              ))}
            </ul>
            <ExpenseCategoryForm />
          </section>
        </div>
      )}
    </div>
  );
}

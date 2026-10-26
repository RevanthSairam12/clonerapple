import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExpenseForm } from '@/components/store-admin/ExpenseForm';
import { formatDate } from '@/lib/store-admin/catalog';
import { getExpense, listExpenseCategories } from '@/lib/store-admin/expenses';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function StoreAdminExpenseDetailPage({ params }: Props) {
  const { id } = await params;
  const [result, categories] = await Promise.all([
    getExpense(id),
    listExpenseCategories(),
  ]);

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <h1 className="sa-page-title">Expense</h1>
        <p className="sa-notice">
          The expense ledger is not available. Check the database configuration.
        </p>
      </div>
    );
  }

  const expense = result.data;

  return (
    <div>
      <Link className="sa-back" href="/store-admin/expenses">
        ← Expense ledger
      </Link>
      <h1 className="sa-page-title">{expense.title}</h1>
      <p className="sa-page-sub">
        {expense.spentOn} · {expense.categoryName} · recorded {formatDate(expense.createdAt)}
        {expense.updatedAt !== expense.createdAt
          ? ` · last edited ${formatDate(expense.updatedAt)}`
          : ''}
      </p>

      {!categories.ok ? (
        <p className="sa-notice">Expense categories are not available.</p>
      ) : (
        <ExpenseForm categories={categories.data} expense={expense} />
      )}
    </div>
  );
}

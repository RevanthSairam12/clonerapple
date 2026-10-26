'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Add a category to the expense ledger. Seeded categories cannot be removed. */
export function ExpenseCategoryForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/store-admin/expenses/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error || 'The category could not be saved.');
        return;
      }
      setName('');
      router.refresh();
    } catch {
      setError('The category could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sa-inline-form" onSubmit={submit}>
      <label className="sa-label" htmlFor="expense-category-name">New category</label>
      <div className="sa-inline-actions">
        <input
          id="expense-category-name"
          className="sa-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Courier charges"
          required
        />
        <button className="sa-btn sa-btn-quiet sa-btn-small" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error ? <p className="sa-error">{error}</p> : null}
    </form>
  );
}

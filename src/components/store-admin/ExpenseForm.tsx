'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Create or edit one expense.
 *
 * A receipt is a photo or video from the shared media library, so it goes
 * through the same upload endpoint (and the same content sniffing) as every
 * other asset. The ledger row stores only the media id.
 */

interface Category {
  id: string;
  name: string;
}

export interface ExpenseFormValues {
  id: string;
  title: string;
  amountPaise: number;
  spentOn: string;
  categoryId: string | null;
  note: string;
  attachmentId: string | null;
  attachmentUrl: string | null;
}

interface Props {
  categories: Category[];
  expense?: ExpenseFormValues;
}

function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function ExpenseForm({ categories, expense }: Props) {
  const router = useRouter();
  const editing = Boolean(expense);

  const [title, setTitle] = useState(expense?.title ?? '');
  const [amount, setAmount] = useState(expense ? rupees(expense.amountPaise) : '');
  const [spentOn, setSpentOn] = useState(
    expense?.spentOn ?? new Date().toISOString().slice(0, 10),
  );
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [attachmentId, setAttachmentId] = useState(expense?.attachmentId ?? '');
  const [attachmentUrl, setAttachmentUrl] = useState(expense?.attachmentUrl ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function uploadReceipt(): Promise<string | null> {
    if (!file) return attachmentId || null;

    const form = new FormData();
    form.set('file', file);
    form.set('alt', `Receipt for ${title || 'an expense'}`);
    const response = await fetch('/api/store-admin/media', { method: 'POST', body: form });
    const body = (await response.json().catch(() => null)) as
      | { media?: { id?: string; url?: string }; error?: string }
      | null;
    if (!response.ok || !body?.media?.id) {
      throw new Error(body?.error || 'The receipt could not be uploaded.');
    }
    setAttachmentId(body.media.id);
    setAttachmentUrl(body.media.url ?? '');
    return body.media.id;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const mediaId = await uploadReceipt();
      const payload = {
        title,
        amount,
        spentOn,
        categoryId: categoryId || null,
        note,
        attachmentMediaId: mediaId,
      };
      const response = await fetch(
        editing ? `/api/store-admin/expenses/${encodeURIComponent(expense!.id)}` : '/api/store-admin/expenses',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { expense?: { id: string }; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error || 'The expense could not be saved.');
        return;
      }

      if (editing) {
        setMessage('Saved.');
        router.refresh();
      } else {
        router.push('/store-admin/expenses');
        router.refresh();
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || busy) return;
    if (!window.confirm('Remove this expense from the ledger? The audit log keeps the change.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/expenses/${encodeURIComponent(expense!.id)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error || 'The expense could not be removed.');
        return;
      }
      router.push('/store-admin/expenses');
      router.refresh();
    } catch {
      setError('The expense could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sa-control-card" onSubmit={submit}>
      <h2 className="sa-control-title">{editing ? 'Edit expense' : 'Record an expense'}</h2>

      <div className="sa-control-grid">
        <div className="sa-field sa-field-wide">
          <label className="sa-label" htmlFor="expense-title">Title</label>
          <input
            id="expense-title"
            className="sa-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            required
            placeholder="October shop rent"
          />
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="expense-amount">Amount ₹</label>
          <input
            id="expense-amount"
            className="sa-input"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            placeholder="12500.00"
          />
          <p className="sa-hint">Rupees and paise, at most two decimals.</p>
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="expense-date">Spent on</label>
          <input
            id="expense-date"
            className="sa-input"
            type="date"
            value={spentOn}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setSpentOn(event.target.value)}
            required
          />
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="expense-category">Category</label>
          <select
            id="expense-category"
            className="sa-input"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="expense-receipt">Receipt</label>
          <input
            id="expense-receipt"
            className="sa-input"
            type="file"
            accept="image/*,video/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="sa-hint">
            {attachmentUrl ? (
              <a className="sa-product-link" href={attachmentUrl} target="_blank" rel="noreferrer">
                Current receipt
              </a>
            ) : (
              'Optional photo or video, uploaded to the media library.'
            )}
          </p>
        </div>

        <div className="sa-field sa-field-wide">
          <label className="sa-label" htmlFor="expense-note">Note</label>
          <textarea
            id="expense-note"
            className="sa-input"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything the next person needs to know."
          />
          <p className="sa-hint">Kept off the audit log; only the ledger shows it.</p>
        </div>
      </div>

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-hint" role="status">{message}</p> : null}

      <div className="sa-inline-actions">
        <button className="sa-btn sa-btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
        </button>
        {editing ? (
          <button
            className="sa-btn sa-btn-quiet"
            type="button"
            onClick={remove}
            disabled={busy}
          >
            Remove
          </button>
        ) : null}
      </div>
    </form>
  );
}

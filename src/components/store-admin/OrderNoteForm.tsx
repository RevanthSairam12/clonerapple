'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MAX_LENGTH = 2000;

export function OrderNoteForm({ txnid }: { txnid: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/orders/${encodeURIComponent(txnid)}/notes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'The note could not be saved.',
        );
      }
      setBody('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The note could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sa-note-form" onSubmit={submit}>
      <label className="sa-label" htmlFor="order-note-body">Add an internal note</label>
      <textarea
        id="order-note-body"
        className="sa-note-input"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={MAX_LENGTH}
        placeholder="Packing instructions, a call summary, or why a delivery slipped…"
        required
      />
      <div className="sa-note-form-foot">
        <span className="sa-note-count">{body.length} / {MAX_LENGTH}</span>
        <button className="sa-btn sa-btn-primary" type="submit" disabled={busy || !body.trim()}>
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
    </form>
  );
}

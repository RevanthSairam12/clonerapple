'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CustomerNoteForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!body.trim()) {
      setError('Write a note before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/customers/${encodeURIComponent(customerId)}/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'The note could not be saved.');
        return;
      }
      setBody('');
      router.refresh();
    } catch {
      setError('The note could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-control-card">
      <p className="sa-control-title">Add a note</p>
      <label className="sa-field sa-field-wide">
        <span className="sa-label">Note</span>
        <textarea
          className="sa-input"
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Context for the next person who opens this account"
        />
        <span className="sa-hint">
          {body.length}/2000 · notes are append-only and cannot be edited
        </span>
      </label>
      <div className="sa-inline-actions">
        <button
          type="button"
          className="sa-btn sa-btn-primary sa-btn-small"
          onClick={save}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
        {error ? <span className="sa-error">{error}</span> : null}
      </div>
    </div>
  );
}

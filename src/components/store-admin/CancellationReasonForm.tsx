'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CancellationReason } from '@/lib/store-admin/returns';

interface Props {
  reasons: CancellationReason[];
  canEdit: boolean;
}

interface Draft {
  id?: string;
  label: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY: Draft = { label: '', sortOrder: '50', isActive: true };

/**
 * Cancellation reasons are reference data: they label past orders, so rows are
 * deactivated rather than deleted.
 */
export function CancellationReasonForm({ reasons, canEdit }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function edit(reason: CancellationReason) {
    setDraft({
      id: reason.id,
      label: reason.label,
      sortOrder: String(reason.sortOrder),
      isActive: reason.isActive,
    });
    setError(null);
    setMessage(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/reasons/cancellation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          label: draft.label,
          sortOrder: Number(draft.sortOrder) || 0,
          isActive: draft.isActive,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The reason could not be saved.');
      }
      setMessage(draft.id ? 'Reason updated.' : 'Reason added.');
      setDraft(EMPTY);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The reason could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(reason: CancellationReason) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/reasons/cancellation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: reason.id,
          label: reason.label,
          sortOrder: reason.sortOrder,
          isActive: !reason.isActive,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The reason could not be updated.');
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The reason could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {message ? <p className="sa-success" role="status">{message}</p> : null}

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th className="sa-num">Order</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((reason) => (
              <tr key={reason.id} className={reason.isActive ? undefined : 'sa-row-muted'}>
                <td>
                  {reason.label}
                  <span className="sa-row-sub sa-mono">{reason.id}</span>
                </td>
                <td className="sa-num">{reason.sortOrder}</td>
                <td>
                  <span className={reason.isActive ? 'sa-status sa-status-on' : 'sa-status'}>
                    {reason.isActive ? 'Active' : 'Hidden'}
                  </span>
                </td>
                <td>
                  {canEdit ? (
                    <div className="sa-review-buttons">
                      <button className="sa-btn sa-btn-small sa-btn-quiet" type="button" onClick={() => edit(reason)}>
                        Edit
                      </button>
                      <button
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        type="button"
                        onClick={() => toggle(reason)}
                        disabled={busy}
                      >
                        {reason.isActive ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  ) : (
                    <span className="sa-note">Read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <form className="sa-edit-form sa-reason-form" onSubmit={submit}>
          <h2 className="sa-card-title">{draft.id ? 'Edit reason' : 'Add a reason'}</h2>
          <div className="sa-control-grid">
            <label className="sa-field sa-field-wide">
              <span className="sa-label">Label</span>
              <input
                className="sa-input"
                value={draft.label}
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                maxLength={120}
                required
                placeholder="e.g. Customer changed their mind"
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Sort order</span>
              <input
                className="sa-input sa-mono"
                type="number"
                min={0}
                max={9999}
                value={draft.sortOrder}
                onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))}
              />
            </label>
            <label className="sa-field sa-checkbox">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
              />
              <span>Active</span>
            </label>
          </div>

          {error ? <p className="sa-error" role="alert">{error}</p> : null}

          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy || draft.label.trim().length === 0}>
              {busy ? 'Saving…' : draft.id ? 'Save reason' : 'Add reason'}
            </button>
            {draft.id ? (
              <button
                className="sa-btn sa-btn-quiet"
                type="button"
                onClick={() => { setDraft(EMPTY); setError(null); }}
              >
                Stop editing
              </button>
            ) : null}
            <span className="sa-note">Reasons are never deleted — hide one to keep it out of new cancellations.</span>
          </div>
        </form>
      ) : (
        <p className="sa-lock-note">Viewer access is read-only.</p>
      )}
    </div>
  );
}

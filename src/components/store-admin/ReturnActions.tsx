'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { canTransitionReturn, type ReturnStatus } from '@/lib/store-admin/return-rules';

interface Props {
  returnId: string;
  status: ReturnStatus;
}

interface ActionMeta {
  action: 'approve' | 'reject' | 'receive' | 'cancel';
  target: ReturnStatus;
  label: string;
  hint: string;
  tone: 'primary' | 'quiet' | 'danger';
  confirm: boolean;
  noteLabel?: string;
  noteRequired?: boolean;
}

const ACTIONS: ActionMeta[] = [
  {
    action: 'approve',
    target: 'APPROVED',
    label: 'Approve return',
    hint: 'The customer can send the goods back.',
    tone: 'primary',
    confirm: false,
  },
  {
    action: 'reject',
    target: 'REJECTED',
    label: 'Reject',
    hint: 'Close the request without taking the goods back.',
    tone: 'danger',
    confirm: true,
    noteLabel: 'Why is this being rejected?',
    noteRequired: true,
  },
  {
    action: 'receive',
    target: 'RECEIVED',
    label: 'Mark received',
    hint: 'Goods are back in the shop. Restock-flagged lines add back to stock now.',
    tone: 'primary',
    confirm: true,
    noteLabel: 'Received note (optional)',
  },
  {
    action: 'cancel',
    target: 'CANCELLED',
    label: 'Cancel return',
    hint: 'Withdraw the return before the goods are received.',
    tone: 'quiet',
    confirm: true,
    noteLabel: 'Why is the return being cancelled?',
    noteRequired: true,
  },
];

/** The decision buttons for a single return, limited to the legal next states. */
export function ReturnActions({ returnId, status }: Props) {
  const router = useRouter();
  const [openAction, setOpenAction] = useState<ActionMeta['action'] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = ACTIONS.filter((meta) => canTransitionReturn(status, meta.target));
  if (available.length === 0) {
    return <p className="sa-note">This return is closed. No further decisions are possible.</p>;
  }

  async function run(meta: ActionMeta) {
    if (meta.confirm && openAction !== meta.action) {
      setOpenAction(meta.action);
      setNote('');
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/store-admin/returns/${encodeURIComponent(returnId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: meta.action, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The return could not be updated.');
      }
      setOpenAction(null);
      setNote('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The return could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  const active = available.find((meta) => meta.action === openAction) ?? null;

  return (
    <div className="sa-review-actions">
      <div className="sa-review-buttons">
        {available.map((meta) => (
          <button
            key={meta.action}
            type="button"
            className={`sa-btn sa-btn-small ${meta.tone === 'primary' ? 'sa-btn-primary' : meta.tone === 'danger' ? 'sa-btn-danger' : 'sa-btn-quiet'}`}
            onClick={() => run(meta)}
            disabled={busy}
            title={meta.hint}
          >
            {meta.label}
          </button>
        ))}
      </div>

      {active ? (
        <div className="sa-review-reject">
          <label className="sa-field">
            <span className="sa-label">
              {active.noteLabel}
              {active.noteRequired ? null : <span className="sa-hint"> optional</span>}
            </span>
            <input
              className="sa-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              required={active.noteRequired}
            />
          </label>
          <div className="sa-review-buttons">
            <button
              type="button"
              className={`sa-btn sa-btn-small ${active.tone === 'danger' ? 'sa-btn-danger' : 'sa-btn-primary'}`}
              onClick={() => run(active)}
              disabled={busy || (active.noteRequired === true && note.trim().length < 3)}
            >
              {busy ? 'Working…' : `Confirm ${active.label.toLowerCase()}`}
            </button>
            <button
              type="button"
              className="sa-btn sa-btn-small sa-btn-quiet"
              onClick={() => { setOpenAction(null); setNote(''); }}
              disabled={busy}
            >
              Keep as is
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
    </div>
  );
}

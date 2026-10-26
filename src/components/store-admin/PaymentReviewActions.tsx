'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  paymentId: number;
  canReview: boolean;
}

/**
 * Approve or reject one parked manual payment. A rejection always carries a
 * reason; the queue is server-rendered, so a decision refreshes the page instead
 * of keeping local list state.
 */
export function PaymentReviewActions({ paymentId, canReview }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canReview) {
    return <span className="sa-note">Owner or admin access required</span>;
  }

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/store-admin/payments/${paymentId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'The payment could not be reviewed.');
      }
      setMode('idle');
      setReason('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The payment could not be reviewed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-review-actions">
      {mode === 'idle' ? (
        <div className="sa-review-buttons">
          <button
            type="button"
            className="sa-btn sa-btn-primary sa-btn-small"
            disabled={busy}
            onClick={() => decide('approve')}
          >
            {busy ? 'Working…' : 'Approve'}
          </button>
          <button
            type="button"
            className="sa-btn sa-btn-quiet sa-btn-small"
            disabled={busy}
            onClick={() => {
              setMode('reject');
              setError(null);
            }}
          >
            Reject
          </button>
        </div>
      ) : (
        <form
          className="sa-review-reject"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim().length < 5) return;
            void decide('reject');
          }}
        >
          <label className="sa-field">
            <span className="sa-label">Rejection reason</span>
            <input
              className="sa-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={5}
              maxLength={200}
              placeholder="e.g. Reference not found in bank statement"
              required
              autoFocus
            />
          </label>
          <div className="sa-review-buttons">
            <button
              className="sa-btn sa-btn-danger sa-btn-small"
              type="submit"
              disabled={busy || reason.trim().length < 5}
            >
              {busy ? 'Rejecting…' : 'Confirm rejection'}
            </button>
            <button
              className="sa-btn sa-btn-quiet sa-btn-small"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('idle');
                setReason('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
    </div>
  );
}

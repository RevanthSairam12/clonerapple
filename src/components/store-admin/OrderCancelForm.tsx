'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Reason {
  id: string;
  label: string;
}

interface Props {
  txnid: string;
  reasons: Reason[];
  /** Shown when a paid order is cancelled but still needs a refund. */
  paidPaise: number;
}

/**
 * Cancel an order before it is delivered. Paid money is not returned here —
 * the refund is a separate, audited ledger entry.
 */
export function OrderCancelForm({ txnid, reasons, paidPaise }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/store-admin/orders/${encodeURIComponent(txnid)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reasonId, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The order could not be cancelled.');
      }
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The order could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  if (reasons.length === 0) {
    return (
      <p className="sa-lock-note">
        No cancellation reasons are active. Add one under Settings → Cancellation reasons.
      </p>
    );
  }

  return (
    <section className="sa-edit-card sa-cancel-card">
      <div className="sa-edit-head">
        <div>
          <h2 className="sa-card-title">Cancel this order</h2>
          <p className="sa-note">
            Only for orders that have not been delivered. A paid order keeps its payment and
            needs a separate refund.
          </p>
        </div>
        <button
          className="sa-btn sa-btn-quiet"
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {open ? 'Keep order' : 'Cancel order'}
        </button>
      </div>

      {open ? (
        <form className="sa-edit-form" onSubmit={submit}>
          <label className="sa-field">
            <span className="sa-label">Reason</span>
            <select
              className="sa-input"
              value={reasonId}
              onChange={(event) => setReasonId(event.target.value)}
              required
            >
              {reasons.map((reason) => (
                <option key={reason.id} value={reason.id}>{reason.label}</option>
              ))}
            </select>
          </label>
          <label className="sa-field">
            <span className="sa-label">Note <span className="sa-hint">optional, stored on the order</span></span>
            <input
              className="sa-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </label>

          {paidPaise > 0 ? (
            <p className="sa-notice">
              This order has been paid. Cancelling closes fulfilment but does not move money —
              record a refund of up to ₹{(paidPaise / 100).toFixed(2)} afterwards.
            </p>
          ) : null}

          {error ? <p className="sa-error" role="alert">{error}</p> : null}

          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-danger" type="submit" disabled={busy || !reasonId}>
              {busy ? 'Cancelling…' : 'Cancel order'}
            </button>
            <span className="sa-note">The cancellation and its reason are written to the order history and audited.</span>
          </div>
        </form>
      ) : null}
    </section>
  );
}

'use client';

import { useState } from 'react';

import { formatPaise } from '@/lib/store-admin/amount';
import { MANUAL_METHODS, METHOD_LABELS, type ManualMethod } from '@/lib/store-admin/payment-rules';

interface Props {
  txnid: string;
  canEdit: boolean;
  totalPaise: number;
  paidPaise: number;
  orderPaid: boolean;
}

export function OrderPaymentControls({ txnid, canEdit, totalPaise, paidPaise, orderPaid }: Props) {
  const [method, setMethod] = useState<ManualMethod>('cash');
  const [amount, setAmount] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!canEdit) {
    return <p className="sa-lock-note">Viewer access is read-only. Recording payments needs store admin or owner access.</p>;
  }

  if (orderPaid) {
    return <p className="sa-lock-note">This order is already paid. Manual entries are refused on a settled order.</p>;
  }

  const needsRef = method === 'upi' || method === 'bank_transfer';
  const remaining = Math.max(0, totalPaise - paidPaise);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/store-admin/orders/${encodeURIComponent(txnid)}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method,
          amount,
          providerRef: providerRef.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not record the payment.');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sa-control-card" onSubmit={submit}>
      <h3 className="sa-control-title">Record a manual payment</h3>
      <p className="sa-note">
        Outstanding {formatPaise(remaining)} of {formatPaise(totalPaise)}. Partial payments are allowed; the
        order becomes paid only when the recorded amount covers the total.
      </p>
      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">Method</span>
          <select className="sa-input" value={method} onChange={(event) => setMethod(event.target.value as ManualMethod)}>
            {MANUAL_METHODS.map((key) => (
              <option key={key} value={key}>{METHOD_LABELS[key]}</option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span className="sa-label">Amount (₹)</span>
          <input
            className="sa-input"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={(remaining / 100).toFixed(2)}
            required
          />
        </label>
        {needsRef ? (
          <label className="sa-field">
            <span className="sa-label">Transaction reference</span>
            <input
              className="sa-input sa-mono"
              value={providerRef}
              onChange={(event) => setProviderRef(event.target.value)}
              maxLength={120}
              required
            />
          </label>
        ) : null}
        <label className="sa-field">
          <span className="sa-label">Notes <span className="sa-hint">optional</span></span>
          <input
            className="sa-input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={300}
          />
        </label>
      </div>
      <button className="sa-btn sa-btn-primary" type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Mark as paid'}
      </button>
      {message ? <p className="sa-error" role="alert">{message}</p> : null}
    </form>
  );
}

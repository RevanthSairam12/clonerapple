'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { REFUND_METHODS, REFUND_REFERENCE_METHODS, type RefundMethod } from '@/lib/store-admin/return-rules';

interface Props {
  endpoint: string;
  remainingPaise: number;
  currency?: string;
  suggestedPaise?: number;
  title?: string;
  hint?: string;
  onDone?: () => void;
}

const METHOD_LABELS: Record<RefundMethod, string> = {
  cash: 'Cash',
  upi: 'UPI transfer',
  card_machine: 'Card machine reversal',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

function formatPaise(paise: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Record a manual refund. The money moves outside this app (cash, UPI, bank,
 * card machine) and this form is the ledger entry. The server refuses anything
 * above the captured total.
 */
export function RefundForm({
  endpoint,
  remainingPaise,
  currency = 'INR',
  suggestedPaise = 0,
  title = 'Record a refund',
  hint,
  onDone,
}: Props) {
  const router = useRouter();
  const suggested =
    suggestedPaise > 0 && suggestedPaise <= remainingPaise ? suggestedPaise : remainingPaise;
  const [amount, setAmount] = useState((suggested / 100).toFixed(2));
  const [method, setMethod] = useState<RefundMethod>('upi');
  const [providerRef, setProviderRef] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const needsReference = REFUND_REFERENCE_METHODS.includes(method);
  const amountPaise = Math.round(Number(amount) * 100);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountPaise, method, providerRef, reason, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The refund could not be recorded.');
      }
      setMessage(`Refund recorded. ${formatPaise(Number(payload.remainingPaise ?? 0), currency)} still refundable.`);
      setProviderRef('');
      setReason('');
      setNote('');
      router.refresh();
      onDone?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The refund could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-edit-card">
      <div className="sa-edit-head">
        <div>
          <h2 className="sa-card-title">{title}</h2>
          <p className="sa-note">
            {hint ?? 'Refunds are paid outside this app and recorded here. Rows are append-only.'}
          </p>
        </div>
        <span className="sa-pill">Refundable {formatPaise(remainingPaise, currency)}</span>
      </div>

      {message ? <p className="sa-success" role="status">{message}</p> : null}

      <form className="sa-edit-form" onSubmit={submit}>
        <div className="sa-control-grid">
          <label className="sa-field">
            <span className="sa-label">Amount ({currency})</span>
            <input
              className="sa-input sa-mono"
              type="number"
              min="0.01"
              step="0.01"
              max={(remainingPaise / 100).toFixed(2)}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label className="sa-field">
            <span className="sa-label">Method</span>
            <select
              className="sa-input"
              value={method}
              onChange={(event) => setMethod(event.target.value as RefundMethod)}
            >
              {REFUND_METHODS.map((candidate) => (
                <option key={candidate} value={candidate}>{METHOD_LABELS[candidate]}</option>
              ))}
            </select>
          </label>
          {needsReference ? (
            <label className="sa-field">
              <span className="sa-label">Reference <span className="sa-hint">UTR or transaction id</span></span>
              <input
                className="sa-input sa-mono"
                value={providerRef}
                onChange={(event) => setProviderRef(event.target.value)}
                maxLength={120}
                required
              />
            </label>
          ) : null}
          <label className="sa-field sa-field-wide">
            <span className="sa-label">Reason <span className="sa-hint">optional</span></span>
            <input
              className="sa-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="e.g. Return of one unit"
            />
          </label>
          <label className="sa-field sa-field-wide">
            <span className="sa-label">Note <span className="sa-hint">optional, internal</span></span>
            <input
              className="sa-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </label>
        </div>

        {error ? <p className="sa-error" role="alert">{error}</p> : null}

        <div className="sa-edit-actions">
          <button
            className="sa-btn sa-btn-primary"
            type="submit"
            disabled={
              busy ||
              remainingPaise <= 0 ||
              !Number.isFinite(amountPaise) ||
              amountPaise <= 0 ||
              amountPaise > remainingPaise ||
              (needsReference && providerRef.trim().length === 0)
            }
          >
            {busy ? 'Recording…' : 'Record refund'}
          </button>
          <span className="sa-note">PayU has no refund API here — pay the customer, then log it.</span>
        </div>
      </form>
    </section>
  );
}

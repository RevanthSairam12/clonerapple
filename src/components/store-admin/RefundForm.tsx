'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { REFUND_METHODS, type RefundMethod } from '@/lib/store-admin/return-rules';
import type { RefundRequestRow } from '@/lib/store-admin/refund-lifecycle';

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
 * Initiate an external manual refund. This reserves capacity only; staff mark
 * it complete separately after transferring the money and obtaining a reference.
 */
export function RefundForm({
  endpoint,
  remainingPaise,
  currency = 'INR',
  suggestedPaise = 0,
  title = 'Initiate a refund',
  hint,
  onDone,
}: Props) {
  const router = useRouter();
  const suggested =
    suggestedPaise > 0 && suggestedPaise <= remainingPaise ? suggestedPaise : remainingPaise;
  const [amount, setAmount] = useState((suggested / 100).toFixed(2));
  const [method, setMethod] = useState<RefundMethod>('upi');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
        body: JSON.stringify({ amountPaise, method, reason, note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The refund could not be initiated.');
      }
      setMessage(`Refund initiated. ${formatPaise(Number(payload.remainingPaise ?? 0), currency)} available after pending reservations.`);
      setReason('');
      setNote('');
      router.refresh();
      onDone?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The refund could not be initiated.');
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
            {hint ?? 'Initiation reserves the amount only. Mark complete after payment with a reference for every method.'}
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
              amountPaise > remainingPaise
            }
          >
            {busy ? 'Initiating…' : 'Initiate refund'}
          </button>
          <span className="sa-note">No PayU refund API is called. Pending refunds are not completed payments.</span>
        </div>
      </form>
    </section>
  );
}

export function RefundRequestActions({ txnid, requests, canManage = false }: {
  txnid: string; requests: RefundRequestRow[]; canManage?: boolean;
}) {
  return (
    <section className="sa-detail-section">
      <h2 className="sa-section-title">Refund lifecycle</h2>
      {requests.length === 0 ? <p className="sa-note">No refunds have been initiated. Historical recorded refunds remain completed.</p> : null}
      {requests.map(request => <RefundRequestAction key={request.id} txnid={txnid} request={request} canManage={canManage} />)}
    </section>
  );
}

function RefundRequestAction({ txnid, request, canManage }: {
  txnid: string; request: RefundRequestRow; canManage: boolean;
}) {
  const router = useRouter();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function resolve(status: 'COMPLETED' | 'FAILED' | 'REJECTED') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/store-admin/orders/${encodeURIComponent(txnid)}/refunds/${encodeURIComponent(request.id)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, providerRef: reference }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Could not update the refund.');
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the refund.'); }
    finally { setBusy(false); }
  }
  return <div className="sa-detail-card">
    <p><strong>{formatPaise(request.amountPaise, request.currency)}</strong> · {METHOD_LABELS[request.method]} · {request.status === 'INITIATED' ? 'Refund Initiated' : request.status === 'COMPLETED' ? 'Refund Successful' : request.status}</p>
    <p className="sa-note sa-mono">{request.id}{request.refundId ? ` · ${request.refundId}` : ''}</p>
    {request.status === 'INITIATED' && canManage ? <>
      <label className="sa-field"><span className="sa-label">Completion reference (all methods)</span>
        <input className="sa-input" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} placeholder="UTR, transfer id or cash receipt reference" />
      </label>
      <p className="sa-note">Mark complete only after the customer has been paid. Failed or rejected requests release their reserved amount; retry by initiating a new request.</p>
      <div className="sa-edit-actions">
        <button className="sa-btn sa-btn-primary" type="button" disabled={busy || !reference.trim()} onClick={() => resolve('COMPLETED')}>Mark complete</button>
        <button className="sa-btn" type="button" disabled={busy} onClick={() => resolve('FAILED')}>Mark failed</button>
        <button className="sa-btn" type="button" disabled={busy} onClick={() => resolve('REJECTED')}>Reject</button>
      </div>
    </> : null}
    {error ? <p className="sa-error" role="alert">{error}</p> : null}
  </div>;
}

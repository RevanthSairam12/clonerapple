'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  customerId: string;
  blocked: boolean;
  blockedReason: string;
  canAnonymise: boolean;
  anonymised: boolean;
}

export function CustomerActions({
  customerId,
  blocked,
  blockedReason,
  canAnonymise,
  anonymised,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'block' | 'anonymise'>('idle');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(path: string, body: unknown): Promise<Response> {
    return fetch(`/api/store-admin/customers/${encodeURIComponent(customerId)}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function toggleBlock(nextBlocked: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await send('status', { blocked: nextBlocked, reason });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'The account could not be updated.');
        return;
      }
      setMode('idle');
      setReason('');
      setNotice(
        nextBlocked
          ? `Account blocked. ${data.revokedSessions ?? 0} session(s) ended.`
          : 'Account unblocked.',
      );
      router.refresh();
    } catch {
      setError('The account could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function anonymise() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await send('anonymise', { confirm });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'The account could not be anonymised.');
        return;
      }
      router.push('/store-admin/customers');
      router.refresh();
    } catch {
      setError('The account could not be anonymised.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-customer-actions">
      {blocked ? (
        <button
          type="button"
          className="sa-btn sa-btn-quiet sa-btn-small"
          onClick={() => toggleBlock(false)}
          disabled={busy}
        >
          Unblock account
        </button>
      ) : (
        <button
          type="button"
          className="sa-btn sa-btn-danger sa-btn-small"
          onClick={() => setMode(mode === 'block' ? 'idle' : 'block')}
          disabled={busy}
        >
          Block account
        </button>
      )}

      {canAnonymise && !anonymised ? (
        <button
          type="button"
          className="sa-btn sa-btn-danger sa-btn-small"
          onClick={() => setMode(mode === 'anonymise' ? 'idle' : 'anonymise')}
          disabled={busy}
        >
          Anonymise
        </button>
      ) : null}

      {mode === 'block' ? (
        <div className="sa-control-card sa-pop-card">
          <p className="sa-control-title">Block this account</p>
          <p className="sa-hint">
            Every storefront session ends immediately. The customer cannot sign
            in until the account is unblocked.
          </p>
          <label className="sa-field">
            <span className="sa-label">Reason (5–200 characters)</span>
            <textarea
              className="sa-input"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
            />
            {blockedReason ? (
              <span className="sa-hint">Previous reason: {blockedReason}</span>
            ) : null}
          </label>
          <div className="sa-inline-actions">
            <button
              type="button"
              className="sa-btn sa-btn-danger sa-btn-small"
              onClick={() => toggleBlock(true)}
              disabled={busy}
            >
              {busy ? 'Blocking…' : 'Block account'}
            </button>
            <button
              type="button"
              className="sa-btn sa-btn-quiet sa-btn-small"
              onClick={() => setMode('idle')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'anonymise' ? (
        <div className="sa-control-card sa-pop-card">
          <p className="sa-control-title">Anonymise this account</p>
          <p className="sa-hint">
            Removes the name, phone, saved addresses and newsletter consent, and
            ends every session. Order records and internal notes stay. This
            cannot be undone.
          </p>
          <label className="sa-field">
            <span className="sa-label">Type ANONYMISE to confirm</span>
            <input
              className="sa-input"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="sa-inline-actions">
            <button
              type="button"
              className="sa-btn sa-btn-danger sa-btn-small"
              onClick={anonymise}
              disabled={busy || confirm !== 'ANONYMISE'}
            >
              {busy ? 'Anonymising…' : 'Anonymise account'}
            </button>
            <button
              type="button"
              className="sa-btn sa-btn-quiet sa-btn-small"
              onClick={() => setMode('idle')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="sa-error">{error}</p> : null}
      {notice ? <p className="sa-success">{notice}</p> : null}
    </div>
  );
}

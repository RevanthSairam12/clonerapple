'use client';

import { useState } from 'react';

interface Props {
  customerId: string;
  field: 'email' | 'phone';
  label: string;
  masked: string;
  endpoint?: string;
}

/**
 * Owner-only reveal control for one masked field.
 *
 * The reason is mandatory client-side and enforced again server-side; the
 * server records who revealed which field and why (never the value).
 */
export function CustomerRevealForm({ customerId, field, label, masked, endpoint }: Props) {
  const [reason, setReason] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const inputId = `reveal-reason-${field}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError('');

    try {
      const res = await fetch(
        endpoint ?? `/api/store-admin/customers/${encodeURIComponent(customerId)}/reveal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field, reason }),
        },
      );

      const json = (await res.json().catch(() => ({}))) as {
        value?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? 'Could not reveal this field.');
        return;
      }

      setValue(json.value ?? '');
      setReason('');
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sa-reveal" onSubmit={handleSubmit}>
      <div className="sa-reveal-head">
        <span className="sa-label">{label}</span>
        <span className="sa-mono sa-masked">{masked}</span>
      </div>

      {value ? (
        <p className="sa-revealed" aria-live="polite">
          <span className="sa-mono">{value}</span>
          <button
            type="button"
            className="sa-btn sa-btn-quiet sa-btn-small"
            onClick={() => setValue('')}
          >
            Hide
          </button>
        </p>
      ) : null}

      <label className="sa-label" htmlFor={inputId}>
        Reason (required)
      </label>
      <input
        id={inputId}
        className="sa-input"
        type="text"
        name="reason"
        required
        minLength={10}
        maxLength={200}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="e.g. Verifying a support request"
        disabled={busy}
      />

      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="sa-btn sa-btn-quiet" disabled={busy}>
        {busy ? 'Revealing…' : `Reveal ${label.toLowerCase()}`}
      </button>
      <p className="sa-lock-note">
        Every reveal is recorded in the audit log with your account and reason.
      </p>
    </form>
  );
}

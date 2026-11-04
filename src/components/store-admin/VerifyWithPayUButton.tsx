'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  txnid: string;
  canVerify: boolean;
}

/**
 * Ask PayU what it thinks of this order, right now.
 *
 * The server runs the shared payment processor, so this button can settle an
 * order whose callback never arrived. It never starts a charge and never
 * refunds; a mismatch flags the order for review instead of marking it paid.
 */
export function VerifyWithPayUButton({ txnid, canVerify }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canVerify) {
    return <span className="sa-note">Owner or admin access required</span>;
  }

  async function verify() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/orders/${encodeURIComponent(txnid)}/verify`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'PayU could not be reached.',
        );
      }
      setMessage(
        body.status === 'PAID'
          ? 'PayU confirmed the payment. The order is now marked paid.'
          : `PayU reports ${String(body.status ?? 'no change')}. The order was not marked paid.`,
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'PayU could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="sa-inline-actions">
      <button
        type="button"
        className="sa-btn sa-btn-quiet sa-btn-small"
        disabled={busy}
        onClick={() => void verify()}
      >
        {busy ? 'Asking PayU…' : 'Verify with PayU'}
      </button>
      {message ? <span className="sa-note" role="status">{message}</span> : null}      {error ? <span className="sa-error" role="alert">{error}</span> : null}
    </span>
  );
}

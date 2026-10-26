'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  txnid: string;
  canReview: boolean;
}

/**
 * Clear the "captured payment needs attention" flag after a human has handled
 * the stock and any refund outside this screen. It moves no money.
 */
export function PaymentReviewFlagActions({ txnid, canReview }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canReview) {
    return <span className="sa-note">Owner or admin access required</span>;
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/store-admin/payments/review-flag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txnid }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'The review flag could not be cleared.');
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The review flag could not be cleared.');
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
        onClick={() => void clear()}
      >
        {busy ? 'Working…' : 'Mark reviewed'}
      </button>
      {error ? <span className="sa-error" role="alert">{error}</span> : null}
    </span>
  );
}

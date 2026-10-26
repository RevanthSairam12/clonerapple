'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Put one terminal FAILED outbox row back in the queue. */
export function NotificationRetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/store-admin/settings/notifications/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The message could not be retried.');
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The message could not be retried.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="sa-inline-actions">
      <button className="sa-btn sa-btn-quiet sa-btn-small" type="button" onClick={() => void retry()} disabled={busy}>
        {busy ? 'Retrying…' : 'Retry'}
      </button>
      {error ? <span className="sa-error" role="alert">{error}</span> : null}
    </span>
  );
}

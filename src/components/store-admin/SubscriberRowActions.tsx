'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SubscriberRowActions({
  subscriberId,
  subscribed,
}: {
  subscriberId: string;
  subscribed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'unsubscribe' | 'resubscribe') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/subscribers/${encodeURIComponent(subscriberId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'The subscriber could not be updated.');
        return;
      }
      router.refresh();
    } catch {
      setError('The subscriber could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="sa-inline-actions">
      <button
        type="button"
        className="sa-btn sa-btn-quiet sa-btn-small"
        onClick={() => act(subscribed ? 'unsubscribe' : 'resubscribe')}
        disabled={busy}
      >
        {busy ? 'Saving…' : subscribed ? 'Unsubscribe' : 'Resubscribe'}
      </button>
      {error ? <span className="sa-error">{error}</span> : null}
    </span>
  );
}

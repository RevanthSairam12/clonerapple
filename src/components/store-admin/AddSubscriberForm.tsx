'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AddSubscriberForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'The subscriber could not be saved.');
        return;
      }
      setEmail('');
      setNotice(
        data.status === 'added'
          ? 'Subscriber added.'
          : data.status === 'unsubscribed'
            ? 'That address is on the list but has unsubscribed. They must opt in again.'
            : 'That address is already subscribed.',
      );
      router.refresh();
    } catch {
      setError('The subscriber could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-control-card">
      <p className="sa-control-title">Add a subscriber</p>
      <p className="sa-hint">
        Use this for consent captured away from the site, such as an in-store
        sign-up. An address that unsubscribed stays unsubscribed.
      </p>
      <div className="sa-search-row">
        <input
          className="sa-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          autoComplete="off"
        />
        <button
          type="button"
          className="sa-btn sa-btn-primary sa-btn-small"
          onClick={add}
          disabled={busy || email.trim() === ''}
        >
          {busy ? 'Adding…' : 'Add subscriber'}
        </button>
      </div>
      {error ? <p className="sa-error">{error}</p> : null}
      {notice ? <p className="sa-success">{notice}</p> : null}
    </div>
  );
}

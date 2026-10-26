'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface SavedViewChip {
  id: string;
  name: string;
  query: string;
}

interface Props {
  initialViews: SavedViewChip[];
  /** Canonical query for the filters currently applied; empty when none. */
  currentQuery: string;
}

function makeId(): string {
  try {
    return `view_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  } catch {
    return `view_${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Chips above the orders table that apply a stored filter set. Views are saved
 * server-side against the staff member's own preferences row, so they follow
 * them to another browser. "Save current view" is only offered when at least
 * one filter is applied.
 */
export function SavedViews({ initialViews, currentQuery }: Props) {
  const router = useRouter();
  const [views, setViews] = useState<SavedViewChip[]>(initialViews);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function persist(next: SavedViewChip[], successMessage: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/preferences/saved-views', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ views: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'The view could not be saved.');
      }
      setViews(Array.isArray(body.views) ? body.views : next);
      setMessage(successMessage);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The view could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function saveCurrent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !currentQuery) return;
    if (views.some((view) => view.query === currentQuery)) {
      setError('These filters are already saved.');
      return;
    }
    const next = [...views, { id: makeId(), name: trimmed.slice(0, 28), query: currentQuery }];
    setName('');
    setOpen(false);
    void persist(next, `Saved “${trimmed.slice(0, 28)}”.`);
  }

  function remove(view: SavedViewChip) {
    void persist(
      views.filter((entry) => entry.id !== view.id),
      `Removed “${view.name}”.`,
    );
  }

  return (
    <div className="sa-saved-views">
      <div className="sa-saved-views-row">
        <span className="sa-saved-views-label">Saved views</span>
        {views.length ? (
          views.map((view) => (
            <span
              className={`sa-view-chip${view.query === currentQuery ? ' is-active' : ''}`}
              key={view.id}
            >
              <Link
                href={`/store-admin/orders?${view.query}`}
                aria-current={view.query === currentQuery ? 'page' : undefined}
              >
                {view.name}
              </Link>
              <button
                type="button"
                onClick={() => remove(view)}
                disabled={busy}
                aria-label={`Delete saved view ${view.name}`}
                title="Delete this view"
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="sa-saved-views-empty">No saved views yet — apply filters, then save them.</span>
        )}

        {currentQuery ? (
          <button
            type="button"
            className="sa-view-save"
            onClick={() => {
              setOpen((current) => !current);
              setError(null);
              setMessage(null);
            }}
            aria-expanded={open}
          >
            {open ? 'Cancel' : '+ Save current view'}
          </button>
        ) : null}
      </div>

      {open && currentQuery ? (
        <form className="sa-view-form" onSubmit={saveCurrent}>
          <label className="sa-field">
            <span className="sa-label">View name</span>
            <input
              className="sa-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={28}
              placeholder="e.g. Unpaid POS orders"
              required
              autoFocus
            />
          </label>
          <button className="sa-btn sa-btn-primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save view'}
          </button>
        </form>
      ) : null}

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-success" role="status">{message}</p> : null}
    </div>
  );
}

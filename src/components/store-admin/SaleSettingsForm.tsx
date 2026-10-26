'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  timezone: string;
  canEdit: boolean;
}

/**
 * The sale switch and its optional window.
 *
 * The browser sends store-local wall-clock values; the server converts them
 * with the store timezone and PostgreSQL decides the status. A browser clock
 * that is wrong cannot start or extend a sale.
 */
export function SaleSettingsForm({ enabled, startsAt, endsAt, timezone, canEdit }: Props) {
  const router = useRouter();
  const [isOn, setIsOn] = useState(enabled);
  const [start, setStart] = useState(startsAt);
  const [end, setEnd] = useState(endsAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/sale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: isOn,
          startsAt: start || null,
          endsAt: end || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save sale settings.');
      }
      setNotice(
        `Saved. Status is ${String(body.state?.status ?? 'off').toUpperCase()} on the database clock.`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save sale settings.');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <dl className="sa-meta">
        <div>
          <dt>Mode</dt>
          <dd>{enabled ? 'On' : 'Off'}</dd>
        </div>
        <div>
          <dt>Window starts</dt>
          <dd>{startsAt || '—'}</dd>
        </div>
        <div>
          <dt>Window ends</dt>
          <dd>{endsAt || '—'}</dd>
        </div>
        <div>
          <dt>Store timezone</dt>
          <dd>{timezone}</dd>
        </div>
      </dl>
    );
  }

  return (
    <>
      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="sa-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">Sale mode</span>
          <span className="sa-checkbox">
            <input
              type="checkbox"
              checked={isOn}
              onChange={(event) => setIsOn(event.target.checked)}
            />
            <span>{isOn ? 'On — sale prices apply while the window allows' : 'Off — regular prices only'}</span>
          </span>
        </label>
        <label className="sa-field">
          <span className="sa-label">
            Starts <span className="sa-hint">{timezone}, optional</span>
          </span>
          <input
            className="sa-input"
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">
            Ends <span className="sa-hint">{timezone}, optional</span>
          </span>
          <input
            className="sa-input"
            type="datetime-local"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
      </div>

      <div className="sa-inline-actions">
        <button className="sa-btn sa-btn-primary" type="button" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save sale mode'}
        </button>
      </div>
      <p className="sa-card-note">
        Sale prices are stored per product all year and apply only while the mode is on
        and the database clock is inside the window. No window means the switch alone
        decides. Times are in {timezone}.
      </p>
    </>
  );
}

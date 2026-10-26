'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AccountSession } from '@/lib/store-admin/customer-accounts';

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN');
}

export function SessionRevoker({
  customerId,
  sessions,
  canEdit,
}: {
  customerId: string;
  sessions: AccountSession[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(body: { sessionId?: string; all?: boolean }, key: string) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/customers/${encodeURIComponent(customerId)}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'The sessions could not be revoked.');
        return;
      }
      router.refresh();
    } catch {
      setError('The sessions could not be revoked.');
    } finally {
      setBusy(null);
    }
  }

  if (sessions.length === 0) {
    return <p className="sa-empty">No active or stored sessions.</p>;
  }

  return (
    <div>
      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Signed in</th>
              <th>Expires</th>
              <th className="sa-num">State</th>
              {canEdit ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  {session.device}
                  <span className="sa-row-sub sa-mono">{session.id}</span>
                </td>
                <td className="sa-date">{when(session.createdAt)}</td>
                <td className="sa-date">{when(session.expiresAt)}</td>
                <td className="sa-num">
                  <span className={session.expired ? 'sa-status' : 'sa-status sa-status-on'}>
                    {session.expired ? 'Expired' : 'Active'}
                  </span>
                </td>
                {canEdit ? (
                  <td>
                    <button
                      type="button"
                      className="sa-btn sa-btn-quiet sa-btn-small"
                      onClick={() => revoke({ sessionId: session.id }, session.id)}
                      disabled={busy !== null}
                    >
                      {busy === session.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="sa-inline-actions">
          <button
            type="button"
            className="sa-btn sa-btn-danger sa-btn-small"
            onClick={() => revoke({ all: true }, 'all')}
            disabled={busy !== null}
          >
            {busy === 'all' ? 'Revoking…' : 'Revoke every session'}
          </button>
          {error ? <span className="sa-error">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { SiteAddressHealthResult } from '@/lib/payu/config';

export function SiteAddressCheckCard({ isOwner }: { isOwner: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SiteAddressHealthResult | null>(null);
  const [error, setError] = useState('');

  if (!isOwner) return null;

  async function runCheck() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/store-admin/site-address-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not run site address check.');
        setResult(null);
      } else {
        setResult(data as SiteAddressHealthResult);
      }
    } catch {
      setError('Network error while checking site address.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-detail-card">
      <div className="sa-detail-head">
        <h2>Site address health check (APP_BASE_URL)</h2>
        <button
          type="button"
          className="sa-btn sa-btn-secondary"
          onClick={runCheck}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Check site address'}
        </button>
      </div>
      <p className="sa-note">
        Probes the configured <code>APP_BASE_URL</code> to confirm that PayU browser callbacks and
        webhooks can reach this store over public HTTPS and that production mode is not pointed at a
        temporary tunnel host.
      </p>
      {error ? (
        <p className="sa-notice" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <table className="sa-table">
          <tbody>
            <tr>
              <th>Reachable</th>
              <td>
                <span className={result.reachable ? 'sa-status sa-status-on' : 'sa-status sa-status-danger'}>
                  {result.reachable
                    ? `Yes${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}`
                    : `No${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}`}
                </span>
              </td>
            </tr>
            <tr>
              <th>HTTPS</th>
              <td>
                <span className={result.https ? 'sa-status sa-status-on' : 'sa-status sa-status-danger'}>
                  {result.https ? 'HTTPS' : 'Not HTTPS'}
                </span>
              </td>
            </tr>
            <tr>
              <th>Host type</th>
              <td>
                <span className={result.isTunnel ? 'sa-status sa-status-warn' : 'sa-status sa-status-on'}>
                  {result.isTunnel
                    ? 'Temporary tunnel host (test mode only)'
                    : result.isLocalhost
                      ? 'Localhost (local browser only)'
                      : 'Permanent host'}
                </span>
              </td>
            </tr>
            <tr>
              <th>Production ready</th>
              <td>
                <span className={result.productionReady ? 'sa-status sa-status-on' : 'sa-status sa-status-warn'}>
                  {result.productionReady ? 'Ready' : 'Not ready for production'}
                </span>
              </td>
            </tr>
            <tr>
              <th>Summary</th>
              <td>{result.message}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

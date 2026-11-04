'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Bulk sale prices across the whole catalogue. Percent-off is applied to the
 * regular price on the server; clearing removes every stored sale price. Both
 * actions are audited and write price history for each changed product.
 */
export function SaleBulkActions({ productCount }: { productCount: number }) {
  const router = useRouter();
  const [percent, setPercent] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(body: { action: 'percent'; percent: number } | { action: 'clear' }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/sale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The bulk action failed.');
      }
      const changed = Number(payload.changed ?? 0);
      const skipped = Number(payload.skipped ?? 0);
      const skippedNote = skipped > 0 ? ` ${skipped} product${skipped === 1 ? '' : 's'} skipped (no usable price).` : '';
      setNotice(
        changed === 0
          ? `No sale prices changed.${skippedNote}`
          : body.action === 'clear'
            ? `Cleared ${changed} sale price${changed === 1 ? '' : 's'}.${skippedNote}`
            : `Set sale prices on ${changed} product${changed === 1 ? '' : 's'}.${skippedNote}`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The bulk action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function applyPercent() {
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 1 || value > 95) {
      setError('Enter a whole percent between 1 and 95.');
      return;
    }
    await run({ action: 'percent', percent: value });
  }

  async function clearAll() {
    if (
      !window.confirm(
        `Clear the sale price on every product? This affects all ${productCount} products in the catalogue.`,
      )
    ) {
      return;
    }
    await run({ action: 'clear' });
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Bulk product-default sale prices</h2>
      <p className="sa-card-note">These actions change product defaults only, not option sale prices. Options with their own regular price do not inherit the product sale price.</p>

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
          <span className="sa-label">
            Percent off <span className="sa-hint">applied to the regular price</span>
          </span>
          <input
            className="sa-input"
            type="number"
            min={1}
            max={95}
            step={1}
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
          />
        </label>
      </div>

      <div className="sa-inline-actions">
        <button className="sa-btn sa-btn-primary" type="button" disabled={busy} onClick={applyPercent}>
          {busy ? 'Working…' : 'Set sale prices'}
        </button>
        <button className="sa-btn sa-btn-ghost" type="button" disabled={busy} onClick={clearAll}>
          Clear all sale prices
        </button>
      </div>
      <p className="sa-card-note">
        Every changed product records a `sale` or `sale_cleared` price-history row. The
        storefront and checkout both read the result on the next request.
      </p>
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  productId: string;
  onHand: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  canEdit: boolean;
}

/**
 * Stock settings and manual adjustments. Adjustments always write a
 * `stock_movements` row, so the count can be explained after the fact.
 */
export function StockControls({
  productId,
  onHand,
  lowStockThreshold,
  trackInventory,
  canEdit,
}: Props) {
  const router = useRouter();
  const [tracking, setTracking] = useState(trackInventory);
  const [threshold, setThreshold] = useState(String(lowStockThreshold));
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('receipt');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function saveSettings() {
    setBusy('settings');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/stock/${encodeURIComponent(productId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            trackInventory: tracking,
            lowStockThreshold: Number(threshold || 0),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the stock settings.');
      }
      setNotice('Stock settings saved.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the stock settings.');
    } finally {
      setBusy(null);
    }
  }

  async function adjust() {
    setBusy('adjust');
    setError(null);
    setNotice(null);
    try {
      const value = Number(delta);
      if (!Number.isInteger(value) || value === 0) {
        throw new Error('Enter a whole number of units to add or remove.');
      }
      const response = await fetch(
        `/api/store-admin/stock/${encodeURIComponent(productId)}/adjust`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ delta: value, reason, note }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not adjust stock.');
      }
      setNotice('Stock adjusted.');
      setDelta('');
      setNote('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not adjust stock.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Stock controls</h2>

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

      {canEdit ? (
        <>
          <div className="sa-control-grid">
            <label className="sa-check">
              <input
                type="checkbox"
                checked={tracking}
                onChange={(event) => setTracking(event.target.checked)}
              />
              Track inventory
            </label>
            <label className="sa-field">
              <span className="sa-label">Low-stock threshold</span>
              <input
                className="sa-input"
                type="number"
                min={0}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </label>
          </div>
          <div className="sa-inline-actions">
            <button
              className="sa-btn sa-btn-small"
              type="button"
              disabled={busy === 'settings'}
              onClick={saveSettings}
            >
              {busy === 'settings' ? 'Saving…' : 'Save settings'}
            </button>
          </div>

          <h3 className="sa-control-title">Adjust count</h3>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">
                Units <span className="sa-hint">negative removes stock</span>
              </span>
              <input
                className="sa-input"
                type="number"
                step={1}
                placeholder="10"
                value={delta}
                onChange={(event) => setDelta(event.target.value)}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Reason</span>
              <select
                className="sa-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="receipt">Receipt</option>
                <option value="adjustment">Adjustment</option>
                <option value="damage">Damage</option>
              </select>
            </label>
            <label className="sa-field sa-field-wide">
              <span className="sa-label">Note</span>
              <input
                className="sa-input"
                maxLength={200}
                placeholder="Two units damaged in transit"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          <div className="sa-inline-actions">
            <button
              className="sa-btn sa-btn-primary"
              type="button"
              disabled={busy === 'adjust' || !tracking || onHand === undefined}
              onClick={adjust}
            >
              {busy === 'adjust' ? 'Adjusting…' : 'Apply adjustment'}
            </button>
          </div>
          {!tracking ? (
            <p className="sa-lock-note">
              Turn on stock tracking before adjusting counts; checkout ignores
              stock while it is off.
            </p>
          ) : null}
        </>
      ) : (
        <p className="sa-lock-note">Only an owner or admin can change stock.</p>
      )}
    </section>
  );
}

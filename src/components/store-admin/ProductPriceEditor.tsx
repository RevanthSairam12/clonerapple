'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  productId: string;
  pricePaise: number;
  compareAtPaise: number | null;
  canEdit: boolean;
}

function toRupees(paise: number | null): string {
  return paise === null ? '' : (paise / 100).toFixed(2);
}

/**
 * Price editing. The API appends every change to `price_history`, which is
 * append-only at the database level, so nothing here can rewrite history.
 */
export function ProductPriceEditor({ productId, pricePaise, compareAtPaise, canEdit }: Props) {
  const router = useRouter();
  const [price, setPrice] = useState(toRupees(pricePaise));
  const [compareAt, setCompareAt] = useState(toRupees(compareAtPaise));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const priceValue = Math.round(Number(price) * 100);
      if (!Number.isInteger(priceValue) || priceValue <= 0) {
        throw new Error('Enter a selling price above zero.');
      }
      let compareValue: number | null = null;
      if (compareAt.trim()) {
        compareValue = Math.round(Number(compareAt) * 100);
        if (!Number.isFinite(compareValue) || compareValue <= 0) {
          throw new Error('The compare-at price must be a positive amount, or blank.');
        }
      }

      const response = await fetch(
        `/api/store-admin/catalog/products/${encodeURIComponent(productId)}/price`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pricePaise: priceValue,
            compareAtPaise: compareValue,
            reason: reason.trim() || undefined,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the price.');
      }
      setNotice(body.changed ? 'Price saved and recorded in the history.' : 'No change.');
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the price.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-detail-card sa-price-card">
      <h2 className="sa-card-title">Price</h2>

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
            <label className="sa-field">
              <span className="sa-label">Selling price ₹</span>
              <input
                className="sa-input"
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">
                Compare-at ₹ <span className="sa-hint">blank clears it</span>
              </span>
              <input
                className="sa-input"
                type="number"
                min={0}
                step="0.01"
                value={compareAt}
                onChange={(event) => setCompareAt(event.target.value)}
              />
            </label>
            <label className="sa-field sa-field-wide">
              <span className="sa-label">
                Reason <span className="sa-hint">stored in the audit trail</span>
              </span>
              <input
                className="sa-input"
                maxLength={200}
                placeholder="Supplier price drop"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <div className="sa-inline-actions">
            <button
              className="sa-btn sa-btn-primary"
              type="button"
              disabled={busy}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save price'}
            </button>
          </div>
          <p className="sa-card-note">
            Checkout charges the price stored here. Every change appends a row to
            the immutable history below.
          </p>
        </>
      ) : (
        <dl className="sa-meta">
          <div>
            <dt>Selling price</dt>
            <dd>₹{(pricePaise / 100).toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt>Compare-at</dt>
            <dd>
              {compareAtPaise === null
                ? '—'
                : `₹${(compareAtPaise / 100).toLocaleString('en-IN')}`}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

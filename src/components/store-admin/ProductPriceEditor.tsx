'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  productId: string;
  pricePaise: number;
  salePricePaise: number | null;
  compareAtPaise: number | null;
  /** True when sale mode is live on the database clock right now. */
  saleLive: boolean;
  canEdit: boolean;
}

function toRupees(paise: number | null): string {
  return paise === null ? '' : (paise / 100).toFixed(2);
}

/**
 * Price editing. The API appends every change to `price_history`, which is
 * append-only at the database level, so nothing here can rewrite history.
 *
 * The sale price is stored all year and applies only while sale mode is live
 * (see /store-admin/sale). Clearing the field clears the sale price; the
 * regular selling price is always what the customer falls back to.
 */
export function ProductPriceEditor({
  productId,
  pricePaise,
  salePricePaise,
  compareAtPaise,
  saleLive,
  canEdit,
}: Props) {
  const router = useRouter();
  const [price, setPrice] = useState(toRupees(pricePaise));
  const [sale, setSale] = useState(toRupees(salePricePaise));
  const [compareAt, setCompareAt] = useState(toRupees(compareAtPaise));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setWarnings([]);
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
      let saleValue: number | null = null;
      if (sale.trim()) {
        saleValue = Math.round(Number(sale) * 100);
        if (!Number.isFinite(saleValue) || saleValue <= 0) {
          throw new Error('The sale price must be a positive amount, or blank.');
        }
        if (saleValue >= priceValue) {
          throw new Error('The sale price must be lower than the selling price.');
        }
      }

      const response = await fetch(
        `/api/store-admin/catalog/products/${encodeURIComponent(productId)}/price`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pricePaise: priceValue,
            salePricePaise: saleValue,
            compareAtPaise: compareValue,
            reason: reason.trim() || undefined,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the price.');
      }
      if (Array.isArray(body.warnings)) {
        setWarnings(body.warnings.filter((entry: unknown) => typeof entry === 'string'));
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
      {warnings.map((warning) => (
        <p className="sa-warning" role="status" key={warning}>
          {warning}
        </p>
      ))}

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
                Sale price ₹{' '}
                <span className="sa-hint">
                  {saleLive ? 'sale is live' : 'applies only while Sale mode is on'}
                </span>
              </span>
              <input
                className="sa-input"
                type="number"
                min={0}
                step="0.01"
                value={sale}
                onChange={(event) => setSale(event.target.value)}
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
            the immutable history below; a blank sale price clears it. While sale
            mode is off the selling price is charged even if a sale price is set.
          </p>
        </>
      ) : (
        <dl className="sa-meta">
          <div>
            <dt>Selling price</dt>
            <dd>₹{(pricePaise / 100).toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt>Sale price</dt>
            <dd>
              {salePricePaise === null
                ? '—'
                : `₹${(salePricePaise / 100).toLocaleString('en-IN')}${saleLive ? ' (live)' : ''}`}
            </dd>
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

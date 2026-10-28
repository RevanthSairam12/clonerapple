'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  MAX_PRICE_PAISE,
  formatRupees,
  parseRupeesToPaise,
  salePriceProblem,
} from '@/lib/store-admin/money';

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
      const parsedPrice = parseRupeesToPaise(price);
      if (!parsedPrice.ok) throw new Error(parsedPrice.message);
      if (parsedPrice.paise === null || parsedPrice.paise <= 0) {
        throw new Error('Selling price must be a positive amount above zero.');
      }
      if (parsedPrice.paise > MAX_PRICE_PAISE) {
        throw new Error(`Selling price must be ${formatRupees(MAX_PRICE_PAISE)} or less.`);
      }
      const priceValue = parsedPrice.paise;

      let compareValue: number | null = null;
      const parsedCompare = parseRupeesToPaise(compareAt);
      if (!parsedCompare.ok) throw new Error(parsedCompare.message);
      if (parsedCompare.paise !== null) {
        if (parsedCompare.paise <= 0) {
          throw new Error('Compare-at price must be above zero, or blank.');
        }
        if (parsedCompare.paise > MAX_PRICE_PAISE) {
          throw new Error(`Compare-at price must be ${formatRupees(MAX_PRICE_PAISE)} or less.`);
        }
        if (parsedCompare.paise < priceValue) {
          throw new Error(
            `Compare-at price must be at least the selling price (${formatRupees(priceValue)}).`,
          );
        }
        compareValue = parsedCompare.paise;
      }

      let saleValue: number | null = null;
      const parsedSale = parseRupeesToPaise(sale);
      if (!parsedSale.ok) throw new Error(parsedSale.message);
      if (parsedSale.paise !== null) {
        const problem = salePriceProblem(parsedSale.paise, priceValue);
        if (problem) throw new Error(problem);
        saleValue = parsedSale.paise;
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

      setPrice((priceValue / 100).toFixed(2));
      setCompareAt(compareValue === null ? '' : (compareValue / 100).toFixed(2));
      setSale(saleValue === null ? '' : (saleValue / 100).toFixed(2));

      if (!body.changed) {
        setNotice('No change.');
      } else if (saleValue !== null && saleValue !== salePricePaise) {
        setNotice(`Sale price saved: ${formatRupees(saleValue)}.`);
      } else if (saleValue === null && salePricePaise !== null) {
        setNotice('Sale price cleared.');
      } else {
        setNotice('Price saved and recorded in the history.');
      }
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
          Saved with a warning: {warning}
        </p>
      ))}

      {canEdit ? (
        <>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Selling price ₹</span>
              <input
                className="sa-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="1499.00"
                value={price}
                disabled={busy}
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
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="1299.50"
                value={sale}
                disabled={busy}
                onChange={(event) => setSale(event.target.value)}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">
                Compare-at ₹ <span className="sa-hint">blank clears it</span>
              </span>
              <input
                className="sa-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="1599.00"
                value={compareAt}
                disabled={busy}
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

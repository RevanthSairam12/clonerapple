'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface StockValues {
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  trackInventory: boolean;
}

interface Props {
  productId: string;
  stock: StockValues | null;
  canEdit: boolean;
}

/**
 * The Inventory section on the product page. Counts move only through
 * `stock_movements`: the first save for a product without a stock row records
 * the opening count as a receipt, and later corrections go through the stock
 * detail page so the append-only log stays complete.
 */
export function ProductInventoryCard({ productId, stock, canEdit }: Props) {
  const router = useRouter();
  const [tracking, setTracking] = useState(stock?.trackInventory ?? false);
  const [threshold, setThreshold] = useState(String(stock?.lowStockThreshold ?? 0));
  const [openingOnHand, setOpeningOnHand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const available = stock ? Math.max(0, stock.onHand - stock.reserved) : null;
  const needsOpeningCount = stock === null && tracking;

  async function save() {
    setError(null);
    setNotice(null);

    if (stock && stock.trackInventory && !tracking) {
      const confirmed = window.confirm(
        'Turn off stock tracking? Checkout will stop checking stock for this '
          + 'product, so it can be oversold. Continue?',
      );
      if (!confirmed) return;
    }

    let onHand: number | undefined;
    if (needsOpeningCount) {
      onHand = Number(openingOnHand);
      if (!Number.isInteger(onHand) || onHand < 0) {
        setError('Enter the current on-hand count as a whole number.');
        return;
      }
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/store-admin/stock/${encodeURIComponent(productId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            trackInventory: tracking,
            lowStockThreshold: Number(threshold || 0),
            ...(onHand === undefined ? {} : { onHand }),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not save the inventory settings.',
        );
      }
      setNotice(
        body?.stock?.movementId > 0
          ? 'Inventory saved. The opening count was recorded as a stock movement.'
          : 'Inventory settings saved.',
      );
      setOpeningOnHand('');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save the inventory settings.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Inventory</h2>

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

      <dl className="sa-meta">
        <div>
          <dt>On hand</dt>
          <dd>{stock ? stock.onHand : '—'}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{stock ? stock.reserved : '—'}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{available === null ? '—' : available}</dd>
        </div>
        <div>
          <dt>Tracking</dt>
          <dd>{stock?.trackInventory ? 'Enabled' : 'Off'}</dd>
        </div>
      </dl>

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
            {needsOpeningCount ? (
              <label className="sa-field">
                <span className="sa-label">
                  Current on hand <span className="sa-hint">required to start tracking</span>
                </span>
                <input
                  className="sa-input"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={openingOnHand}
                  onChange={(event) => setOpeningOnHand(event.target.value)}
                />
              </label>
            ) : null}
          </div>

          {!tracking ? (
            <p className="sa-lock-note">
              Tracking is off: checkout ignores stock and this product can be
              oversold.
            </p>
          ) : null}

          <div className="sa-inline-actions">
            <button
              className="sa-btn sa-btn-small"
              type="button"
              disabled={busy}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save inventory'}
            </button>
          </div>
        </>
      ) : (
        <p className="sa-lock-note">Only an owner or admin can change inventory.</p>
      )}

      <div className="sa-inline-actions">
        <Link
          className="sa-btn sa-btn-small"
          href={`/store-admin/stock/${encodeURIComponent(productId)}`}
        >
          Adjust stock
        </Link>
      </div>
    </section>
  );
}

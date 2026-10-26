'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { discountPercent } from '@/lib/storefront/pricing';

interface Props {
  productId: string;
  name: string;
  pricePaise: number;
  priceLabel: string;
  salePricePaise: number | null;
  regularSaleLabel: string | null;
  tracked: boolean;
  availableLabel: string;
  lowStock: boolean;
  isActive: boolean;
}

/**
 * One sale-table row. The sale price is editable inline and goes through the
 * same price API as the product page, so it gets the same validation, audit
 * and `price_history` row.
 */
export function SaleProductRow({
  productId,
  name,
  pricePaise,
  priceLabel,
  salePricePaise,
  regularSaleLabel,
  tracked,
  availableLabel,
  lowStock,
  isActive,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(
    salePricePaise === null ? '' : (salePricePaise / 100).toFixed(2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const discount = salePricePaise === null ? 0 : discountPercent(pricePaise, salePricePaise);

  async function save() {
    setBusy(true);
    setError(null);
    setWarning(null);
    setSaved(false);
    try {
      let next: number | null = null;
      if (value.trim()) {
        next = Math.round(Number(value) * 100);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('Enter a positive amount, or blank to clear.');
        }
        if (next >= pricePaise) {
          throw new Error('The sale price must be lower than the regular price.');
        }
      }
      const response = await fetch(
        `/api/store-admin/catalog/products/${encodeURIComponent(productId)}/price`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ salePricePaise: next }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the sale price.');
      }
      if (Array.isArray(body.warnings) && typeof body.warnings[0] === 'string') {
        setWarning(body.warnings[0]);
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the sale price.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <Link className="sa-product-link" href={`/store-admin/products/${encodeURIComponent(productId)}`}>
          {name}
        </Link>
        {!isActive ? <span className="sa-row-sub">Inactive</span> : null}
        {error ? <span className="sa-row-sub sa-row-error">{error}</span> : null}
        {warning ? <span className="sa-row-sub">{warning}</span> : null}
        {saved && !warning && !error ? <span className="sa-row-sub">Saved</span> : null}
      </td>
      <td className="sa-num">{priceLabel}</td>
      <td className="sa-num">
        <div className="sa-sale-input">
          <span>₹</span>
          <input
            className="sa-input"
            type="number"
            min={0}
            step="0.01"
            placeholder="—"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={`Sale price for ${name}`}
          />
          <button className="sa-btn sa-btn-small" type="button" disabled={busy} onClick={save}>
            {busy ? '…' : 'Save'}
          </button>
        </div>
        {salePricePaise !== null ? (
          <span className="sa-row-sub">Stored {regularSaleLabel}</span>
        ) : null}
      </td>
      <td className="sa-num">{discount > 0 ? `${discount}%` : '—'}</td>
      <td>
        {tracked ? (
          <span className="sa-status sa-status-on">Tracked</span>
        ) : (
          <span className="sa-status sa-status-warn">Off</span>
        )}
      </td>
      <td className="sa-num">
        {!tracked ? (
          <span className="sa-muted">—</span>
        ) : lowStock ? (
          <span className="sa-status sa-status-warn">{availableLabel}</span>
        ) : (
          availableLabel
        )}
      </td>
      <td>
        <Link className="sa-link" href={`/store-admin/stock/${encodeURIComponent(productId)}`}>
          Adjust
        </Link>
      </td>
    </tr>
  );
}

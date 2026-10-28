'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  formatRupees,
  parseRupeesToPaise,
  salePriceProblem,
} from '@/lib/store-admin/money';
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
  /** Viewers see the stored sale price but get no editable controls. */
  canEdit: boolean;
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
  canEdit,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(
    salePricePaise === null ? '' : (salePricePaise / 100).toFixed(2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const discount = salePricePaise === null ? 0 : discountPercent(pricePaise, salePricePaise);

  async function save() {
    setBusy(true);
    setError(null);
    setWarning(null);
    setSaved(null);
    try {
      const parsed = parseRupeesToPaise(value);
      if (!parsed.ok) throw new Error(parsed.message);
      const next = parsed.paise;
      if (next !== null) {
        const problem = salePriceProblem(next, pricePaise);
        if (problem) throw new Error(problem);
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
      setValue(next === null ? '' : (next / 100).toFixed(2));
      setSaved(
        next === null
          ? 'Sale price cleared.'
          : `Sale price saved: ${formatRupees(next)}.`,
      );
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
        {error ? (
          <span className="sa-row-sub sa-row-error" role="alert">
            {error}
          </span>
        ) : null}
        {saved ? (
          <span className="sa-row-sub">
            {saved}
            {warning ? ` ${warning}` : ''}
          </span>
        ) : null}
      </td>
      <td className="sa-num">{priceLabel}</td>
      <td className="sa-num">
        {canEdit ? (
          <>
            <div className="sa-sale-input">
              <span>₹</span>
              <input
                className="sa-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="—"
                value={value}
                disabled={busy}
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
          </>
        ) : (
          <span className="sa-price">{regularSaleLabel ?? '—'}</span>
        )}
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

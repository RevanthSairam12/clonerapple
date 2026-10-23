'use client';

import { useMemo, useState } from 'react';

import type { PosCatalogProduct } from '@/lib/store-admin/pos';
import { posMethodNeedsReference, type PosPaymentMethod } from '@/lib/store-admin/pos-rules';
import { formatPaise } from '@/lib/store-admin/amount';

interface Props {
  products: PosCatalogProduct[];
  canSell: boolean;
  shiftOpen: boolean;
}

interface CartLine {
  product: PosCatalogProduct;
  quantity: number;
}

const METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card_machine: 'Card machine',
};

// Catalogue prices are display-only. The server re-prices every sale from the
// products table; this number is never sent as an amount.
function lineTotal(line: CartLine): number {
  return line.product.pricePaise * line.quantity;
}

export function PosTill({ products, canSell, shiftOpen }: Props) {
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PosPaymentMethod>('cash');
  const [providerRef, setProviderRef] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txnid: string; receiptNo: string; totalPaise: number } | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        product.id.toLowerCase().includes(needle),
    );
  }, [products, query]);

  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);

  function add(product: PosCatalogProduct) {
    setResult(null);
    setError(null);
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        if (existing.quantity >= 50) return current;
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function setQuantity(id: string, quantity: number) {
    setLines((current) =>
      current
        .map((line) =>
          line.product.id === id
            ? { ...line, quantity: Math.max(0, Math.min(50, Math.trunc(quantity) || 0)) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/store-admin/pos/sales', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Only ids and quantities travel: the server prices the sale.
          lines: lines.map((line) => ({
            id: line.product.id,
            quantity: line.quantity,
          })),
          method,
          providerRef: posMethodNeedsReference(method) ? providerRef.trim() : null,
          customerPhone: customerPhone.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'The sale could not be recorded.');
      }
      setResult({
        txnid: body.txnid,
        receiptNo: body.receiptNo,
        totalPaise: body.totalPaise,
      });
      setLines([]);
      setProviderRef('');
      setCustomerPhone('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The sale could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  if (!canSell) {
    return (
      <p className="sa-lock-note">
        Viewer access is read-only. Ringing up sales requires store admin or owner access.
      </p>
    );
  }

  return (
    <div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}

      {result ? (
        <div className="sa-notice" role="status">
          Sale recorded — receipt <strong className="sa-mono">{result.receiptNo}</strong> for{' '}
          {formatPaise(result.totalPaise)}.{' '}
          <a className="sa-product-link" href={`/store-admin/pos/receipt/${encodeURIComponent(result.txnid)}`}>
            Open the receipt ↗
          </a>
        </div>
      ) : null}

      {shiftOpen ? null : (
        <p className="sa-notice">
          No open shift. <a className="sa-product-link" href="/store-admin/pos/end-of-day">Open a shift</a> before the
          first sale.
        </p>
      )}

      <div className="sa-detail-grid sa-pos-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Catalogue</h2>
          <label className="sa-field">
            <span className="sa-label">Search products</span>
            <input
              className="sa-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or product id"
            />
          </label>
          <ul className="sa-pos-list">
            {visible.map((product) => (
              <li key={product.id} className="sa-pos-item">
                <button className="sa-pos-add" type="button" onClick={() => add(product)}>
                  <span className="sa-pos-name">{product.name}</span>
                  <span className="sa-pos-price">{formatPaise(product.pricePaise)}</span>
                </button>
                {product.id ? <span className="sa-row-sub sa-mono">{product.id}</span> : null}
                {product.trackInventory && product.onHand !== null && product.onHand <= 0 ? (
                  <span className="sa-no">Out of stock</span>
                ) : null}
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <p className="sa-empty">No products match that search.</p> : null}
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Sale</h2>
          {lines.length === 0 ? (
            <p className="sa-empty">Tap a product to add it.</p>
          ) : (
            <table className="sa-table">
              <thead><tr><th>Item</th><th className="sa-num">Qty</th><th className="sa-num">Total</th></tr></thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.product.id}>
                    <td>{line.product.name}</td>
                    <td className="sa-num">
                      <input
                        className="sa-input sa-qty-input"
                        type="number"
                        min={1}
                        max={50}
                        value={line.quantity}
                        aria-label={`Quantity for ${line.product.name}`}
                        onChange={(event) => setQuantity(line.product.id, Number(event.target.value))}
                      />
                    </td>
                    <td className="sa-num">{formatPaise(lineTotal(line))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <dl className="sa-meta">
            <div><dt>Items</dt><dd>{formatPaise(subtotal)}</dd></div>
            <div><dt>Total</dt><dd><strong>{formatPaise(subtotal)}</strong></dd></div>
          </dl>

          <label className="sa-field">
            <span className="sa-label">Payment method</span>
            <select
              className="sa-input"
              value={method}
              onChange={(event) => setMethod(event.target.value as PosPaymentMethod)}
            >
              {(Object.keys(METHOD_LABELS) as PosPaymentMethod[]).map((key) => (
                <option key={key} value={key}>{METHOD_LABELS[key]}</option>
              ))}
            </select>
          </label>

          {posMethodNeedsReference(method) ? (
            <label className="sa-field">
              <span className="sa-label">
                {method === 'upi' ? 'UPI transaction reference' : 'Card approval reference'}{' '}
                <span className="sa-hint">required</span>
              </span>
              <input
                className="sa-input sa-mono"
                value={providerRef}
                maxLength={64}
                onChange={(event) => setProviderRef(event.target.value)}
                placeholder={method === 'upi' ? 'UPI ref / UTR' : 'Approval code'}
              />
            </label>
          ) : null}

          <label className="sa-field">
            <span className="sa-label">
              Customer phone <span className="sa-hint">optional</span>
            </span>
            <input
              className="sa-input sa-mono"
              value={customerPhone}
              maxLength={20}
              onChange={(event) => setCustomerPhone(event.target.value)}
              placeholder="Optional — stored and shown masked"
            />
          </label>
          <p className="sa-hint">
            The phone is optional, kept for exchanges only, and displayed masked in every list.
          </p>

          <button
            className="sa-btn sa-btn-primary"
            type="button"
            disabled={
              busy ||
              lines.length === 0 ||
              (posMethodNeedsReference(method) && providerRef.trim().length === 0)
            }
            onClick={() => checkout().catch(() => {})}
          >
            {busy ? 'Recording…' : 'Record sale'}
          </button>
        </section>
      </div>
    </div>
  );
}

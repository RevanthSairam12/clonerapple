'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { PosCatalogProduct } from '@/lib/store-admin/pos';
import { posMethodNeedsReference, type PosPaymentMethod } from '@/lib/store-admin/pos-rules';
import { formatPaise } from '@/lib/store-admin/amount';
import { formatRupees, parseRupeesToPaise } from '@/lib/store-admin/money';

interface Props {
  products: PosCatalogProduct[];
  canSell: boolean;
  shiftOpen: boolean;
}

interface CartLine {
  product: PosCatalogProduct;
  quantity: number;
  /** What the cashier typed, in rupees. Starts empty on every new line. */
  price: string;
  freeConfirmed: boolean;
}

const METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card_machine: 'Card machine',
};

/**
 * The till never pre-fills a price. The catalogue shows a list price for
 * reference, and the cashier types what is charged; the server stores exactly
 * that integer paise. Sale mode and the resolver are not consulted here.
 */
function pricePaise(line: CartLine): number | null {
  const parsed = parseRupeesToPaise(line.price);
  return parsed.ok ? parsed.paise : null;
}

function lineTotal(line: CartLine): number {
  const paise = pricePaise(line);
  return paise === null ? 0 : paise * line.quantity;
}

export function PosTill({ products, canSell, shiftOpen }: Props) {
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PosPaymentMethod>('cash');
  const [providerRef, setProviderRef] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ txnid: string; receiptNo: string; totalPaise: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!focusId) return;
    const input = priceRefs.current[focusId];
    if (input) {
      input.focus();
      input.select();
    }
    setFocusId(null);
  }, [focusId, lines]);

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
  const missingPrice = lines.some((line) => pricePaise(line) === null && line.price.trim() === '');
  const invalidPrice = lines.some((line) => pricePaise(line) === null && line.price.trim() !== '');

  function add(product: PosCatalogProduct) {
    setResult(null);
    setError(null);
    setNotice(null);
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        if (existing.quantity >= 50) return current;
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        { product, quantity: 1, price: '', freeConfirmed: false },
      ];
    });
    setFocusId(product.id);
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

  function setPrice(id: string, price: string) {
    setResult(null);
    setError(null);
    setLines((current) =>
      current.map((line) =>
        line.product.id === id ? { ...line, price, freeConfirmed: false } : line,
      ),
    );
  }

  /**
   * Check every line before the request. A blank price blocks the sale with
   * the exact prompt; zero needs one explicit free-item confirmation; a
   * negative or non-numeric value is refused by the shared rupee parser.
   */
  function prepareBasket(): { id: string; quantity: number; unitPricePaise: number }[] | null {
    const prepared: { id: string; quantity: number; unitPricePaise: number }[] = [];
    const confirmedFree: string[] = [];

    for (const line of lines) {
      const parsed = parseRupeesToPaise(line.price);
      if (!parsed.ok) {
        setError(`Enter the selling price for ${line.product.name} in rupees, for example 499.50.`);
        setFocusId(line.product.id);
        return null;
      }
      if (parsed.paise === null) {
        setError(`Enter the selling price for ${line.product.name}.`);
        setFocusId(line.product.id);
        return null;
      }
      if (parsed.paise === 0 && !line.freeConfirmed) {
        const confirmed = window.confirm(
          `${line.product.name} has a price of ₹0.00. Confirm this is a free item.`,
        );
        if (!confirmed) {
          setError('A zero price must be confirmed as a free item before completing the sale.');
          setFocusId(line.product.id);
          return null;
        }
        confirmedFree.push(line.product.id);
      } else if (parsed.paise === 0) {
        confirmedFree.push(line.product.id);
      }
      prepared.push({
        id: line.product.id,
        quantity: line.quantity,
        unitPricePaise: parsed.paise,
      });
    }

    setLines((current) =>
      current.map((line) =>
        confirmedFree.includes(line.product.id) ? { ...line, freeConfirmed: true } : line,
      ),
    );
    return prepared;
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const prepared = prepareBasket();
      if (!prepared) return;

      let confirmUnusualPrices = false;
      for (;;) {
        const response = await fetch('/api/store-admin/pos/sales', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            lines: prepared,
            method,
            providerRef: posMethodNeedsReference(method) ? providerRef.trim() : null,
            customerPhone: customerPhone.trim() || null,
            confirmUnusualPrices,
            confirmedFreeItemIds: prepared
              .filter((line) => line.unitPricePaise === 0)
              .map((line) => line.id),
          }),
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok && body.needsConfirmation && Array.isArray(body.warnings) && !confirmUnusualPrices) {
          const warnings = body.warnings
            .map((warning: { productName?: unknown; message?: unknown }) =>
              `${String(warning.productName ?? 'This item')}: ${String(warning.message ?? '')}`.trim(),
            )
            .join('\n');
          if (window.confirm(`Confirm this price?\n\n${warnings}\n\nPress OK to charge these prices, or Cancel to edit.`)) {
            confirmUnusualPrices = true;
            continue;
          }
          throw new Error('The sale was not completed. Adjust the price or confirm it to continue.');
        }

        if (!response.ok) {
          throw new Error(typeof body.error === 'string' ? body.error : 'The sale could not be recorded.');
        }

        setResult({
          txnid: body.txnid,
          receiptNo: body.receiptNo,
          totalPaise: body.totalPaise,
        });
        setNotice(
          `Sale recorded. Charged ${formatPaise(Number(body.totalPaise) || 0)}.`,
        );
        setLines([]);
        setProviderRef('');
        setCustomerPhone('');
        return;
      }
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
      {notice && !result ? <p className="sa-notice" role="status">{notice}</p> : null}

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
                  <span className="sa-pos-price">{formatPaise(product.listPricePaise)}</span>
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
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="sa-num">Qty</th>
                  <th className="sa-num">Price (₹)</th>
                  <th className="sa-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const parsed = parseRupeesToPaise(line.price);
                  const paid = parsed.ok ? parsed.paise : null;
                  return (
                    <tr key={line.product.id}>
                      <td>
                        {line.product.name}
                        <span className="sa-row-sub">
                          List {formatRupees(line.product.listPricePaise)} ·{' '}
                          <button
                            className="sa-product-link sa-pos-uselist"
                            type="button"
                            onClick={() =>
                              setPrice(line.product.id, (line.product.listPricePaise / 100).toFixed(2))
                            }
                          >
                            Use list price
                          </button>
                        </span>
                      </td>
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
                      <td className="sa-num">
                        <input
                          ref={(node) => {
                            priceRefs.current[line.product.id] = node;
                          }}
                          className="sa-input sa-qty-input"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={line.price}
                          placeholder="Enter price"
                          aria-label={`Selling price for ${line.product.name}`}
                          onChange={(event) => setPrice(line.product.id, event.target.value)}
                        />
                        {line.price.trim() === '' ? (
                          <span className="sa-hint">Enter the selling price</span>
                        ) : paid === null ? (
                          <span className="sa-no">Use rupees, for example 499.50</span>
                        ) : null}
                      </td>
                      <td className="sa-num">
                        {paid === null ? '—' : formatPaise(paid * line.quantity)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <dl className="sa-meta">
            <div><dt>Items</dt><dd>{formatPaise(subtotal)}</dd></div>
            <div><dt>Total</dt><dd><strong>{formatPaise(subtotal)}</strong></dd></div>
          </dl>
          {lines.length > 0 && (missingPrice || invalidPrice) ? (
            <p className="sa-hint">
              Enter a selling price on every line to complete the bill.
            </p>
          ) : null}

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

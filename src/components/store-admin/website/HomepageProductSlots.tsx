'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import type { CatalogProductSummary } from '@/lib/store-admin/catalog';
import type { FieldSchema, ListSchema } from '@/lib/website/collections';

// The overview currently supplies names and regular prices, but no artwork.
// Accept optional preview metadata if the same endpoint provides it later.
type SlotProduct = CatalogProductSummary & { deletedAt?: string | null; imageUrl?: string | null };

interface Props {
  count: number;
  list: ListSchema;
  items: unknown[];
  disabled: boolean;
  onSelect: (index: number, productId: string) => void;
  renderDecoration: (field: FieldSchema, index: number) => ReactNode;
  onValidityChange: (valid: boolean) => void;
}

function productId(item: unknown): string {
  if (!item || typeof item !== 'object' || !('productId' in item)) return '';
  return typeof item.productId === 'string' ? item.productId : '';
}

function priceLabel(product: SlotProduct): string {
  if (!Number.isFinite(product.pricePaise)) return 'Price unavailable';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: product.currency || 'INR',
    }).format(product.pricePaise / 100);
  } catch {
    return `${(product.pricePaise / 100).toFixed(2)} ${product.currency}`;
  }
}

export function HomepageProductSlots({
  count,
  list,
  items,
  disabled,
  onSelect,
  renderDecoration,
  onValidityChange,
}: Props) {
  const id = useId();
  const [products, setProducts] = useState<SlotProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [queries, setQueries] = useState<Record<number, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/store-admin/catalog/products', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || !Array.isArray(payload.products)) {
          throw new Error(
            typeof payload?.error === 'string' ? payload.error : 'Could not load the catalog.',
          );
        }
        if (cancelled) return;
        setProducts(payload.products.filter((product: SlotProduct) =>
          product && typeof product.id === 'string' && typeof product.name === 'string'
          && product.isActive === true && !product.deletedAt,
        ));
      } catch (failure) {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : 'Could not load the catalog.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt]);

  const selectedIds = useMemo(() => Array.from({ length: count }, (_, index) => productId(items[index])), [count, items]);
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const valid = !loading && !error && items.length === count
    && selectedIds.every((selected) => selected !== '' && byId.has(selected))
    && new Set(selectedIds).size === count;

  useEffect(() => {
    onValidityChange(valid);
  }, [onValidityChange, valid]);

  function retry() {
    setLoading(true);
    setError(null);
    onValidityChange(false);
    setAttempt((previous) => previous + 1);
  }

  return (
    <section className="sa-detail-card" style={{ marginBottom: 14 }} aria-busy={loading}>
      <h2 className="sa-card-title">
        Homepage products
        <span className="sa-chip sa-chip-count" style={{ marginLeft: 8 }}>{count} fixed slots</span>
      </h2>
      <p className="sa-hint">Choose a different active catalog product for every slot. All {count} slots are required, even when the section is hidden. Product details come from the catalog.</p>
      {loading ? <p className="sa-note" role="status">Loading catalog products…</p> : null}
      {error ? (
        <div role="alert">
          <p className="sa-error">{error}</p>
          <button className="sa-btn sa-btn-quiet sa-btn-small" type="button" onClick={retry}>Retry catalog</button>
        </div>
      ) : null}
      {!loading && !error && products.length < count ? (
        <p className="sa-error" role="alert">The catalog has {products.length} active products. {count} distinct products are required to save this section.</p>
      ) : null}
      {selectedIds.map((selected, index) => {
        const product = byId.get(selected);
        const duplicate = selected !== '' && selectedIds.some((other, position) => position !== index && other === selected);
        const unavailable = selected !== '' && !loading && !error && !product;
        const query = (queries[index] ?? '').trim().toLowerCase();
        const options = products.filter((candidate) => candidate.id === selected || (
          !selectedIds.some((other, position) => position !== index && other === candidate.id)
          && `${candidate.name} ${candidate.id} ${candidate.slug} ${candidate.categoryName}`.toLowerCase().includes(query)
        ));
        const slotId = `${id}-${index}`;
        const issue = duplicate ? 'This product is selected in another slot. Choose a different product.'
          : unavailable ? 'The saved product is inactive, deleted, or unavailable. Choose an active product.'
            : !selected ? 'Choose a product for this slot.' : null;
        return (
          <div className="sa-edit-card" key={index}>
            <h3 className="sa-row-strong">Slot {index + 1}{product ? ` · ${product.name}` : ''}</h3>
            {product ? (
              <div className="sa-inline-actions" style={{ marginBottom: 12 }}>
                {product.imageUrl ? (
                  // Catalog artwork is already a public URL, as in the existing media previews.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.imageUrl} alt={product.name} width={64} height={64} style={{ objectFit: 'contain' }} />
                ) : null}
                <span><strong>{product.name}</strong><br />{priceLabel(product)}<br /><span className="sa-muted sa-mono">{product.id}</span></span>
              </div>
            ) : selected ? <p className="sa-muted sa-mono">Saved product: {selected}</p> : null}
            <div className="sa-control-grid">
              <div className="sa-field sa-field-wide">
                <label className="sa-label" htmlFor={`${slotId}-search`}>Search products for slot {index + 1}</label>
                <input
                  id={`${slotId}-search`}
                  className="sa-input"
                  type="search"
                  value={queries[index] ?? ''}
                  disabled={disabled || loading || !!error}
                  onChange={(event) => setQueries((previous) => ({ ...previous, [index]: event.target.value }))}
                  placeholder="Name, product ID, or category"
                />
              </div>
              <div className="sa-field sa-field-wide">
                <label className="sa-label" htmlFor={`${slotId}-product`}>Product for slot {index + 1}</label>
                <select
                  id={`${slotId}-product`}
                  className="sa-input"
                  value={selected}
                  disabled={disabled || loading || !!error}
                  aria-invalid={!!issue}
                  aria-describedby={issue ? `${slotId}-issue` : undefined}
                  onChange={(event) => onSelect(index, event.target.value)}
                >
                  <option value="">Choose an active product</option>
                  {selected && !product ? <option value={selected}>{selected} · unavailable</option> : null}
                  {options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.id} · {priceLabel(option)}</option>)}
                </select>
                {!loading && !error && options.every((option) => option.id === selected) && query ? <span className="sa-hint">No other matching products.</span> : null}
                {issue ? <span id={`${slotId}-issue`} className="sa-error">{issue}</span> : null}
              </div>
              {list.itemFields.filter((field) => field.path !== 'productId').map((field) => renderDecoration(field, index))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

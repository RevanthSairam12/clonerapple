'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export interface CollectionProduct {
  productId: string;
  name: string;
  categoryName: string;
  priceDisplay: string;
  position: number;
}

export interface StoreCollection {
  key: string;
  products: CollectionProduct[];
}

export interface CollectionProductOption {
  id: string;
  name: string;
  categoryName: string;
  priceDisplay: string;
  inCollection: string[];
}

interface Props {
  initialCollections: StoreCollection[];
  productOptions: CollectionProductOption[];
  canEdit: boolean;
}

const KEY_HINT =
  'Lowercase letters, digits, dots, hyphens or underscores. The storefront asks for this exact key.';

/**
 * Merchandising membership: which products appear in a named storefront
 * collection, and in what order. The product records themselves (name, price,
 * image, stock) stay on the Products screen; this screen only chooses and
 * orders them.
 */
export function CollectionManager({ initialCollections, productOptions, canEdit }: Props) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState(initialCollections[0]?.key ?? '');
  const [newKey, setNewKey] = useState('');
  const [productToAdd, setProductToAdd] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const active = useMemo(
    () => initialCollections.find((collection) => collection.key === selectedKey) ?? null,
    [initialCollections, selectedKey],
  );

  const available = useMemo(() => {
    if (!selectedKey) return productOptions;
    return productOptions.filter(
      (product) => !product.inCollection.includes(selectedKey),
    );
  }, [productOptions, selectedKey]);

  function openCollection(key: string) {
    setSelectedKey(key);
    setProductToAdd('');
    setError(null);
    setNotice(null);
  }

  async function call(
    method: 'POST' | 'PUT' | 'DELETE',
    payload: Record<string, unknown> | null,
    busyKey: string,
  ): Promise<boolean> {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        method === 'DELETE'
          ? `/api/store-admin/catalog/collections?collectionKey=${encodeURIComponent(
              payload?.collectionKey as string,
            )}&productId=${encodeURIComponent(payload?.productId as string)}`
          : '/api/store-admin/catalog/collections',
        {
          method,
          headers: payload ? { 'content-type': 'application/json' } : undefined,
          body:
            method === 'DELETE'
              ? undefined
              : JSON.stringify(payload ?? {}),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not update the collection.',
        );
      }
      router.refresh();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not update the collection.',
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addProduct() {
    if (!selectedKey || !productToAdd) return;
    const added = await call(
      'POST',
      { collectionKey: selectedKey, productId: productToAdd },
      'add',
    );
    if (added) {
      setProductToAdd('');
      setNotice('Product added to the collection.');
    }
  }

  async function removeProduct(productId: string) {
    const removed = await call(
      'DELETE',
      { collectionKey: selectedKey, productId },
      productId,
    );
    if (removed) setNotice('Product removed from the collection.');
  }

  async function move(productId: string, direction: -1 | 1) {
    if (!active) return;
    const ids = active.products.map((product) => product.productId);
    const index = ids.indexOf(productId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const saved = await call(
      'PUT',
      { collectionKey: selectedKey, productIds: ids },
      `move:${productId}`,
    );
    if (saved) setNotice('Collection order saved.');
  }

  function createCollection() {
    const key = newKey.trim().toLowerCase();
    if (!key) {
      setError('Enter a collection key first.');
      return;
    }
    openCollection(key);
    setNewKey('');
    setNotice(
      'Add the first product. The collection is stored when its first membership is saved.',
    );
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Storefront collections</h2>
      <p className="sa-card-note">
        A collection is a named, ordered product list used by a storefront rail
        or carousel. Membership and order live here; product names, prices,
        images and stock are edited on the Products screen. An empty collection
        falls back to the page&rsquo;s own list, so it never renders blank.
      </p>

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

      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">Collection</span>
          <select
            className="sa-input"
            value={selectedKey}
            onChange={(event) => openCollection(event.target.value)}
          >
            <option value="">Choose a collection…</option>
            {initialCollections.map((collection) => (
              <option key={collection.key} value={collection.key}>
                {collection.key} ({collection.products.length})
              </option>
            ))}
            {selectedKey &&
            !initialCollections.some((collection) => collection.key === selectedKey) ? (
              <option value={selectedKey}>{selectedKey} (new)</option>
            ) : null}
          </select>
        </label>

        {canEdit ? (
          <div className="sa-field">
            <span className="sa-label">
              New collection <span className="sa-hint">{KEY_HINT}</span>
            </span>
            <div className="sa-inline-actions">
              <input
                className="sa-input"
                maxLength={64}
                placeholder="homepage.featured"
                value={newKey}
                onChange={(event) => setNewKey(event.target.value)}
              />
              <button
                className="sa-btn sa-btn-quiet"
                type="button"
                disabled={!newKey.trim()}
                onClick={createCollection}
              >
                Open new
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!selectedKey ? (
        <p className="sa-empty">Choose an existing collection or open a new key.</p>
      ) : (
        <>
          <div className="sa-detail-head" style={{ marginTop: 20 }}>
            <div>
              <h3 className="sa-control-title">{selectedKey}</h3>
              <p className="sa-card-note">
                {active?.products.length
                  ? `${active.products.length} product${active.products.length === 1 ? '' : 's'} in display order.`
                  : 'No database membership yet — the storefront uses its fallback list.'}
              </p>
            </div>
          </div>

          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th className="sa-num">#</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="sa-num">Price</th>
                  {canEdit ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {!active || active.products.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 5 : 4} className="sa-empty">
                      No products in this collection yet.
                    </td>
                  </tr>
                ) : (
                  active.products.map((product, index) => (
                    <tr key={product.productId}>
                      <td className="sa-num">{index + 1}</td>
                      <td>
                        <strong>{product.name}</strong>
                        <div className="sa-row-sub sa-mono">{product.productId}</div>
                      </td>
                      <td>{product.categoryName}</td>
                      <td className="sa-num">{product.priceDisplay}</td>
                      {canEdit ? (
                        <td>
                          <button
                            className="sa-btn sa-btn-quiet sa-btn-small"
                            type="button"
                            aria-label={`Move ${product.name} up`}
                            disabled={index === 0 || busy === `move:${product.productId}`}
                            onClick={() => move(product.productId, -1)}
                          >
                            ↑
                          </button>{' '}
                          <button
                            className="sa-btn sa-btn-quiet sa-btn-small"
                            type="button"
                            aria-label={`Move ${product.name} down`}
                            disabled={
                              index === active.products.length - 1 ||
                              busy === `move:${product.productId}`
                            }
                            onClick={() => move(product.productId, 1)}
                          >
                            ↓
                          </button>{' '}
                          <button
                            className="sa-btn sa-btn-quiet sa-btn-small"
                            type="button"
                            disabled={busy === product.productId}
                            onClick={() => removeProduct(product.productId)}
                          >
                            Remove
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {canEdit ? (
            <div className="sa-inline-actions" style={{ marginTop: 16 }}>
              <select
                className="sa-input"
                value={productToAdd}
                onChange={(event) => setProductToAdd(event.target.value)}
              >
                <option value="">Choose a product…</option>
                {available.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {product.categoryName}
                  </option>
                ))}
              </select>
              <button
                className="sa-btn sa-btn-primary"
                type="button"
                disabled={!productToAdd || busy === 'add'}
                onClick={addProduct}
              >
                {busy === 'add' ? 'Adding…' : 'Add product'}
              </button>
            </div>
          ) : (
            <p className="sa-lock-note">
              Your role can view collections but not change them.
            </p>
          )}
        </>
      )}
    </section>
  );
}

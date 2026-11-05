import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StockControls } from '@/components/store-admin/StockControls';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate } from '@/lib/store-admin/catalog';
import { getStockDetail } from '@/lib/store-admin/catalog-crud';

export const dynamic = 'force-dynamic';

export default async function StoreAdminStockDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const result = await getStockDetail(productId);

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <Link className="sa-back" href="/store-admin/stock">
          ← Stock
        </Link>
        <h1 className="sa-page-title">Stock</h1>
        <p className="sa-notice">The stock tables are not available yet.</p>
      </div>
    );
  }

  const detail = result.data;
  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  return (
    <div>
      <Link className="sa-back" href="/store-admin/stock">
        ← Stock
      </Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">{detail.name}</h1>
          <p className="sa-page-sub">
            {detail.categoryName || 'No category'} ·{' '}
            {detail.trackInventory ? 'Stock limited' : 'Not limited'}
          </p>
        </div>
        <Link
          className="sa-btn sa-btn-quiet"
          href={`/store-admin/products/${encodeURIComponent(detail.productId)}`}
        >
          Open product
        </Link>
      </div>

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <span className="sa-stat-label">
            {detail.inventoryMode === 'variant' ? 'Total in stock' : 'In stock'}
          </span>
          <strong className="sa-stat-value">
            {detail.inventoryMode === 'variant' ? detail.totalOnHand : detail.onHand}
          </strong>
          <span className="sa-stat-note">
            {detail.inventoryMode === 'variant'
              ? `Across ${detail.options.length} options`
              : 'Physical units'}
          </span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Held in checkouts</span>
          <strong className="sa-stat-value">
            {detail.inventoryMode === 'variant' ? detail.totalReserved : detail.reserved}
          </strong>
          <span className="sa-stat-note">Units set aside during checkout</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Available to buy</span>
          <strong className="sa-stat-value">
            {detail.inventoryMode === 'variant' ? detail.totalAvailable : detail.available}
          </strong>
          <span className="sa-stat-note">
            {detail.inventoryMode === 'variant'
              ? 'Warnings are set per option in the product editor'
              : `Warn me when below ${detail.lowStockThreshold}`}
          </span>
        </div>
      </div>

      {detail.inventoryMode === 'variant' ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Stock per option</h2>
          {detail.options.length === 0 ? (
            <p className="sa-empty">No active purchasable options.</p>
          ) : (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>SKU</th>
                    <th className="sa-num">In stock</th>
                    <th className="sa-num">Held</th>
                    <th className="sa-num">Available</th>
                    <th className="sa-num">Warn below</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.options.map((option) => {
                    const state = !option.trackInventory
                      ? 'Not limited'
                      : option.available === 0
                        ? 'Out of stock'
                        : option.available <= option.lowStockThreshold
                          ? 'Low'
                          : 'In stock';
                    return (
                      <tr key={option.variantId}>
                        <td>{option.variantLabel ?? option.variantId}</td>
                        <td className="sa-mono">{option.variantSku ?? '—'}</td>
                        <td className="sa-num">{option.trackInventory ? option.onHand : '—'}</td>
                        <td className="sa-num">{option.trackInventory ? option.reserved : '—'}</td>
                        <td className="sa-num">{option.trackInventory ? option.available : '—'}</td>
                        <td className="sa-num">{option.trackInventory ? option.lowStockThreshold : '—'}</td>
                        <td>
                          <span
                            className={
                              state === 'Out of stock'
                                ? 'sa-status sa-status-danger'
                                : state === 'Low'
                                  ? 'sa-status sa-status-warn'
                                  : option.trackInventory
                                    ? 'sa-status sa-status-on'
                                    : 'sa-status'
                            }
                          >
                            {state}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="sa-card-note">
            Change an option&apos;s count or warning level in the product editor.
            <Link
              className="sa-back sa-back-inline"
              href={`/store-admin/products/${encodeURIComponent(detail.productId)}`}
            >
              Open product editor
            </Link>
          </p>
        </section>
      ) : null}

      <div className="sa-detail-grid">
        {detail.inventoryMode === 'product' ? (
          <StockControls
            productId={detail.productId}
            onHand={detail.onHand}
            lowStockThreshold={detail.lowStockThreshold}
            trackInventory={detail.trackInventory}
            hasStockRow={detail.hasStockRow}
            canEdit={canEdit}
          />
        ) : (
          <section className="sa-detail-card">
            <h2 className="sa-card-title">Counts live on the options</h2>
            <p className="sa-card-note">
              This product is sold by option, so its parent count is not for sale.
              Adjust each option in the product editor; every change writes a movement.
            </p>
          </section>
        )}

        <section className="sa-detail-card">
          <h2 className="sa-card-title">How stock moves</h2>
          <p className="sa-card-note">
            Checkouts hold units while payment is pending; returns restore them
            on receipt. Manual adjustments are receipts, recounts and damage.
            Nothing here edits history — the log below is append-only.
          </p>
        </section>
      </div>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Movement history</h2>
        {detail.movements.length === 0 ? (
          <p className="sa-empty">No movements recorded.</p>
        ) : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Option</th>
                  <th>Reason</th>
                  <th className="sa-num">Change</th>
                  <th>Note</th>
                  <th>Order</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {detail.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="sa-date">{formatDate(movement.createdAt)}</td>
                    <td>
                      {movement.variantId
                        ? movement.variantLabel ?? movement.variantId
                        : 'Product bucket'}
                    </td>
                    <td>
                      <span className="sa-chip">{movement.reason}</span>
                    </td>
                    <td className="sa-num">
                      {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                    </td>
                    <td>{movement.note || '—'}</td>
                    <td className="sa-mono">{movement.orderId ?? '—'}</td>
                    <td>{movement.createdBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

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
            {detail.trackInventory ? 'Tracked' : 'Untracked'}
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
          <span className="sa-stat-label">On hand</span>
          <strong className="sa-stat-value">{detail.onHand}</strong>
          <span className="sa-stat-note">Physical units</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Reserved</span>
          <strong className="sa-stat-value">{detail.reserved}</strong>
          <span className="sa-stat-note">Paid, not yet shipped</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Available</span>
          <strong className="sa-stat-value">{detail.available}</strong>
          <span className="sa-stat-note">
            Threshold {detail.lowStockThreshold}
          </span>
        </div>
      </div>

      <div className="sa-detail-grid">
        <StockControls
          productId={detail.productId}
          onHand={detail.onHand}
          lowStockThreshold={detail.lowStockThreshold}
          trackInventory={detail.trackInventory}
          canEdit={canEdit}
        />

        <section className="sa-detail-card">
          <h2 className="sa-card-title">How stock moves</h2>
          <p className="sa-card-note">
            Sales reserve units when PayU confirms payment; returns restore them
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

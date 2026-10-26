import Link from 'next/link';

import { listStockOverview } from '@/lib/store-admin/catalog-crud';

export const dynamic = 'force-dynamic';

export default async function StoreAdminStockPage() {
  const result = await listStockOverview();

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Stock</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migration 0024, then
          reload this page.
        </p>
      </div>
    );
  }

  const rows = result.data;
  const tracked = rows.filter((row) => row.trackInventory);
  const low = tracked.filter(
    (row) => row.available > 0 && row.available <= row.lowStockThreshold,
  );
  const out = tracked.filter((row) => row.available === 0);
  const untracked = rows.length - tracked.length;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Stock</h1>
          <p className="sa-page-sub">
            {rows.length} products · {tracked.length} tracked · {untracked}{' '}
            untracked.
          </p>
        </div>
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/products">
          Products
        </Link>
      </div>

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <span className="sa-stat-label">Tracked</span>
          <strong className="sa-stat-value">{tracked.length}</strong>
          <span className="sa-stat-note">Checkout checks these counts</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Low stock</span>
          <strong className="sa-stat-value">{low.length}</strong>
          <span className="sa-stat-note">At or under the threshold</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Out of stock</span>
          <strong className="sa-stat-value">{out.length}</strong>
          <span className="sa-stat-note">Nothing available to sell</span>
        </div>
      </div>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th className="sa-num">On hand</th>
              <th className="sa-num">Reserved</th>
              <th className="sa-num">Available</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="sa-empty">
                  No products yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const state = !row.trackInventory
                  ? 'Untracked'
                  : row.available === 0
                    ? 'Out of stock'
                    : row.available <= row.lowStockThreshold
                      ? 'Low'
                      : 'In stock';
                const tone =
                  state === 'Out of stock'
                    ? 'sa-status sa-status-danger'
                    : state === 'Low'
                      ? 'sa-status sa-status-warn'
                      : row.trackInventory
                        ? 'sa-status sa-status-on'
                        : 'sa-status';
                return (
                  <tr key={row.productId}>
                    <td>
                      <Link
                        className="sa-product-link"
                        href={`/store-admin/stock/${encodeURIComponent(row.productId)}`}
                      >
                        {row.name}
                      </Link>
                      <span className="sa-row-sub sa-mono">{row.productId}</span>
                    </td>
                    <td>{row.categoryName || '—'}</td>
                    <td className="sa-num">{row.trackInventory ? row.onHand : '—'}</td>
                    <td className="sa-num">{row.trackInventory ? row.reserved : '—'}</td>
                    <td className="sa-num">{row.trackInventory ? row.available : '—'}</td>
                    <td>
                      <span className={tone}>{state}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

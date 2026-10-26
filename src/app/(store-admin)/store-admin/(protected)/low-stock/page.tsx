import Link from 'next/link';

import { formatDate, listLowStock } from '@/lib/store-admin/catalog';

export const dynamic = 'force-dynamic';

/**
 * Low-stock report.
 *
 * Read-only on purpose: quantities move through receipts, sales, returns and
 * voids, each of which writes a stock movement. A quantity box here would
 * break that trail.
 */
export default async function StoreAdminLowStockPage() {
  const result = await listLowStock(200);

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Low stock</h1>
        <p className="sa-notice">
          The stock table is not available yet. Apply migration 0011, then run{' '}
          <code>node scripts/seed-store-catalog.mjs</code>.
        </p>
      </div>
    );
  }

  const { rows, trackedCount, lowCount } = result.data;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Low stock</h1>
          <p className="sa-page-sub">
            Products whose available count has reached its threshold. Only
            products that track inventory are counted — for everything else
            checkout ignores the number.
          </p>
        </div>
        <div className="sa-inline-actions">
          <a className="sa-btn sa-btn-small" href="/api/store-admin/stock/export?scope=low" download>
            Export low stock
          </a>
          <a className="sa-btn sa-btn-small" href="/api/store-admin/stock/export?scope=all" download>
            Export all levels
          </a>
        </div>
      </div>

      <div className="sa-order-counts">
        <div className="sa-order-count">
          <span>Tracked products</span>
          <strong>{trackedCount}</strong>
        </div>
        <div className="sa-order-count">
          <span>At or below threshold</span>
          <strong>{lowCount}</strong>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="sa-empty">
          Nothing is low right now.{' '}
          {trackedCount === 0
            ? 'No product tracks inventory yet, so this list stays empty.'
            : ''}
        </p>
      ) : (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="sa-num">On hand</th>
                <th className="sa-num">Reserved</th>
                <th className="sa-num">Available</th>
                <th className="sa-num">Threshold</th>
                <th>Stock updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId}>
                  <td>
                    <Link
                      className="sa-product-link"
                      href={`/store-admin/products/${row.productId}`}
                    >
                      {row.name}
                    </Link>
                    <div className="sa-row-sub sa-mono">{row.slug}</div>
                  </td>
                  <td className="sa-num">{row.onHand}</td>
                  <td className="sa-num">{row.reserved}</td>
                  <td className="sa-num">
                    <strong className={row.available <= 0 ? 'sa-no' : undefined}>
                      {row.available}
                    </strong>
                  </td>
                  <td className="sa-num">{row.threshold}</td>
                  <td className="sa-date">{formatDate(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="sa-readonly-foot">
        Quantities change through receipts, sales, returns and voids, so each
        count has a movement behind it.
      </p>
    </div>
  );
}

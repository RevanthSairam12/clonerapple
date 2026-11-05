import { formatDate, formatINR, type CatalogPriceHistoryRow } from '@/lib/store-admin/catalog';
import {
  priceHistoryAmount,
  priceHistoryIsCleared,
  priceHistoryKindLabel,
  priceHistoryScopeLabel,
} from '@/lib/store-admin/price-history-rules';

/**
 * The product's price history, product and option rows together.
 *
 * A cleared sale is stored with a 0 sentinel because the column is NOT NULL.
 * It is shown as "Sale cleared" with an em dash for the new value, never as
 * ₹0.00 and never as a real price. Any stored 0 is treated the same way.
 */
export function PriceHistoryTable({ rows }: { rows: CatalogPriceHistoryRow[] }) {
  if (rows.length === 0) return <p className="sa-empty">No price history.</p>;
  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead>
          <tr>
            <th>Changed</th>
            <th>Kind</th>
            <th>Scope</th>
            <th>Old price</th>
            <th>New price</th>
            <th>Old sale</th>
            <th>New sale</th>
            <th>Source</th>
            <th>Reason</th>
            <th>Changed by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cleared = row.cleared || priceHistoryIsCleared(row.priceKind);
            const oldPrice = priceHistoryAmount(row.oldPricePaise);
            const newPrice = cleared ? null : priceHistoryAmount(row.newPricePaise);
            const oldSale = priceHistoryAmount(row.oldSalePricePaise);
            const newSale = cleared ? null : priceHistoryAmount(row.newSalePricePaise);
            return (
              <tr key={row.id}>
                <td>{formatDate(row.changedAt)}</td>
                <td>{priceHistoryKindLabel(row.priceKind)}</td>
                <td>
                  {priceHistoryScopeLabel(row.variantId)}
                  {row.variantId ? (
                    <span className="sa-row-sub">
                      {row.variantLabel ?? row.variantId}
                      {row.variantSku ? ` · ${row.variantSku}` : ''}
                    </span>
                  ) : null}
                </td>
                <td>{oldPrice === null ? '—' : formatINR(oldPrice)}</td>
                <td>{newPrice === null ? '—' : formatINR(newPrice)}</td>
                <td>{oldSale === null ? '—' : formatINR(oldSale)}</td>
                <td>{newSale === null ? '—' : formatINR(newSale)}</td>
                <td>{row.source}</td>
                <td>{row.reason || '—'}</td>
                <td>{row.changedBy ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

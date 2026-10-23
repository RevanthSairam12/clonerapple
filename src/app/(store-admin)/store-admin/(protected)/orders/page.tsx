import Link from 'next/link';

import { formatDate } from '@/lib/store-admin/catalog';
import { isDateOnly } from '@/lib/store-admin/delivery';
import { listPosOrders } from '@/lib/store-admin/order-channel';
import { listOrders, ORDERS_PAGE_SIZE, SALE_STATES, type SaleState } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    q?: string;
    channel?: string;
    date?: string;
    page?: string;
  }>;
}

function pageHref(
  page: number,
  filters: { query: string; posOnly: boolean; date: string },
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.posOnly) params.set('channel', 'pos');
  if (filters.date) params.set('date', filters.date);
  if (page > 1) params.set('page', String(page));
  const suffix = params.toString();
  return suffix ? `/store-admin/orders?${suffix}` : '/store-admin/orders';
}

function formatAmount(amountPaise: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(amountPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const SALE_STATE_LABELS: Record<SaleState, string> = {
  REFUNDED: 'Refunded',
  PAYMENT_FAILED: 'Payment failed',
  CANCELED: 'Canceled',
  DELIVERED: 'Delivered',
  ON_THE_WAY: 'On the way',
  PROCESSING: 'Processing',
  SCHEDULED: 'Scheduled',
  ACCEPTED: 'Accepted',
  PENDING: 'Pending',
};

function stateClass(state: SaleState): string {
  return state === 'PENDING' || state === 'PROCESSING' || state === 'ON_THE_WAY'
    ? 'sa-status sa-status-on'
    : 'sa-status';
}

export default async function StoreAdminOrdersPage({ searchParams }: Props) {
  const params = await searchParams;
  const posOnly = params.channel === 'pos';
  const date = params.date && isDateOnly(params.date) ? params.date : null;
  const result = posOnly
    ? await listPosOrders({ query: params.q, dateFrom: date, dateTo: date, page: Number.parseInt(params.page ?? '1', 10) })
    : await listOrders({ query: params.q, dateFrom: date, dateTo: date, page: Number.parseInt(params.page ?? '1', 10) });

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Orders</h1>
        <p className="sa-notice">
          Order records are not available. Apply migration 0014 and check that
          the database is configured.
        </p>
      </div>
    );
  }

  const { orders, counts, total, page, pageCount, query, dateFrom } = result.data;
  const firstRow = total === 0 ? 0 : (page - 1) * ORDERS_PAGE_SIZE + 1;
  const lastRow = Math.min(page * ORDERS_PAGE_SIZE, total);

  return (
    <div>
      <h1 className="sa-page-title">Orders</h1>
      <p className="sa-page-sub">
        All sale states · {total} {total === 1 ? 'order' : 'orders'} in this view.
      </p>

      <div className="sa-order-counts" aria-label="Order counts by sale state">
        {SALE_STATES.map((state) => (
          <div className="sa-order-count" key={state}>
            <span>{SALE_STATE_LABELS[state]}</span>
            <strong>{counts[state]}</strong>
          </div>
        ))}
      </div>

      <form className="sa-order-filters" method="get" action="/store-admin/orders">
        <div className="sa-filter-field sa-filter-search">
          <label className="sa-label" htmlFor="order-query">Transaction ID</label>
          <input
            id="order-query"
            className="sa-input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search txnid"
            autoComplete="off"
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="order-channel">Channel</label>
          <select id="order-channel" className="sa-input" name="channel" defaultValue={posOnly ? 'pos' : 'all'}>
            <option value="all">All channels</option>
            <option value="pos">POS only</option>
          </select>
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="order-date">Placed on</label>
          <input id="order-date" className="sa-input" type="date" name="date" defaultValue={dateFrom ?? ''} />
        </div>
        <div className="sa-filter-actions">
          <button type="submit" className="sa-btn sa-btn-quiet">Apply</button>
          {query || posOnly || dateFrom ? (
            <Link className="sa-back sa-back-inline" href="/store-admin/orders">Clear</Link>
          ) : null}
        </div>
      </form>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Customer</th>
              <th>Sale state</th>
              <th className="sa-num">Amount</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.txnid}>
                <td>
                  <Link className="sa-product-link sa-mono" href={`/store-admin/orders/${encodeURIComponent(order.txnid)}`}>
                    {order.txnid}
                  </Link>
                  <span className="sa-row-sub">Payment {order.paymentStatus} · Fulfilment {order.fulfilmentStatus}</span>
                </td>
                <td>{order.customer.nameMasked}</td>
                <td><span className={stateClass(order.saleState)}>{SALE_STATE_LABELS[order.saleState]}</span></td>
                <td className="sa-num">{formatAmount(order.totalPaise || Math.round(order.amount * 100), order.currency)}</td>
                <td className="sa-date">{formatDate(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {orders.length === 0 ? (
        <p className="sa-empty">No orders match these filters.</p>
      ) : null}

      <nav className="sa-pagination" aria-label="Order pages">
        {page > 1 ? (
          <Link className="sa-nav-step" href={pageHref(page - 1, { query, posOnly, date: dateFrom ?? '' })}>← Previous</Link>
        ) : <span className="sa-nav-step sa-nav-step-off">← Previous</span>}
        <span className="sa-page-count">
          {total === 0 ? 'No results' : `Showing ${firstRow}–${lastRow} of ${total} · page ${page} of ${pageCount}`}
        </span>
        {page < pageCount ? (
          <Link className="sa-nav-step" href={pageHref(page + 1, { query, posOnly, date: dateFrom ?? '' })}>Next →</Link>
        ) : <span className="sa-nav-step sa-nav-step-off">Next →</span>}
      </nav>

      <p className="sa-readonly-foot">
        Read-only list view. Open an order to update supported delivery and fulfilment fields.
      </p>
    </div>
  );
}

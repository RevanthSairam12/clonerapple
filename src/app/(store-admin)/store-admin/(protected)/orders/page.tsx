import Link from 'next/link';

import { getStoreSession } from '@/lib/store-admin/auth';
import { isDateOnly } from '@/lib/store-admin/delivery';
import {
  getOrderDetail,
  isOrderSort,
  isSaleState,
  listOrders,
  ORDER_SORTS,
  ORDERS_PAGE_SIZE,
  type OrderSort,
  type SaleState,
} from '@/lib/store-admin/orders';
import { orderTotals } from '@/lib/store-admin/order-documents';
import { canonicalViewQuery, getSavedViews } from '@/lib/store-admin/preferences';
import { QuickView } from '@/components/store-admin/QuickView';
import { SavedViews } from '@/components/store-admin/SavedViews';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    q?: string;
    channel?: string;
    state?: string;
    sort?: string;
    from?: string;
    to?: string;
    date?: string;
    page?: string;
    view?: string;
  }>;
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

const TAB_STATES: readonly SaleState[] = [
  'PENDING',
  'ACCEPTED',
  'PROCESSING',
  'ON_THE_WAY',
  'DELIVERED',
  'SCHEDULED',
  'CANCELED',
  'REFUNDED',
  'PAYMENT_FAILED',
];

const SORT_LABELS: Record<OrderSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  'amount-desc': 'Amount: high to low',
  'amount-asc': 'Amount: low to high',
};

function formatAmount(amountPaise: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(amountPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', DATE_FORMAT);
}

function stateClass(state: SaleState): string {
  if (state === 'PAYMENT_FAILED' || state === 'CANCELED') {
    return 'sa-status sa-status-danger';
  }
  return state === 'PENDING' || state === 'PROCESSING' || state === 'ON_THE_WAY'
    ? 'sa-status sa-status-on'
    : 'sa-status';
}

export default async function StoreAdminOrdersPage({ searchParams }: Props) {
  const params = await searchParams;

  const query = (params.q ?? '').trim().slice(0, 100);
  const state = params.state && isSaleState(params.state) ? params.state : null;
  const channel =
    params.channel === 'web' || params.channel === 'pos' ? params.channel : null;
  const sort: OrderSort = params.sort && isOrderSort(params.sort) ? params.sort : 'newest';
  const legacyDate = params.date && isDateOnly(params.date) ? params.date : null;
  const dateFrom =
    params.from && isDateOnly(params.from) ? params.from : legacyDate;
  const dateTo = params.to && isDateOnly(params.to) ? params.to : legacyDate;
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const result = await listOrders({
    query,
    state,
    channel,
    dateFrom,
    dateTo,
    sort,
    page: requestedPage,
  });

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

  const { orders, counts, total, page, pageCount } = result.data;
  const firstRow = total === 0 ? 0 : (page - 1) * ORDERS_PAGE_SIZE + 1;
  const lastRow = Math.min(page * ORDERS_PAGE_SIZE, total);
  const allCount = Object.values(counts).reduce((sum, count) => sum + count, 0);

  function href(
    overrides: Partial<{
      q: string;
      channel: 'web' | 'pos' | null;
      state: SaleState | null;
      sort: OrderSort;
      from: string | null;
      to: string | null;
      page: number;
      view: string | null;
    }>,
  ): string {
    const next = {
      q: query,
      channel,
      state,
      sort,
      from: dateFrom,
      to: dateTo,
      page: 1,
      view: null,
      ...overrides,
    };
    const search = new URLSearchParams();
    if (next.q) search.set('q', next.q);
    if (next.channel) search.set('channel', next.channel);
    if (next.state) search.set('state', next.state);
    if (next.sort !== 'newest') search.set('sort', next.sort);
    if (next.from) search.set('from', next.from);
    if (next.to) search.set('to', next.to);
    if (next.page > 1) search.set('page', String(next.page));
    if (next.view) search.set('view', next.view);
    const suffix = search.toString();
    return suffix ? `/store-admin/orders?${suffix}` : '/store-admin/orders';
  }

  const session = await getStoreSession();
  const viewTxnid = (params.view ?? '').trim().slice(0, 120);
  const quickView =
    viewTxnid && session ? await getOrderDetail(viewTxnid, session.role) : null;
  const quickOrder = quickView?.ok ? quickView.data : null;
  const quickTotals = quickOrder ? orderTotals(quickOrder) : null;

  const savedViewsResult = session ? await getSavedViews(session.adminId) : null;
  const savedViews = savedViewsResult?.ok ? savedViewsResult.views : [];
  const currentQuery =
    canonicalViewQuery({ q: query, channel, state, sort, from: dateFrom, to: dateTo }) ?? '';

  const exportHref = href({ page: 1 })
    .replace('/store-admin/orders', '/api/store-admin/orders/export');

  return (
    <div>
      <div className="sa-page-head">
        <div>
          <h1 className="sa-page-title">Orders</h1>
          <p className="sa-page-sub">
            {total} {total === 1 ? 'order' : 'orders'} in this view
            {state ? ` · ${SALE_STATE_LABELS[state]}` : ''}
            {channel ? ` · ${channel === 'pos' ? 'POS only' : 'Online only'}` : ''}.
          </p>
        </div>
        <div className="sa-page-actions">
          <Link className="sa-btn sa-btn-quiet" href={exportHref}>
            Export CSV
          </Link>
          <Link className="sa-btn sa-btn-primary" href="/store-admin/pos">
            New POS sale
          </Link>
        </div>
      </div>

      {session ? <SavedViews initialViews={savedViews} currentQuery={currentQuery} /> : null}

      <div className="sa-filter-row" aria-label="Order status">
        <Link
          className={`sa-filter-chip${state === null ? ' is-active' : ''}`}
          href={href({ state: null, page: 1 })}
        >
          All <span className="sa-chip-count">{allCount}</span>
        </Link>
        {TAB_STATES.map((tabState) => (
          <Link
            key={tabState}
            className={`sa-filter-chip${state === tabState ? ' is-active' : ''}`}
            href={href({ state: tabState, page: 1 })}
            aria-current={state === tabState ? 'page' : undefined}
          >
            {SALE_STATE_LABELS[tabState]}
            <span className="sa-chip-count">{counts[tabState]}</span>
          </Link>
        ))}
      </div>

      <form className="sa-order-filters" method="get" action="/store-admin/orders">
        {state ? <input type="hidden" name="state" value={state} /> : null}
        <div className="sa-filter-field sa-filter-search">
          <label className="sa-label" htmlFor="order-query">Search</label>
          <input
            id="order-query"
            className="sa-input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Transaction, customer, email or phone"
            autoComplete="off"
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="order-channel">Channel</label>
          <select
            id="order-channel"
            className="sa-input"
            name="channel"
            defaultValue={channel ?? 'all'}
          >
            <option value="all">All channels</option>
            <option value="web">Online store</option>
            <option value="pos">Point of sale</option>
          </select>
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="order-from">From</label>
          <input
            id="order-from"
            className="sa-input"
            type="date"
            name="from"
            defaultValue={dateFrom ?? ''}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="order-to">To</label>
          <input
            id="order-to"
            className="sa-input"
            type="date"
            name="to"
            defaultValue={dateTo ?? ''}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="order-sort">Sort</label>
          <select
            id="order-sort"
            className="sa-input"
            name="sort"
            defaultValue={sort}
          >
            {ORDER_SORTS.map((option) => (
              <option value={option} key={option}>{SORT_LABELS[option]}</option>
            ))}
          </select>
        </div>
        <div className="sa-filter-actions">
          <button type="submit" className="sa-btn sa-btn-quiet">Apply</button>
          {query || state || channel || dateFrom || dateTo || sort !== 'newest' ? (
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
              <th>Channel</th>
              <th className="sa-num">
                <Link
                  className="sa-sort-link"
                  href={href({
                    sort: sort === 'amount-desc' ? 'amount-asc' : 'amount-desc',
                    page: 1,
                  })}
                >
                  Amount
                  <span aria-hidden="true">
                    {sort === 'amount-desc' ? '↓' : sort === 'amount-asc' ? '↑' : '↕'}
                  </span>
                </Link>
              </th>
              <th>
                <Link
                  className="sa-sort-link"
                  href={href({ sort: sort === 'oldest' ? 'newest' : 'oldest', page: 1 })}
                >
                  Placed
                  <span aria-hidden="true">
                    {sort === 'oldest' ? '↑' : sort === 'newest' ? '↓' : '↕'}
                  </span>
                </Link>
              </th>
              <th className="sa-col-actions">View</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.txnid}>
                <td>
                  <Link
                    className="sa-product-link sa-mono"
                    href={`/store-admin/orders/${encodeURIComponent(order.txnid)}`}
                  >
                    {order.txnid}
                  </Link>
                  <span className="sa-row-sub">
                    Payment {order.paymentStatus} · Fulfilment {order.fulfilmentStatus}
                  </span>
                </td>
                <td>
                  {order.customer.nameMasked}
                  <span className="sa-row-sub">{order.customer.emailMasked}</span>
                </td>
                <td>
                  <span className={stateClass(order.saleState)}>
                    {SALE_STATE_LABELS[order.saleState]}
                  </span>
                </td>
                <td>{order.channel === 'pos' ? 'POS' : 'Web'}</td>
                <td className="sa-num">
                  {formatAmount(order.totalPaise || Math.round(order.amount * 100), order.currency)}
                </td>
                <td className="sa-date">{formatDate(order.createdAt)}</td>
                <td className="sa-col-actions">
                  <Link
                    className="sa-quick-link"
                    href={href({ view: order.txnid })}
                    aria-label={`Quick view order ${order.txnid}`}
                  >
                    Quick view
                  </Link>
                </td>
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
          <Link className="sa-nav-step" href={href({ page: page - 1 })}>← Previous</Link>
        ) : <span className="sa-nav-step sa-nav-step-off">← Previous</span>}
        <span className="sa-page-count">
          {total === 0
            ? 'No results'
            : `Showing ${firstRow}–${lastRow} of ${total} · page ${page} of ${pageCount}`}
        </span>
        {page < pageCount ? (
          <Link className="sa-nav-step" href={href({ page: page + 1 })}>Next →</Link>
        ) : <span className="sa-nav-step sa-nav-step-off">Next →</span>}
      </nav>

      <p className="sa-readonly-foot">
        Customer contact values are masked in the list and in exports. Open an
        order for the audited owner-only reveal.
      </p>

      {quickOrder && quickTotals ? (
        <QuickView closeHref={href({})}>
          <header className="sa-quickview-head">
            <div>
              <span className="sa-eyebrow">Quick view</span>
              <h2 className="sa-quickview-title">{quickOrder.txnid}</h2>
              <p className="sa-quickview-sub">
                {formatDate(quickOrder.createdAt)} ·{' '}
                {quickOrder.channel === 'pos' ? 'Point of sale' : 'Online store'}
              </p>
            </div>
            <span className={stateClass(quickOrder.saleState)}>
              {SALE_STATE_LABELS[quickOrder.saleState]}
            </span>
          </header>

          <div className="sa-quickview-body">
            <div className="sa-quickview-stats">
              <div className="sa-quickview-stat">
                <span>Total</span>
                <strong>{formatAmount(quickTotals.totalPaise, quickOrder.currency)}</strong>
              </div>
              <div className="sa-quickview-stat">
                <span>Payment</span>
                <strong>{quickOrder.paymentStatus}</strong>
              </div>
              <div className="sa-quickview-stat">
                <span>Units</span>
                <strong>{quickOrder.items.reduce((sum, item) => sum + item.quantity, 0)}</strong>
              </div>
            </div>

            <section className="sa-quickview-block">
              <h3>Customer</h3>
              <p>{quickOrder.customer.nameMasked}</p>
              <p className="sa-mono">{quickOrder.customer.emailMasked}</p>
              <p className="sa-mono">{quickOrder.customer.phoneMasked}</p>
            </section>

            <section className="sa-quickview-block">
              <h3>Items</h3>
              <table className="sa-table sa-quickview-table">
                <thead>
                  <tr><th>Item</th><th className="sa-num">Qty</th><th className="sa-num">Line</th></tr>
                </thead>
                <tbody>
                  {quickOrder.items.map((item) => (
                    <tr key={item.lineNumber}>
                      <td>{item.productName}</td>
                      <td className="sa-num">{item.quantity}</td>
                      <td className="sa-num">
                        {formatAmount(item.lineTotalPaise, item.currency || quickOrder.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {quickOrder.items.length === 0 ? (
                <p className="sa-empty">No item snapshot is available.</p>
              ) : null}
            </section>

            {quickOrder.delivery ? (
              <section className="sa-quickview-block">
                <h3>Shipment</h3>
                <p>
                  {quickOrder.delivery.method === 'self'
                    ? 'Local delivery'
                    : quickOrder.delivery.method === 'courier'
                    ? 'Courier'
                    : 'Method not set'}{' '}
                  · {quickOrder.delivery.status}
                </p>
                {quickOrder.delivery.courierName || quickOrder.delivery.carrier ? (
                  <p>{quickOrder.delivery.courierName || quickOrder.delivery.carrier}</p>
                ) : null}
                {quickOrder.delivery.trackingNumber ? (
                  <p className="sa-mono">{quickOrder.delivery.trackingNumber}</p>
                ) : null}
                {quickOrder.delivery.scheduledFor ? (
                  <p>Scheduled {formatDate(quickOrder.delivery.scheduledFor)}</p>
                ) : null}
              </section>
            ) : null}
          </div>

          <footer className="sa-quickview-foot">
            <Link
              className="sa-btn sa-btn-primary"
              href={`/store-admin/orders/${encodeURIComponent(quickOrder.txnid)}`}
            >
              Open full order
            </Link>
            <Link className="sa-btn sa-btn-quiet" href={href({})}>Close</Link>
          </footer>
        </QuickView>
      ) : null}
    </div>
  );
}

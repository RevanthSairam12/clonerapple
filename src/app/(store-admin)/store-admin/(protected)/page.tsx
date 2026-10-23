import { getStoreSession } from '@/lib/store-admin/auth';
import Link from 'next/link';
import { getOrderDashboardCounts, type SaleState } from '@/lib/store-admin/orders';
import { getPosDashboard } from '@/lib/store-admin/pos';
import { formatPaise } from '@/lib/store-admin/amount';
import { getOpenOrderRequestCount } from '@/lib/store-admin/order-requests';

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

export const dynamic = 'force-dynamic';

const AREAS = [
  {
    title: 'Catalogue',
    note: 'Products, categories, facets and stock levels will live here.',
    tag: 'Next step',
  },
  {
    title: 'Orders',
    note: 'Read-only order lookup and fulfilment status will live here.',
    tag: 'Next step',
  },
  {
    title: 'Audit log',
    note: 'Login, role and data changes recorded in store_admin_audit.',
    tag: 'Next step',
  },
];

export default async function StoreAdminDashboard() {
  const session = await getStoreSession();
  const orderResult = await getOrderDashboardCounts();
  const openRequestResult = await getOpenOrderRequestCount();
  const openRequests = openRequestResult.ok ? openRequestResult.data.count : null;
  const orderCounts = orderResult.ok ? orderResult.data.counts : null;

  const posResult = await getPosDashboard();
  const todayPosTotalPaise = posResult.ok ? posResult.data.todayPosTotalPaise : null;
  const openShift = posResult.ok ? posResult.data.openShiftId : null;

  return (
    <div>
      <h1 className="sa-page-title">Store overview</h1>
      <p className="sa-page-sub">
        Signed in as {session?.name || 'store staff'} with the{' '}
        {session?.role.replace('_', ' ')} role.
      </p>

      <p className="sa-notice">
        Foundation release: authentication, roles and the audit pipeline are live.
        Catalogue editing is not enabled yet, and price editing stays disabled until
        payments read prices from the database.
      </p>

      <div className="sa-grid sa-dashboard-counts">
        {(['PENDING', 'PROCESSING', 'ON_THE_WAY'] as const).map((state) => (
          <Link className="sa-card sa-count-card" href="/store-admin/orders" key={state}>
            <span className="sa-card-kicker">Orders</span>
            <strong className="sa-count-value">{orderCounts ? orderCounts[state] : '—'}</strong>
            <span className="sa-count-label">{SALE_STATE_LABELS[state]}</span>
          </Link>
        ))}
        <Link className="sa-card sa-count-card" href="/store-admin/requests">
          <span className="sa-card-kicker">Inbox</span>
          <strong className="sa-count-value">{openRequests ?? '—'}</strong>
          <span className="sa-count-label">Open requests</span>
        </Link>
        <Link className="sa-card sa-count-card" href="/store-admin/pos">
          <span className="sa-card-kicker">POS</span>
          <strong className="sa-count-value">
            {todayPosTotalPaise !== null ? formatPaise(todayPosTotalPaise) : '—'}
          </strong>
          <span className="sa-count-label">Today’s point-of-sale</span>
        </Link>
        <Link className="sa-card sa-count-card" href="/store-admin/pos/end-of-day">
          <span className="sa-card-kicker">Shift</span>
          <strong className="sa-count-value">{openShift !== null ? `${openShift}` : '—'}</strong>
          <span className="sa-count-label">Open shifts</span>
        </Link>
      </div>

      <div className="sa-grid">
        {AREAS.map((area) => (
          <section key={area.title} className="sa-card">
            <h2 className="sa-card-title">{area.title}</h2>
            <p className="sa-card-note">{area.note}</p>
            <span className="sa-tag">{area.tag}</span>
          </section>
        ))}
      </div>

      <h2 className="sa-section-title">Role capabilities</h2>
      <ul className="sa-capability">
        <li>
          <span>Read catalogue and order data</span>
          <span className="sa-yes">All roles</span>
        </li>
        <li>
          <span>Edit catalogue and stock</span>
          <span className={session?.role === 'store_viewer' ? 'sa-no' : 'sa-yes'}>
            {session?.role === 'store_viewer' ? 'Not for viewers' : 'Admin and owner'}
          </span>
        </li>
        <li>
          <span>Manage store admins</span>
          <span className={session?.role === 'store_owner' ? 'sa-yes' : 'sa-no'}>
            Owner only
          </span>
        </li>
        <li>
          <span>Edit prices</span>
          <span className="sa-no">Disabled until payments read the database</span>
        </li>
      </ul>
    </div>
  );
}

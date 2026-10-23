import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatDate } from '@/lib/store-admin/catalog';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getOrderDetail, type SaleState } from '@/lib/store-admin/orders';
import { OrderControls } from '@/components/store-admin/OrderControls';
import { CustomerRevealForm } from '@/components/store-admin/CustomerRevealForm';
import { OrderPaymentControls } from '@/components/store-admin/OrderPaymentControls';
import { listOrderPayments } from '@/lib/store-admin/payments';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ txnid: string }>;
}

function formatAmount(amountPaise: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(amountPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function stateClass(state: SaleState): string {
  return state === 'PENDING' || state === 'PROCESSING' || state === 'ON_THE_WAY'
    ? 'sa-status sa-status-on'
    : 'sa-status';
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

export default async function StoreAdminOrderDetailPage({ params }: Props) {
  const { txnid } = await params;
  const session = await getStoreSession();
  const result = await getOrderDetail(txnid, session?.role ?? 'store_viewer');

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <Link className="sa-back" href="/store-admin/orders">← Orders</Link>
        <h1 className="sa-page-title">Order unavailable</h1>
        <p className="sa-notice">Order details are not available. Apply migration 0014 and check the database connection.</p>
      </div>
    );
  }

  const order = result.data;
  const paymentsResult = await listOrderPayments(order.id);
  const payments = paymentsResult.ok ? paymentsResult.data : [];
  const paidPaise = payments
    .filter((payment) => payment.status === 'PAID')
    .reduce((sum, payment) => sum + payment.amountPaise, 0);
  const totalPaise = order.totalPaise || Math.round(order.amount * 100);

  return (
    <div>
      <Link className="sa-back" href="/store-admin/orders">← Orders</Link>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Order {order.txnid}</h1>
          <p className="sa-page-sub">Placed {formatDate(order.createdAt)} · transaction reference</p>
        </div>
        <span className={stateClass(order.saleState)}>{SALE_STATE_LABELS[order.saleState]}</span>
      </div>

      <div className="sa-detail-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Payment summary</h2>
          <dl className="sa-meta">
            <div><dt>Sale state</dt><dd>{SALE_STATE_LABELS[order.saleState]}</dd></div>
            <div><dt>Payment</dt><dd>{order.paymentStatus}</dd></div>
            <div><dt>Total</dt><dd>{formatAmount(order.totalPaise || Math.round(order.amount * 100), order.currency)}</dd></div>
            <div><dt>Paid</dt><dd>{order.paidAt ? formatDate(order.paidAt) : '—'}</dd></div>
          </dl>
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Customer</h2>
          <dl className="sa-meta">
            <div><dt>Name</dt><dd>{order.customer.nameMasked}</dd></div>
            <div><dt>Email</dt><dd className="sa-mono">{order.customer.emailMasked}</dd></div>
            <div><dt>Phone</dt><dd className="sa-mono">{order.customer.phoneMasked}</dd></div>
          </dl>
          <p className="sa-lock-note">Customer contact values are masked for every role.</p>
        </section>
      </div>

      {session?.role === 'store_owner' ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Owner contact tools</h2>
          <p className="sa-note">Reveal one customer field only when needed. Every reveal requires a reason and is audited.</p>
          <div className="sa-detail-grid">
            <div className="sa-detail-card">
              <CustomerRevealForm
                customerId={order.txnid}
                field="email"
                label="Email"
                masked={order.customer.emailMasked}
                endpoint={`/api/store-admin/orders/${encodeURIComponent(order.txnid)}/reveal`}
              />
            </div>
            <div className="sa-detail-card">
              <CustomerRevealForm
                customerId={order.txnid}
                field="phone"
                label="Phone"
                masked={order.customer.phoneMasked}
                endpoint={`/api/store-admin/orders/${encodeURIComponent(order.txnid)}/reveal`}
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Items</h2>
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead><tr><th>Item</th><th className="sa-num">Qty</th><th className="sa-num">Unit price</th><th className="sa-num">Line total</th></tr></thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.lineNumber}>
                  <td>{item.productName}<span className="sa-row-sub">{item.productId || `Line ${item.lineNumber}`}</span></td>
                  <td className="sa-num">{item.quantity}</td>
                  <td className="sa-num">{formatAmount(item.unitPricePaise, item.currency || order.currency)}</td>
                  <td className="sa-num">{formatAmount(item.lineTotalPaise, item.currency || order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.items.length === 0 ? <p className="sa-empty">No item snapshot is available.</p> : null}
      </section>

      <div className="sa-detail-grid sa-order-detail-lower">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Delivery</h2>
          {order.delivery ? (
            <dl className="sa-meta">
               <div><dt>Method</dt><dd>{order.delivery.method || '—'}</dd></div>
               {order.delivery.method === 'self' ? <>
                 <div><dt>Delivery person</dt><dd>{order.delivery.personName || '—'}</dd></div>
                 <div><dt>Person phone</dt><dd className="sa-mono">{order.delivery.personPhone ?? order.delivery.personPhoneMasked ?? '—'}</dd></div>
               </> : null}
               <div><dt>Status</dt><dd>{order.delivery.status}</dd></div>
               {order.delivery.method === 'courier' ? <div><dt>Courier</dt><dd>{order.delivery.courierName || order.delivery.carrier || '—'}</dd></div> : null}
              <div><dt>Tracking</dt><dd className="sa-mono">{order.delivery.trackingNumber || '—'}</dd></div>
              {order.delivery.trackingUrl ? <div><dt>Tracking link</dt><dd><a className="sa-product-link" href={order.delivery.trackingUrl} target="_blank" rel="noreferrer">Open link ↗</a></dd></div> : null}
              <div><dt>Scheduled</dt><dd>{order.delivery.scheduledFor ? formatDate(order.delivery.scheduledFor) : '—'}</dd></div>
              <div><dt>Delivered</dt><dd>{order.delivery.deliveredAt ? formatDate(order.delivery.deliveredAt) : '—'}</dd></div>
            </dl>
          ) : <p className="sa-empty">No delivery record is available.</p>}
          <p className="sa-lock-note">Changes are audited and available to admin and owner roles.</p>
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Payments</h2>
          {payments.length ? (
            <table className="sa-table">
              <thead><tr><th>Method</th><th className="sa-num">Amount</th><th className="sa-num">Status</th><th className="sa-num">Recorded</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.method}</td>
                    <td className="sa-num">{formatAmount(payment.amountPaise, order.currency)}</td>
                    <td className="sa-num">{payment.status}</td>
                    <td className="sa-num sa-mono">{payment.createdAt}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} className="sa-num">Covered total</td>
                  <td className="sa-num"><strong>{formatAmount(paidPaise, order.currency)}</strong></td>
                  <td className="sa-num">{paidPaise >= totalPaise ? 'Covers order' : 'Partial'}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="sa-empty">No payments have been recorded for this order.</p>
          )}
          {session && (session.role === 'store_admin' || session.role === 'store_owner') ? (
            <OrderPaymentControls
              txnid={order.txnid}
              canEdit={true}
              totalPaise={totalPaise}
              paidPaise={paidPaise}
              orderPaid={order.paymentStatus === 'PAID'}
            />
          ) : null}
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Addresses</h2>
          {order.addresses.length ? order.addresses.map((address) => (
            <div className="sa-address" key={address.type}>
              <strong>{address.type}</strong>
              <span>{address.fullName} · {address.phoneMasked}</span>
              <span>{address.line1}{address.line2 ? `, ${address.line2}` : ''}</span>
              <span>{address.city}, {address.state} {address.postalCode}</span>
              <span>{address.country}</span>
            </div>
          )) : <p className="sa-empty">No address snapshot is available.</p>}
        </section>
      </div>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">History</h2>
        {order.history.length ? (
          <ol className="sa-timeline">
            {order.history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                <span className="sa-timeline-dot" aria-hidden="true" />
                <div><strong>{entry.toStatus}</strong><span>{entry.domain} · {formatDate(entry.createdAt)}</span></div>
              </li>
            ))}
          </ol>
        ) : <p className="sa-empty">No status history is available.</p>}
      </section>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Operations</h2>
        {session ? <OrderControls order={order} role={session.role} /> : null}
      </section>

      <p className="sa-readonly-foot">Payment gateway payloads and internal notes are not shown.</p>
    </div>
  );
}

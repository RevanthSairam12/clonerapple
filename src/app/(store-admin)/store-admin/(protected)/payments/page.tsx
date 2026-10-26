import Link from 'next/link';

import { formatPaise } from '@/lib/store-admin/amount';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listPendingPayments } from '@/lib/store-admin/payments';
import { ANY_METHOD_LABELS } from '@/lib/store-admin/payment-rules';
import { PaymentReviewActions } from '@/components/store-admin/PaymentReviewActions';

export const dynamic = 'force-dynamic';

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

function waitingFor(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const hours = Math.max(0, Math.floor((Date.now() - then) / 3_600_000));
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

export default async function StoreAdminPaymentsPage() {
  const session = await getStoreSession();
  const result = await listPendingPayments();
  const canReview = session?.role === 'store_admin' || session?.role === 'store_owner';

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Payments</h1>
        <p className="sa-notice">
          Payment records are not available. Apply migration 0021 and check the database connection.
        </p>
      </div>
    );
  }

  const pending = result.data;
  const pendingPaise = pending.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const oldest = pending.reduce<string | null>(
    (value, payment) => (!value || payment.createdAt < value ? payment.createdAt : value),
    null,
  );

  return (
    <div>
      <div className="sa-page-head">
        <div>
          <h1 className="sa-page-title">Payments</h1>
          <p className="sa-page-sub">
            Manual UPI, bank-transfer and “other” entries wait here before they count towards an order.
          </p>
        </div>
        <div className="sa-page-actions">
          <Link className="sa-btn sa-btn-quiet" href="/store-admin/orders">
            Orders
          </Link>
          <Link className="sa-btn sa-btn-quiet" href="/api/store-admin/transactions/export?range=30d">
            Export ledger
          </Link>
        </div>
      </div>

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Awaiting review</span>
          </div>
          <p className="sa-stat-value">{pending.length}</p>
          <span className="sa-stat-meta">Manual payments parked for verification</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Pending value</span>
          </div>
          <p className="sa-stat-value">{formatPaise(pendingPaise)}</p>
          <span className="sa-stat-meta">Not yet counted as collected</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Oldest entry</span>
          </div>
          <p className="sa-stat-value">{oldest ? waitingFor(oldest) : '—'}</p>
          <span className="sa-stat-meta">
            {oldest ? `Recorded ${formatDate(oldest)}` : 'Nothing waiting'}
          </span>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="sa-panel sa-empty-panel">
          <h2 className="sa-card-title">The queue is clear</h2>
          <p className="sa-empty">
            Cash and card-machine payments settle immediately. UPI, bank transfer and “other”
            entries appear here until an owner or admin verifies them.
          </p>
        </div>
      ) : (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Method</th>
                <th className="sa-num">Amount</th>
                <th>Reference</th>
                <th>Recorded by</th>
                <th className="sa-num">Waiting</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <Link
                      className="sa-product-link sa-mono"
                      href={`/store-admin/orders/${encodeURIComponent(payment.txnid)}`}
                    >
                      {payment.txnid}
                    </Link>
                    <span className="sa-row-sub">Order {payment.orderStatus} · total {formatPaise(payment.orderTotalPaise)}</span>
                  </td>
                  <td>
                    {ANY_METHOD_LABELS[payment.method] ?? payment.method}
                    <span className="sa-row-sub">Manual entry</span>
                  </td>
                  <td className="sa-num">{formatPaise(payment.amountPaise)}</td>
                  <td className="sa-mono">
                    {payment.providerRef ?? '—'}
                    {payment.notes ? <span className="sa-row-sub">{payment.notes}</span> : null}
                  </td>
                  <td className="sa-date">{formatDate(payment.createdAt)}</td>
                  <td className="sa-num">{waitingFor(payment.createdAt)}</td>
                  <td>
                    <PaymentReviewActions paymentId={payment.id} canReview={canReview} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="sa-readonly-foot">
        Approving marks the payment paid and re-runs the coverage check; rejecting requires a
        reason and moves the row to failed. Both decisions are audited.
      </p>
    </div>
  );
}

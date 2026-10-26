import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatPaise } from '@/lib/store-admin/amount';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getReturnDetail } from '@/lib/store-admin/returns';
import { isReturnOpen, type ConditionGrade, type ReturnStatus } from '@/lib/store-admin/return-rules';
import { ReturnActions } from '@/components/store-admin/ReturnActions';
import { RefundForm } from '@/components/store-admin/RefundForm';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_LABELS: Record<ReturnStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  RECEIVED: 'Received',
  REFUNDED: 'Refunded',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const GRADE_LABELS: Record<ConditionGrade, string> = {
  RESELLABLE: 'Resellable',
  OPENED: 'Opened',
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI transfer',
  card_machine: 'Card machine reversal',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', DATE_FORMAT);
}

export default async function StoreAdminReturnDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getStoreSession();
  const result = await getReturnDetail(id);

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <Link className="sa-back" href="/store-admin/returns">← Returns</Link>
        <h1 className="sa-page-title">Return unavailable</h1>
        <p className="sa-notice">
          Return records are not available. Apply migration 0023 and check the database connection.
        </p>
      </div>
    );
  }

  const data = result.data;
  const canDecide = session?.role === 'store_admin' || session?.role === 'store_owner';
  const remainingPaise = Math.max(0, data.expectedPaise - data.refundedPaise);
  const refundable = data.status === 'RECEIVED' && remainingPaise > 0;

  return (
    <div>
      <Link className="sa-back" href="/store-admin/returns">← Returns</Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Return {data.id}</h1>
          <p className="sa-page-sub">
            Opened {formatDate(data.createdAt)} ·{' '}
            <Link className="sa-product-link sa-mono" href={`/store-admin/orders/${encodeURIComponent(data.txnid)}`}>
              order {data.txnid}
            </Link>
          </p>
        </div>
        <div className="sa-page-actions">
          <span className={data.status === 'REFUNDED' ? 'sa-status sa-status-done' : 'sa-status'}>
            {STATUS_LABELS[data.status]}
          </span>
        </div>
      </div>

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">Goods value</span></div>
          <p className="sa-stat-value">{formatPaise(data.expectedPaise)}</p>
          <span className="sa-stat-meta">{data.quantity} units across {data.itemCount} lines</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">Refunded</span></div>
          <p className="sa-stat-value">{formatPaise(data.refundedPaise)}</p>
          <span className="sa-stat-meta">{data.refunds.length} manual {data.refunds.length === 1 ? 'entry' : 'entries'}</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">Still to refund</span></div>
          <p className="sa-stat-value">{formatPaise(remainingPaise)}</p>
          <span className="sa-stat-meta">
            {data.status === 'RECEIVED' ? 'Ready to refund' : isReturnOpen(data.status) ? 'Waiting on the workflow' : 'Return closed'}
          </span>
        </div>
      </div>

      <div className="sa-detail-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Request</h2>
          <dl className="sa-meta">
            <div><dt>Status</dt><dd>{STATUS_LABELS[data.status]}</dd></div>
            <div><dt>Source</dt><dd>{data.source === 'customer' ? 'Customer request' : 'Opened by staff'}</dd></div>
            <div><dt>Reason</dt><dd>{data.reason}</dd></div>
            <div><dt>Opened by</dt><dd>{data.createdByEmail ?? '—'}</dd></div>
            <div><dt>Decided</dt><dd>{formatDate(data.decidedAt)}{data.decidedByEmail ? ` · ${data.decidedByEmail}` : ''}</dd></div>
            <div><dt>Received</dt><dd>{formatDate(data.receivedAt)}</dd></div>
            <div><dt>Refunded</dt><dd>{formatDate(data.refundedAt)}</dd></div>
          </dl>
          {data.customerNote ? (
            <p className="sa-note">Customer note: {data.customerNote}</p>
          ) : null}
          {data.staffNote ? (
            <p className="sa-note">Staff note: {data.staffNote}</p>
          ) : null}
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Decision</h2>
          {canDecide ? (
            <ReturnActions returnId={data.id} status={data.status} />
          ) : (
            <p className="sa-lock-note">Viewer access is read-only. Admin and owner roles move returns forward.</p>
          )}
          <p className="sa-note">
            Receiving restocks only lines that were flagged for restock and graded resellable or
            opened. Damaged and defective goods never go back on the shelf.
          </p>
        </section>
      </div>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Items coming back</h2>
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="sa-num">Qty</th>
                <th>Condition</th>
                <th>Restock</th>
                <th className="sa-num">Unit price</th>
                <th className="sa-num">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.productName}
                    <span className="sa-row-sub">{item.productId || 'No product reference'}</span>
                  </td>
                  <td className="sa-num">{item.quantity}</td>
                  <td>{GRADE_LABELS[item.conditionGrade]}</td>
                  <td>{item.restock ? 'When received' : 'No'}</td>
                  <td className="sa-num">{formatPaise(item.unitPricePaise)}</td>
                  <td className="sa-num">{formatPaise(item.quantity * item.unitPricePaise)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="sa-num">Goods value</td>
                <td className="sa-num"><strong>{formatPaise(data.expectedPaise)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Refunds against this return</h2>
        {data.refunds.length ? (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Method</th>
                  <th className="sa-num">Amount</th>
                  <th>Reference</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((refund) => (
                  <tr key={refund.id}>
                    <td className="sa-mono">
                      {refund.id}
                      {refund.reason ? <span className="sa-row-sub">{refund.reason}</span> : null}
                    </td>
                    <td>{METHOD_LABELS[refund.method] ?? refund.method}</td>
                    <td className="sa-num">{formatPaise(refund.amountPaise)}</td>
                    <td className="sa-mono">
                      {refund.providerRef ?? '—'}
                      {refund.note ? <span className="sa-row-sub">{refund.note}</span> : null}
                    </td>
                    <td className="sa-date">
                      {formatDate(refund.recordedAt)}
                      {refund.recordedByEmail ? <span className="sa-row-sub">{refund.recordedByEmail}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sa-empty">No refund has been recorded against this return yet.</p>
        )}
      </section>

      {refundable && canDecide ? (
        <RefundForm
          endpoint={`/api/store-admin/returns/${encodeURIComponent(data.id)}/refund`}
          remainingPaise={remainingPaise}
          suggestedPaise={remainingPaise}
          title="Refund this return"
          hint="Pay the customer outside this app, then record the amount here. The return closes once its full value is refunded."
        />
      ) : null}

      {data.status === 'RECEIVED' && !canDecide ? (
        <p className="sa-lock-note">An admin or owner can record the refund once the goods are in.</p>
      ) : null}

      <p className="sa-readonly-foot">
        Refund rows are immutable. Corrections are made by recording another refund, never by
        editing history.
      </p>
    </div>
  );
}

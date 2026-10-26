import Link from 'next/link';

import { formatPaise } from '@/lib/store-admin/amount';
import { listReturns } from '@/lib/store-admin/returns';
import { RETURN_STATUSES, type ReturnStatus } from '@/lib/store-admin/return-rules';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ status?: string }>;
}

const STATUS_LABELS: Record<ReturnStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  RECEIVED: 'Received',
  REFUNDED: 'Refunded',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Partial<Record<ReturnStatus, string>> = {
  REQUESTED: 'sa-status sa-status-on',
  APPROVED: 'sa-status sa-status-on',
  RECEIVED: 'sa-status sa-status-on',
  REFUNDED: 'sa-status sa-status-done',
  REJECTED: 'sa-status sa-status-danger',
};

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
  return `${Math.floor(hours / 24)} d`;
}

export default async function StoreAdminReturnsPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const result = await listReturns({ status });

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Returns &amp; refunds</h1>
        <p className="sa-notice">
          Return records are not available. Apply migration 0023 and check the database connection.
        </p>
      </div>
    );
  }

  const { returns, counts } = result.data;
  const openPaise = returns
    .filter((row) => row.status === 'REQUESTED' || row.status === 'APPROVED' || row.status === 'RECEIVED')
    .reduce((sum, row) => sum + row.expectedPaise, 0);
  const refundedPaise = returns.reduce((sum, row) => sum + row.refundedPaise, 0);
  const oldestOpen = returns
    .filter((row) => row.status === 'REQUESTED')
    .reduce<string | null>(
      (value, row) => (!value || row.createdAt < value ? row.createdAt : value),
      null,
    );

  return (
    <div>
      <div className="sa-page-head">
        <div>
          <h1 className="sa-page-title">Returns &amp; refunds</h1>
          <p className="sa-page-sub">
            Returns move from request to approval, to receipt, to a manual refund. Goods only
            reach stock when they are marked received.
          </p>
        </div>
        <div className="sa-page-actions">
          <Link className="sa-btn sa-btn-quiet" href="/store-admin/orders">
            Orders
          </Link>
          <Link className="sa-btn sa-btn-quiet" href="/store-admin/settings/reasons">
            Cancellation reasons
          </Link>
        </div>
      </div>

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">Waiting on us</span></div>
          <p className="sa-stat-value">{counts.REQUESTED}</p>
          <span className="sa-stat-meta">{oldestOpen ? `Oldest ${waitingFor(oldestOpen)}` : 'Nothing waiting'}</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">In progress</span></div>
          <p className="sa-stat-value">{counts.APPROVED + counts.RECEIVED}</p>
          <span className="sa-stat-meta">Approved or waiting for the goods</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">Goods expected</span></div>
          <p className="sa-stat-value">{formatPaise(openPaise)}</p>
          <span className="sa-stat-meta">Value of returns not yet refunded</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top"><span className="sa-stat-label">Refunded</span></div>
          <p className="sa-stat-value">{formatPaise(refundedPaise)}</p>
          <span className="sa-stat-meta">{counts.REFUNDED} closed returns</span>
        </div>
      </div>

      <nav className="sa-filter-row" aria-label="Filter returns by status">
        <Link className={`sa-filter-chip${!status ? ' is-active' : ''}`} href="/store-admin/returns">
          All
        </Link>
        {RETURN_STATUSES.map((candidate) => {
          const active = status === candidate;
          return (
            <Link
              key={candidate}
              className={`sa-filter-chip${active ? ' is-active' : ''}`}
              href={`/store-admin/returns?status=${candidate}`}
            >
              {STATUS_LABELS[candidate]} <span className="sa-chip-count">{counts[candidate]}</span>
            </Link>
          );
        })}
      </nav>

      {returns.length === 0 ? (
        <div className="sa-panel sa-empty-panel">
          <h2 className="sa-card-title">No returns here</h2>
          <p className="sa-empty">
            Start a return from a delivered order&apos;s detail page. Requests raised by customers
            also land here once converted.
          </p>
        </div>
      ) : (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Return</th>
                <th>Order</th>
                <th>Items</th>
                <th className="sa-num">Value</th>
                <th className="sa-num">Refunded</th>
                <th>Status</th>
                <th className="sa-date">Opened</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link className="sa-product-link sa-mono" href={`/store-admin/returns/${encodeURIComponent(row.id)}`}>
                      {row.id}
                    </Link>
                    <span className="sa-row-sub">{row.source === 'customer' ? 'Customer request' : 'Opened by staff'}</span>
                  </td>
                  <td>
                    <Link className="sa-product-link sa-mono" href={`/store-admin/orders/${encodeURIComponent(row.txnid)}`}>
                      {row.txnid}
                    </Link>
                  </td>
                  <td>
                    {row.quantity} {row.quantity === 1 ? 'unit' : 'units'}
                    <span className="sa-row-sub">{row.itemCount} {row.itemCount === 1 ? 'line' : 'lines'} · {row.reason}</span>
                  </td>
                  <td className="sa-num">{formatPaise(row.expectedPaise)}</td>
                  <td className="sa-num">
                    {formatPaise(row.refundedPaise)}
                    {row.status === 'REFUNDED' ? null : (
                      <span className="sa-row-sub">
                        {formatPaise(Math.max(0, row.expectedPaise - row.refundedPaise))} to go
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={STATUS_TONE[row.status] ?? 'sa-status'}>{STATUS_LABELS[row.status]}</span>
                  </td>
                  <td className="sa-date">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="sa-readonly-foot">
        Refunds are recorded manually and are append-only. A return closes when its refunded total
        reaches the value of the goods received.
      </p>
    </div>
  );
}

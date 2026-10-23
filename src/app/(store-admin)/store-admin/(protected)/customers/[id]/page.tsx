import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CustomerRevealForm } from '@/components/store-admin/CustomerRevealForm';
import { getStoreSession } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { formatDate } from '@/lib/store-admin/catalog';
import { getCustomerDetail } from '@/lib/store-admin/customers';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

function formatAmount(amount: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function StoreAdminCustomerDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getStoreSession();
  const result = await getCustomerDetail(id);

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();

    return (
      <div>
        <Link className="sa-back" href="/store-admin/customers">
          ← Customers
        </Link>
        <h1 className="sa-page-title">Customer</h1>
        <p className="sa-notice">
          Customer records are not available. Check that the database is
          configured and migrations 0008 and 0009 are applied.
        </p>
      </div>
    );
  }

  const customer = result.data;
  const canReveal = session?.role === 'store_owner';

  // Detail views are audited. No contact details are written to the row.
  await writeAudit({
    actorId: session?.adminId ?? null,
    actorEmail: session?.email ?? null,
    action: 'customer.view',
    entity: 'customer',
    entityId: customer.id,
    reason: 'detail_page',
    route: '/store-admin/customers/[id]',
  });

  return (
    <div>
      <Link className="sa-back" href="/store-admin/customers">
        ← Customers
      </Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">{customer.name}</h1>
          <p className="sa-page-sub">
            Joined {formatDate(customer.joinedAt)} ·{' '}
            {customer.orderCount}{' '}
            {customer.orderCount === 1 ? 'order' : 'orders'}
          </p>
        </div>
        <span className="sa-status sa-status-large">Customer</span>
      </div>

      <div className="sa-detail-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Contact</h2>
          <dl className="sa-meta">
            <div>
              <dt>Email</dt>
              <dd className="sa-mono">{customer.emailMasked}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd className="sa-mono">{customer.phoneMasked}</dd>
            </div>
            <div>
              <dt>Last order</dt>
              <dd>
                {customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}
              </dd>
            </div>
          </dl>
          <p className="sa-lock-note">
            Masked for every role. Phone comes from the most recent order.
          </p>
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Record</h2>
          <dl className="sa-meta">
            <div>
              <dt>Customer id</dt>
              <dd className="sa-mono">{customer.id}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{formatDate(customer.joinedAt)}</dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd>{customer.orderCount}</dd>
            </div>
          </dl>
        </section>
      </div>

      {canReveal ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Owner tools</h2>
          <p className="sa-note">
            Revealing a full value is owner-only, requires a reason and is
            audited. The value is shown once and is not stored.
          </p>
          <div className="sa-detail-grid">
            <div className="sa-detail-card">
              <CustomerRevealForm
                customerId={customer.id}
                field="email"
                label="Email"
                masked={customer.emailMasked}
              />
            </div>
            <div className="sa-detail-card">
              <CustomerRevealForm
                customerId={customer.id}
                field="phone"
                label="Phone"
                masked={customer.phoneMasked}
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Orders</h2>
        {customer.orders.length === 0 ? (
          <p className="sa-empty">This customer has not placed an order.</p>
        ) : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th className="sa-num">Amount</th>
                  <th>Status</th>
                  <th>Placed</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {customer.orders.map((order) => (
                  <tr key={order.txnid}>
                    <td className="sa-mono">{order.txnid}</td>
                    <td className="sa-num">
                      {formatAmount(order.amount, order.currency)}
                    </td>
                    <td>
                      <span
                        className={
                          order.status === 'PAID'
                            ? 'sa-status sa-status-on'
                            : 'sa-status'
                        }
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="sa-date">{formatDate(order.createdAt)}</td>
                    <td className="sa-date">
                      {order.paidAt ? formatDate(order.paidAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {customer.ordersTruncated ? (
          <p className="sa-lock-note">
            Showing the latest {customer.orders.length} of {customer.orderCount}{' '}
            orders.
          </p>
        ) : null}
      </section>

      <p className="sa-readonly-foot">
        Read-only record. Payment gateway payloads are not shown. Detail views
        are written to the audit log.
      </p>
    </div>
  );
}

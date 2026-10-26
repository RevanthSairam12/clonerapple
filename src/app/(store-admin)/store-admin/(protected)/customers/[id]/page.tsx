import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CustomerActions } from '@/components/store-admin/CustomerActions';
import { CustomerNoteForm } from '@/components/store-admin/CustomerNoteForm';
import { CustomerRevealForm } from '@/components/store-admin/CustomerRevealForm';
import { SessionRevoker } from '@/components/store-admin/SessionRevoker';
import { getStoreSession } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { formatDate } from '@/lib/store-admin/catalog';
import { getAccountSecurity } from '@/lib/store-admin/customer-accounts';
import { listCustomerNotes } from '@/lib/store-admin/customer-notes';
import { CUSTOMER_GROUP_LABELS } from '@/lib/store-admin/customer-rules';
import { getCustomerDetail } from '@/lib/store-admin/customers';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'orders', label: 'Orders' },
  { key: 'payments', label: 'Payments' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'notes', label: 'Notes' },
  { key: 'security', label: 'Security' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isTab(value: string | undefined): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

function formatAmount(amount: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusClass(value: string): string {
  if (value === 'PAID' || value === 'active') return 'sa-status sa-status-on';
  if (value === 'blocked' || value === 'FAILED' || value === 'CANCELLED') {
    return 'sa-status sa-status-danger';
  }
  if (value === 'PENDING') return 'sa-status sa-status-warn';
  return 'sa-status';
}

export default async function StoreAdminCustomerDetailPage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab: TabKey = isTab(tab) ? tab : 'overview';

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
          configured and migrations 0008, 0009, 0015 and 0026 are applied.
        </p>
      </div>
    );
  }

  const customer = result.data;
  const canReveal = session?.role === 'store_owner';
  const canEdit = session?.role !== 'store_viewer';
  const canAnonymise = session?.role === 'store_owner';

  const [notes, security] = await Promise.all([
    activeTab === 'notes' ? listCustomerNotes(customer.id) : Promise.resolve(null),
    activeTab === 'security' ? getAccountSecurity(customer.id) : Promise.resolve(null),
  ]);

  // Detail views are audited. No contact details are written to the row.
  await writeAudit({
    actorId: session?.adminId ?? null,
    actorEmail: session?.email ?? null,
    action: 'customer.view',
    entity: 'customer',
    entityId: customer.id,
    reason: activeTab === 'overview' ? 'detail_page' : `detail_page_${activeTab}`,
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
            {customer.orderCount} {customer.orderCount === 1 ? 'order' : 'orders'} ·{' '}
            {CUSTOMER_GROUP_LABELS[customer.group] ?? 'Retail'}
            {customer.anonymised ? ' · anonymised' : ''}
          </p>
        </div>
        <div className="sa-inline-actions">
          <span className={statusClass(customer.status)}>
            {customer.status === 'blocked' ? 'Blocked' : 'Active'}
          </span>
          {canEdit ? (
            <CustomerActions
              customerId={customer.id}
              blocked={customer.status === 'blocked'}
              blockedReason={customer.blockedReason}
              canAnonymise={canAnonymise}
              anonymised={customer.anonymised}
            />
          ) : null}
        </div>
      </div>

      <nav className="sa-detail-tabs" aria-label="Customer sections">
        {TABS.map((entry) => (
          <Link
            key={entry.key}
            href={`/store-admin/customers/${encodeURIComponent(customer.id)}?tab=${entry.key}`}
            className={`sa-detail-tab${entry.key === activeTab ? ' is-active' : ''}`}
            aria-current={entry.key === activeTab ? 'page' : undefined}
          >
            {entry.label}
            {entry.key === 'notes' && notes?.ok ? ` (${notes.data.length})` : ''}
          </Link>
        ))}
      </nav>

      {activeTab === 'overview' ? (
        <>
          <div className="sa-stat-grid">
            <div className="sa-stat">
              <span className="sa-stat-label">Lifetime value</span>
              <span className="sa-stat-value">{formatAmount(customer.lifetimeValue)}</span>
              <span className="sa-row-sub">{customer.paidOrderCount} paid orders</span>
            </div>
            <div className="sa-stat">
              <span className="sa-stat-label">Average order</span>
              <span className="sa-stat-value">{formatAmount(customer.averageOrderValue)}</span>
              <span className="sa-row-sub">Paid orders only</span>
            </div>
            <div className="sa-stat">
              <span className="sa-stat-label">Orders</span>
              <span className="sa-stat-value">{customer.orderCount}</span>
              <span className="sa-row-sub">
                {customer.firstOrderAt ? `First ${formatDate(customer.firstOrderAt)}` : 'No orders yet'}
              </span>
            </div>
            <div className="sa-stat">
              <span className="sa-stat-label">Last order</span>
              <span className="sa-stat-value sa-stat-value-sm">
                {customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}
              </span>
              <span className="sa-row-sub">
                {customer.lastLoginAt ? `Last login ${formatDate(customer.lastLoginAt)}` : 'Never signed in'}
              </span>
            </div>
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
                  <dt>Group</dt>
                  <dd>{CUSTOMER_GROUP_LABELS[customer.group] ?? 'Retail'}</dd>
                </div>
                <div>
                  <dt>Customer id</dt>
                  <dd className="sa-mono">{customer.id}</dd>
                </div>
              </dl>
              <p className="sa-lock-note">
                Masked for every role. The phone prefers the account profile,
                then the most recent order.
              </p>
            </section>

            <section className="sa-detail-card">
              <h2 className="sa-card-title">Account</h2>
              <dl className="sa-meta">
                <div>
                  <dt>Status</dt>
                  <dd>{customer.status === 'blocked' ? 'Blocked' : 'Active'}</dd>
                </div>
                {customer.status === 'blocked' ? (
                  <>
                    <div>
                      <dt>Blocked on</dt>
                      <dd>{customer.blockedAt ? formatDate(customer.blockedAt) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Reason</dt>
                      <dd>{customer.blockedReason || '—'}</dd>
                    </div>
                  </>
                ) : null}
                <div>
                  <dt>Addresses</dt>
                  <dd>{customer.addresses.length}</dd>
                </div>
                <div>
                  <dt>Last login</dt>
                  <dd>{customer.lastLoginAt ? formatDate(customer.lastLoginAt) : '—'}</dd>
                </div>
              </dl>
              <Link
                className="sa-back sa-back-inline"
                href={`/store-admin/customers/${encodeURIComponent(customer.id)}?tab=security`}
              >
                Sessions and login history →
              </Link>
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
        </>
      ) : null}

      {activeTab === 'orders' ? (
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
                      <td>
                        <Link
                          className="sa-mono sa-product-link"
                          href={`/store-admin/orders/${encodeURIComponent(order.txnid)}`}
                        >
                          {order.txnid}
                        </Link>
                      </td>
                      <td className="sa-num">{formatAmount(order.amount, order.currency)}</td>
                      <td>
                        <span className={statusClass(order.status)}>{order.status}</span>
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
      ) : null}

      {activeTab === 'payments' ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Payments</h2>
          {customer.payments.length === 0 ? (
            <p className="sa-empty">No payment attempts on record.</p>
          ) : (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Method</th>
                    <th className="sa-num">Amount</th>
                    <th>Status</th>
                    <th>Reference (masked)</th>
                    <th>Created</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <Link
                          className="sa-mono sa-product-link"
                          href={`/store-admin/orders/${encodeURIComponent(payment.reference)}`}
                        >
                          {payment.reference}
                        </Link>
                      </td>
                      <td>
                        {payment.method}
                        {payment.source === 'gateway' ? (
                          <span className="sa-row-sub">Gateway</span>
                        ) : (
                          <span className="sa-row-sub">Recorded</span>
                        )}
                      </td>
                      <td className="sa-num">{formatAmount(payment.amount)}</td>
                      <td>
                        <span className={statusClass(payment.status)}>{payment.status}</span>
                        {payment.reviewStatus && payment.reviewStatus !== 'NOT_REQUIRED' ? (
                          <span className="sa-row-sub">{payment.reviewStatus}</span>
                        ) : null}
                      </td>
                      <td className="sa-mono">{payment.providerRefMasked || '—'}</td>
                      <td className="sa-date">{formatDate(payment.createdAt)}</td>
                      <td className="sa-date">
                        {payment.paidAt ? formatDate(payment.paidAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="sa-lock-note">
            Gateway payloads and full payment references are not shown here.
            Full reconciliation lives in Sales → Payments.
          </p>
        </section>
      ) : null}

      {activeTab === 'addresses' ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Saved addresses</h2>
          {customer.addresses.length === 0 ? (
            <p className="sa-empty">No saved addresses.</p>
          ) : (
            <div className="sa-detail-grid">
              {customer.addresses.map((address) => (
                <div className="sa-detail-card" key={address.id}>
                  <div className="sa-inline-actions">
                    <strong>{address.name}</strong>
                    {address.isDefault ? <span className="sa-pill">Default</span> : null}
                  </div>
                  <p className="sa-row-sub sa-mono">{address.phoneMasked}</p>
                  <p>{address.line1}</p>
                  {address.line2 ? <p>{address.line2}</p> : null}
                  <p>
                    {address.city}, {address.state} {address.pincode}
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="sa-lock-note">
            Phone numbers are masked. Anonymising the account deletes every
            saved address.
          </p>
        </section>
      ) : null}

      {activeTab === 'notes' ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Internal notes</h2>
          {canEdit ? <CustomerNoteForm customerId={customer.id} /> : null}
          {!notes || !notes.ok ? (
            <p className="sa-notice">Notes are not available.</p>
          ) : notes.data.length === 0 ? (
            <p className="sa-empty">No notes yet. Notes are append-only.</p>
          ) : (
            <ul className="sa-note-list">
              {notes.data.map((note) => (
                <li className="sa-note-card" key={note.id}>
                  <p>{note.body}</p>
                  <span className="sa-row-sub">
                    {note.authorName || 'Store staff'} · {formatDate(note.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === 'security' ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Sessions</h2>
          {!security || !security.ok ? (
            <p className="sa-notice">Session records are not available.</p>
          ) : (
            <>
              <SessionRevoker
                customerId={customer.id}
                sessions={security.data.sessions}
                canEdit={canEdit}
              />
              <h2 className="sa-section-title">Login history</h2>
              {security.data.events.length === 0 ? (
                <p className="sa-empty">No sign-in events recorded yet.</p>
              ) : (
                <div className="sa-table-wrap">
                  <table className="sa-table">
                    <thead>
                      <tr>
                        <th>Outcome</th>
                        <th>Device</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {security.data.events.map((event) => (
                        <tr key={event.id}>
                          <td>
                            <span
                              className={
                                event.outcome === 'success' || event.outcome === 'signup'
                                  ? 'sa-status sa-status-on'
                                  : event.outcome === 'blocked'
                                    ? 'sa-status sa-status-danger'
                                    : 'sa-status sa-status-warn'
                              }
                            >
                              {event.outcome}
                            </span>
                          </td>
                          <td>{event.device}</td>
                          <td className="sa-date">{formatDate(event.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <p className="sa-lock-note">
            The raw IP address and user agent are never stored. The device is a
            short browser · OS label derived at sign-in.
          </p>
        </section>
      ) : null}

      <p className="sa-readonly-foot">
        Detail views are written to the audit log. Payment gateway payloads are
        not shown.
      </p>
    </div>
  );
}

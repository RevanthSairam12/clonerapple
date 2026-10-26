import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatDate } from '@/lib/store-admin/catalog';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getOrderDetail, type SaleState } from '@/lib/store-admin/orders';
import { orderTotals } from '@/lib/store-admin/order-documents';
import { listOrderNotes } from '@/lib/store-admin/order-notes';
import { listOrderEdits } from '@/lib/store-admin/order-edits';
import { listOrderPayments } from '@/lib/store-admin/payments';
import { ANY_METHOD_LABELS } from '@/lib/store-admin/payment-rules';
import {
  listCancellationReasons,
  listOrderRefunds,
  listOrderReturns,
  orderReturnableLines,
} from '@/lib/store-admin/returns';
import { OrderControls } from '@/components/store-admin/OrderControls';
import { OrderCancelForm } from '@/components/store-admin/OrderCancelForm';
import { RefundForm } from '@/components/store-admin/RefundForm';
import { ReturnForm } from '@/components/store-admin/ReturnForm';
import { CustomerRevealForm } from '@/components/store-admin/CustomerRevealForm';
import { OrderPaymentControls } from '@/components/store-admin/OrderPaymentControls';
import { OrderDetailTabs, type DetailTab } from '@/components/store-admin/OrderDetailTabs';
import { OrderNoteForm } from '@/components/store-admin/OrderNoteForm';
import { OrderEditForm } from '@/components/store-admin/OrderEditForm';

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
  const [paymentsResult, notesResult, editsResult, returnsResult, refundsResult, returnableResult, reasonsResult] =
    await Promise.all([
      listOrderPayments(order.id),
      listOrderNotes(order.id),
      listOrderEdits(order.id),
      listOrderReturns(order.id),
      listOrderRefunds(order.id),
      orderReturnableLines(order.id),
      listCancellationReasons(true),
    ]);
  const payments = paymentsResult.ok ? paymentsResult.data : [];
  const notes = notesResult.ok ? notesResult.data : [];
  const edits = editsResult.ok ? editsResult.data : [];
  const orderReturns = returnsResult.ok ? returnsResult.data : [];
  const refunds = refundsResult.ok ? refundsResult.data : [];
  const returnableLines = returnableResult.ok ? returnableResult.data : [];
  const cancelReasons = reasonsResult.ok ? reasonsResult.reasons : [];
  const paidPaise = payments
    .filter((payment) => payment.status === 'PAID')
    .reduce((sum, payment) => sum + payment.amountPaise, 0);
  const refundedPaise = refunds.reduce((sum, refund) => sum + refund.amountPaise, 0);
  const refundablePaise = Math.max(0, paidPaise - refundedPaise);
  const pendingReview = payments.filter((payment) => payment.reviewStatus === 'PENDING').length;
  const totals = orderTotals(order);
  const totalPaise = totals.totalPaise;
  const isOwner = session?.role === 'store_owner';
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const hasShippingAddress = order.addresses.some((address) => address.type === 'shipping');

  const tabs: DetailTab[] = [
    {
      key: 'overview',
      label: 'Overview',
      content: (
        <div className="sa-tab-stack">
          <div className="sa-detail-grid">
            <section className="sa-detail-card">
              <h2 className="sa-card-title">Payment summary</h2>
              <dl className="sa-meta">
                <div><dt>Sale state</dt><dd>{SALE_STATE_LABELS[order.saleState]}</dd></div>
                <div><dt>Payment</dt><dd>{order.paymentStatus}</dd></div>
                <div><dt>Items subtotal</dt><dd>{formatAmount(totals.subtotalPaise, order.currency)}</dd></div>
                {totals.discountPaise > 0 ? (
                  <div><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt><dd>−{formatAmount(totals.discountPaise, order.currency)}</dd></div>
                ) : null}
                {totals.shippingPaise > 0 ? (
                  <div><dt>Shipping</dt><dd>{formatAmount(totals.shippingPaise, order.currency)}</dd></div>
                ) : null}
                <div><dt>Total</dt><dd>{formatAmount(totalPaise, order.currency)}</dd></div>
                <div><dt>Paid</dt><dd>{order.paidAt ? formatDate(order.paidAt) : '—'}</dd></div>
              </dl>
            </section>

            <section className="sa-detail-card">
              <h2 className="sa-card-title">Customer</h2>
              <dl className="sa-meta">
                <div><dt>Name</dt><dd>{order.customer.nameMasked}</dd></div>
                <div><dt>Email</dt><dd className="sa-mono">{order.customer.emailMasked}</dd></div>
                <div><dt>Phone</dt><dd className="sa-mono">{order.customer.phoneMasked}</dd></div>
                <div><dt>Channel</dt><dd>{order.channel === 'pos' ? 'Point of sale' : 'Online store'}</dd></div>
              </dl>
              <p className="sa-lock-note">Customer contact values are masked for every role.</p>
            </section>
          </div>

          <section className="sa-detail-card">
            <h2 className="sa-card-title">Addresses</h2>
            {order.addresses.length ? (
              <div className="sa-address-grid">
                {order.addresses.map((address) => (
                  <div className="sa-address" key={address.type}>
                    <strong>{address.type}</strong>
                    <span>{address.fullName} · {address.phoneMasked}</span>
                    <span>{address.line1}{address.line2 ? `, ${address.line2}` : ''}</span>
                    <span>{address.city}, {address.state} {address.postalCode}</span>
                    <span>{address.country}</span>
                  </div>
                ))}
              </div>
            ) : <p className="sa-empty">No address snapshot is available.</p>}
            {isOwner ? (
              <p className="sa-lock-note">
                The full address is printed on the invoice and packing slip, and each print view is audited.
              </p>
            ) : null}
          </section>

          {canEdit ? (
            <OrderEditForm
              txnid={order.txnid}
              maskedName={order.customer.nameMasked}
              maskedEmail={order.customer.emailMasked}
              maskedPhone={order.customer.phoneMasked}
              hasAddress={hasShippingAddress}
            />
          ) : null}

          <section className="sa-detail-section">
            <h2 className="sa-section-title">Edit history</h2>
            <p className="sa-note">
              Contact and address corrections record masked before/after values in an
              append-only log. Items and amounts cannot be edited here.
            </p>
            {edits.length ? (
              <ol className="sa-edit-log">
                {edits.map((edit) => (
                  <li className="sa-edit-log-item" key={edit.id}>
                    <div className="sa-edit-log-head">
                      <strong>{edit.changedFields.join(', ') || 'No field names recorded'}</strong>
                      <span>{formatDate(edit.createdAt)}</span>
                    </div>
                    <p className="sa-edit-log-reason">{edit.reason}</p>
                    <span className="sa-edit-log-author">{edit.actorEmail}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sa-empty">No edits have been made to this order.</p>
            )}
          </section>

          {isOwner ? (
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
        </div>
      ),
    },
    {
      key: 'items',
      label: 'Items',
      count: order.items.length,
      content: (
        <section className="sa-detail-section">
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
      ),
    },
    {
      key: 'shipment',
      label: 'Shipment',
      content: (
        <div className="sa-tab-stack">
          <section className="sa-detail-card">
            <h2 className="sa-card-title">Delivery</h2>
            {order.delivery ? (
              <dl className="sa-meta">
                <div><dt>Method</dt><dd>{order.delivery.method || '—'}</dd></div>
                {order.delivery.method === 'self' ? (
                  <>
                    <div><dt>Delivery person</dt><dd>{order.delivery.personName || '—'}</dd></div>
                    <div><dt>Person phone</dt><dd className="sa-mono">{order.delivery.personPhone ?? order.delivery.personPhoneMasked ?? '—'}</dd></div>
                  </>
                ) : null}
                <div><dt>Status</dt><dd>{order.delivery.status}</dd></div>
                {order.delivery.method === 'courier' ? <div><dt>Courier</dt><dd>{order.delivery.courierName || order.delivery.carrier || '—'}</dd></div> : null}
                <div><dt>Tracking</dt><dd className="sa-mono">{order.delivery.trackingNumber || '—'}</dd></div>
                {order.delivery.trackingUrl ? (
                  <div><dt>Tracking link</dt><dd><a className="sa-product-link" href={order.delivery.trackingUrl} target="_blank" rel="noreferrer">Open link ↗</a></dd></div>
                ) : null}
                <div><dt>Scheduled</dt><dd>{order.delivery.scheduledFor ? formatDate(order.delivery.scheduledFor) : '—'}</dd></div>
                <div><dt>Delivered</dt><dd>{order.delivery.deliveredAt ? formatDate(order.delivery.deliveredAt) : '—'}</dd></div>
              </dl>
            ) : <p className="sa-empty">No delivery record is available.</p>}
            <p className="sa-lock-note">Fulfilment and delivery changes are audited and available to admin and owner roles.</p>
          </section>

          <section className="sa-detail-section">
            <h2 className="sa-section-title">Update fulfilment</h2>
            {session ? <OrderControls order={order} role={session.role} /> : null}
          </section>

          {canEdit && order.fulfilmentStatus !== 'DELIVERED' && order.fulfilmentStatus !== 'CANCELED' ? (
            <OrderCancelForm txnid={order.txnid} reasons={cancelReasons} paidPaise={paidPaise} />
          ) : null}
        </div>
      ),
    },
    {
      key: 'payments',
      label: 'Payments',
      count: payments.length,
      content: (
        <section className="sa-detail-section">
          {pendingReview > 0 ? (
            <p className="sa-notice">
              {pendingReview} manual {pendingReview === 1 ? 'payment is' : 'payments are'} waiting for
              verification. <Link className="sa-product-link" href="/store-admin/payments">Open the review queue</Link>.
            </p>
          ) : null}
          {payments.length ? (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead><tr><th>Method</th><th className="sa-num">Amount</th><th className="sa-num">Status</th><th className="sa-num">Recorded</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        {ANY_METHOD_LABELS[payment.method] ?? payment.method}
                        <span className="sa-row-sub">
                          {payment.channel}
                          {payment.providerRef ? ` · ${payment.providerRef}` : ''}
                        </span>
                      </td>
                      <td className="sa-num">{formatAmount(payment.amountPaise, order.currency)}</td>
                      <td className="sa-num">
                        {payment.status}
                        {payment.reviewStatus === 'PENDING' ? (
                          <span className="sa-status sa-status-on">Review pending</span>
                        ) : null}
                        {payment.reviewStatus === 'REJECTED' ? (
                          <span className="sa-status sa-status-danger">Rejected</span>
                        ) : null}
                        {payment.rejectionReason ? (
                          <span className="sa-row-sub">{payment.rejectionReason}</span>
                        ) : null}
                      </td>
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
            </div>
          ) : (
            <p className="sa-empty">No payments have been recorded for this order.</p>
          )}
          {canEdit ? (
            <OrderPaymentControls
              txnid={order.txnid}
              canEdit={true}
              totalPaise={totalPaise}
              paidPaise={paidPaise}
              orderPaid={order.paymentStatus === 'PAID'}
            />
          ) : null}
        </section>
      ),
    },
    {
      key: 'returns',
      label: 'Returns',
      count: orderReturns.length + refunds.length,
      content: (
        <div className="sa-tab-stack">
          <section className="sa-detail-section">
            <h2 className="sa-section-title">Return history</h2>
            {orderReturns.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Return</th>
                      <th>Items</th>
                      <th className="sa-num">Value</th>
                      <th className="sa-num">Refunded</th>
                      <th>Status</th>
                      <th className="sa-date">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderReturns.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link
                            className="sa-product-link sa-mono"
                            href={`/store-admin/returns/${encodeURIComponent(row.id)}`}
                          >
                            {row.id}
                          </Link>
                          <span className="sa-row-sub">{row.reason}</span>
                        </td>
                        <td>{row.quantity} {row.quantity === 1 ? 'unit' : 'units'}</td>
                        <td className="sa-num">{formatAmount(row.expectedPaise, order.currency)}</td>
                        <td className="sa-num">{formatAmount(row.refundedPaise, order.currency)}</td>
                        <td>{row.status}</td>
                        <td className="sa-date">{formatDate(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="sa-empty">No return has been opened on this order.</p>
            )}
          </section>

          {refunds.length ? (
            <section className="sa-detail-section">
              <h2 className="sa-section-title">Refunds</h2>
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Refund</th>
                      <th>Method</th>
                      <th className="sa-num">Amount</th>
                      <th>Reference</th>
                      <th className="sa-date">Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refunds.map((refund) => (
                      <tr key={refund.id}>
                        <td className="sa-mono">
                          {refund.id}
                          {refund.returnId ? (
                            <span className="sa-row-sub">
                              From{' '}
                              <Link
                                className="sa-product-link"
                                href={`/store-admin/returns/${encodeURIComponent(refund.returnId)}`}
                              >
                                {refund.returnId}
                              </Link>
                            </span>
                          ) : (
                            <span className="sa-row-sub">Not tied to a return</span>
                          )}
                        </td>
                        <td>
                          {ANY_METHOD_LABELS[refund.method as keyof typeof ANY_METHOD_LABELS] ?? refund.method}
                        </td>
                        <td className="sa-num">{formatAmount(refund.amountPaise, refund.currency || order.currency)}</td>
                        <td className="sa-mono">{refund.providerRef ?? '—'}</td>
                        <td className="sa-date">{formatDate(refund.recordedAt)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} className="sa-num">Refunded total</td>
                      <td className="sa-num"><strong>{formatAmount(refundedPaise, order.currency)}</strong></td>
                      <td colSpan={2} className="sa-num">
                        {refundablePaise > 0 ? `${formatAmount(refundablePaise, order.currency)} still refundable` : 'Fully refunded'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {canEdit && order.fulfilmentStatus === 'DELIVERED' ? (
            <ReturnForm txnid={order.txnid} lines={returnableLines} />
          ) : (
            <p className="sa-lock-note">
              Returns open only after delivery, and only for admin and owner roles.
            </p>
          )}

          {canEdit && paidPaise > 0 && refundablePaise > 0 ? (
            <RefundForm
              endpoint={`/api/store-admin/orders/${encodeURIComponent(order.txnid)}/refund`}
              remainingPaise={refundablePaise}
              currency={order.currency}
              title="Record a refund not tied to a return"
              hint="For goodwill refunds or money back after a cancellation. The captured total is the hard ceiling."
            />
          ) : null}
        </div>
      ),
    },
    {
      key: 'timeline',
      label: 'Timeline',
      count: order.history.length,
      content: (
        <section className="sa-detail-section">
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
      ),
    },
    {
      key: 'notes',
      label: 'Notes',
      count: notes.length,
      content: (
        <section className="sa-detail-section">
          {canEdit ? <OrderNoteForm txnid={order.txnid} /> : (
            <p className="sa-lock-note">Viewer access is read-only. Admin and owner roles can add internal notes.</p>
          )}
          {notes.length ? (
            <ol className="sa-note-list">
              {notes.map((note) => (
                <li className="sa-note" key={note.id}>
                  <p className="sa-note-body">{note.body}</p>
                  <div className="sa-note-meta">
                    <span className="sa-note-author">{note.authorName || 'Staff'}</span>
                    <span>{note.authorEmail}</span>
                    <span>·</span>
                    <span>{formatDate(note.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="sa-empty">No internal notes yet.</p>}
        </section>
      ),
    },
  ];

  return (
    <div>
      <Link className="sa-back" href="/store-admin/orders">← Orders</Link>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Order {order.txnid}</h1>
          <p className="sa-page-sub">Placed {formatDate(order.createdAt)} · transaction reference</p>
        </div>
        <div className="sa-page-actions">
          {isOwner ? (
            <>
              <Link
                className="sa-btn sa-btn-quiet"
                prefetch={false}
                href={`/store-admin/orders/${encodeURIComponent(order.txnid)}/invoice`}
              >
                Invoice
              </Link>
              <Link
                className="sa-btn sa-btn-quiet"
                prefetch={false}
                href={`/store-admin/orders/${encodeURIComponent(order.txnid)}/packing-slip`}
              >
                Packing slip
              </Link>
            </>
          ) : null}
          <span className={stateClass(order.saleState)}>{SALE_STATE_LABELS[order.saleState]}</span>
        </div>
      </div>

      <OrderDetailTabs tabs={tabs} />

      <p className="sa-readonly-foot">Payment gateway payloads are not shown. Internal notes are append-only.</p>
    </div>
  );
}

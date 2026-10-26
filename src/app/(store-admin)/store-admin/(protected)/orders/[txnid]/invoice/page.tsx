import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PrintButton } from '@/components/store-admin/PrintButton';
import { DocumentHeader } from '@/components/store-admin/DocumentHeader';
import { writeAudit } from '@/lib/store-admin/audit';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate } from '@/lib/store-admin/catalog';
import {
  formatRupees,
  getOrderDocument,
  orderTotals,
  type DocumentAddress,
} from '@/lib/store-admin/order-documents';
import { getStoreSettings } from '@/lib/store-admin/settings';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ txnid: string }>;
}

function AddressBlock({ address }: { address: DocumentAddress | null }) {
  if (!address) return <p className="sa-doc-muted">No address snapshot is available.</p>;
  return (
    <address className="sa-doc-address">
      <strong>{address.fullName || 'Customer'}</strong>
      {address.phone ? <span className="sa-mono">{address.phone}</span> : null}
      <span>{address.line1}</span>
      {address.line2 ? <span>{address.line2}</span> : null}
      <span>
        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
      </span>
      <span>{address.country}</span>
    </address>
  );
}

export default async function OrderInvoicePage({ params }: Props) {
  const { txnid } = await params;
  const session = await getStoreSession();

  if (!session) notFound();

  if (session.role !== 'store_owner') {
    return (
      <div className="sa-doc-wrap">
        <Link className="sa-back" href={`/store-admin/orders/${encodeURIComponent(txnid)}`}>
          ← Back to order
        </Link>
        <div className="sa-notice">
          Printable invoices and packing slips show the full delivery address, so
          they are limited to the store owner. Ask the owner to print, or use the
          order detail page for the masked view.
        </div>
      </div>
    );
  }

  const [result, settingsResult] = await Promise.all([
    getOrderDocument(txnid, session.role),
    getStoreSettings(),
  ]);
  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <Link className="sa-back" href="/store-admin/orders">← Orders</Link>
        <h1 className="sa-page-title">Invoice unavailable</h1>
        <p className="sa-notice">
          Order records are not available. Check the database connection.
        </p>
      </div>
    );
  }

  const order = result.data;
  const settings = settingsResult.ok ? settingsResult.settings : null;
  const totals = orderTotals(order);
  const currency = order.currency;
  const shipTo = order.shipTo ?? order.billTo;
  const footer = settings?.receipt_footer?.trim() || '';
  const paymentLabel =
    order.paymentMethod?.replace(/_/g, ' ') ??
    (order.channel === 'pos' ? 'point of sale' : 'online payment');

  await writeAudit({
    actorId: session.adminId,
    actorEmail: session.email,
    action: 'order.document.view',
    entity: 'order',
    entityId: order.id,
    reason: 'invoice_print',
    after: { document: 'invoice', txnid: order.txnid },
    route: `/store-admin/orders/${order.txnid}/invoice`,
  });

  return (
    <div className="sa-doc-wrap">
      <div className="sa-doc-bar">
        <Link className="sa-back sa-back-inline" href={`/store-admin/orders/${encodeURIComponent(order.txnid)}`}>
          ← Back to order
        </Link>
        <div className="sa-doc-bar-actions">
          <Link
            className="sa-btn sa-btn-quiet"
            prefetch={false}
            href={`/store-admin/orders/${encodeURIComponent(order.txnid)}/packing-slip`}
          >
            Packing slip
          </Link>
          <PrintButton label="Print invoice" />
        </div>
      </div>

      <article className="sa-doc-sheet">
        <DocumentHeader
          settings={settings}
          badge="Bill of supply"
          title="Invoice"
          kicker="No tax collected — the business is not GST-registered."
        />

        <div className="sa-doc-parties">
          <section className="sa-doc-block">
            <h2>Bill to</h2>
            <AddressBlock address={order.billTo ?? shipTo} />
          </section>
          <section className="sa-doc-block">
            <h2>Ship to</h2>
            <AddressBlock address={shipTo} />
          </section>
          <section className="sa-doc-block sa-doc-facts">
            <h2>Details</h2>
            <dl className="sa-doc-facts-list">
              <div><dt>Invoice ref</dt><dd className="sa-mono">{order.txnid}</dd></div>
              <div><dt>Order date</dt><dd>{formatDate(order.createdAt)}</dd></div>
              <div><dt>Channel</dt><dd>{order.channel === 'pos' ? 'Point of sale' : 'Online store'}</dd></div>
              <div><dt>Payment</dt><dd>{paymentLabel}</dd></div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`sa-doc-pill${totals.paid ? ' is-paid' : ' is-due'}`}>
                    {totals.paid ? 'Paid' : 'Payment pending'}
                  </span>
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <table className="sa-table sa-doc-table">
          <thead>
            <tr>
              <th className="sa-doc-col-num">#</th>
              <th>Item</th>
              <th className="sa-num">Qty</th>
              <th className="sa-num">Rate</th>
              <th className="sa-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.lineNumber}>
                <td className="sa-doc-col-num">{item.lineNumber}</td>
                <td>
                  {item.productName}
                  {item.productId ? <span className="sa-row-sub">{item.productId}</span> : null}
                </td>
                <td className="sa-num">{item.quantity}</td>
                <td className="sa-num">{formatRupees(item.unitPricePaise, item.currency || currency)}</td>
                <td className="sa-num">{formatRupees(item.lineTotalPaise, item.currency || currency)}</td>
              </tr>
            ))}
            {order.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="sa-doc-muted">No item snapshot is available for this order.</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="sa-doc-totals">
          <div className="sa-doc-total-row">
            <span>Subtotal</span>
            <span>{formatRupees(totals.subtotalPaise, currency)}</span>
          </div>
          {totals.discountPaise > 0 ? (
            <div className="sa-doc-total-row">
              <span>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</span>
              <span>−{formatRupees(totals.discountPaise, currency)}</span>
            </div>
          ) : null}
          {totals.shippingPaise > 0 ? (
            <div className="sa-doc-total-row">
              <span>Shipping</span>
              <span>{formatRupees(totals.shippingPaise, currency)}</span>
            </div>
          ) : null}
          <div className="sa-doc-total-row is-total">
            <span>Total</span>
            <span>{formatRupees(totals.totalPaise, currency)}</span>
          </div>
          {!totals.paid ? (
            <div className="sa-doc-total-row is-due">
              <span>Balance due</span>
              <span>{formatRupees(totals.balancePaise, currency)}</span>
            </div>
          ) : null}
        </div>

        <footer className="sa-doc-note">
          {footer ? <p>{footer}</p> : null}
          <p>
            This document is a bill of supply for a non-GST-registered business. It
            is not a tax invoice and no GST has been charged.
          </p>
          <p>
            Invoice reference {order.txnid} · generated from the store back office on{' '}
            {formatDate(new Date().toISOString())}.
          </p>
        </footer>
      </article>
    </div>
  );
}

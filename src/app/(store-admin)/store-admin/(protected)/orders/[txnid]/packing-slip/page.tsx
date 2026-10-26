import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PrintButton } from '@/components/store-admin/PrintButton';
import { DocumentHeader } from '@/components/store-admin/DocumentHeader';
import { writeAudit } from '@/lib/store-admin/audit';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate } from '@/lib/store-admin/catalog';
import { getOrderDocument, type DocumentAddress } from '@/lib/store-admin/order-documents';
import { getStoreSettings } from '@/lib/store-admin/settings';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ txnid: string }>;
}

function ShipTo({ address }: { address: DocumentAddress | null }) {
  if (!address) return <p className="sa-doc-muted">No address snapshot is available.</p>;
  return (
    <address className="sa-doc-address sa-doc-address-lg">
      <strong>{address.fullName || 'Customer'}</strong>
      <span>{address.line1}</span>
      {address.line2 ? <span>{address.line2}</span> : null}
      <span>
        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
      </span>
      <span>{address.country}</span>
      {address.phone ? <span className="sa-mono">Phone: {address.phone}</span> : null}
    </address>
  );
}

export default async function OrderPackingSlipPage({ params }: Props) {
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
        <h1 className="sa-page-title">Packing slip unavailable</h1>
        <p className="sa-notice">
          Order records are not available. Check the database connection.
        </p>
      </div>
    );
  }

  const order = result.data;
  const settings = settingsResult.ok ? settingsResult.settings : null;
  const shipTo = order.shipTo ?? order.billTo;
  const footer = settings?.receipt_footer?.trim() || '';
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const delivery = order.delivery;
  const methodLabel =
    delivery?.method === 'self'
      ? 'Local delivery'
      : delivery?.method === 'courier'
      ? 'Courier'
      : 'Not set yet';

  await writeAudit({
    actorId: session.adminId,
    actorEmail: session.email,
    action: 'order.document.view',
    entity: 'order',
    entityId: order.id,
    reason: 'packing_slip_print',
    after: { document: 'packing_slip', txnid: order.txnid },
    route: `/store-admin/orders/${order.txnid}/packing-slip`,
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
            href={`/store-admin/orders/${encodeURIComponent(order.txnid)}/invoice`}
          >
            Invoice
          </Link>
          <PrintButton label="Print packing slip" />
        </div>
      </div>

      <article className="sa-doc-sheet">
        <DocumentHeader
          settings={settings}
          badge="Shipment"
          title="Packing slip"
          kicker="Prices are intentionally omitted. Hand this page to the courier."
        />

        <div className="sa-doc-parties sa-doc-parties-slip">
          <section className="sa-doc-block">
            <h2>Ship to</h2>
            <ShipTo address={shipTo} />
          </section>
          <section className="sa-doc-block sa-doc-facts">
            <h2>Shipment</h2>
            <dl className="sa-doc-facts-list">
              <div><dt>Order ref</dt><dd className="sa-mono">{order.txnid}</dd></div>
              <div><dt>Placed</dt><dd>{formatDate(order.createdAt)}</dd></div>
              <div><dt>Method</dt><dd>{methodLabel}</dd></div>
              {delivery?.courierName ? (
                <div><dt>Courier</dt><dd>{delivery.courierName}</dd></div>
              ) : null}
              {delivery?.trackingNumber ? (
                <div><dt>Tracking</dt><dd className="sa-mono">{delivery.trackingNumber}</dd></div>
              ) : null}
              <div><dt>Pieces</dt><dd>{order.items.length} lines · {units} units</dd></div>
            </dl>
          </section>
        </div>

        <table className="sa-table sa-doc-table">
          <thead>
            <tr>
              <th className="sa-doc-col-num">#</th>
              <th>Item</th>
              <th>SKU</th>
              <th className="sa-num">Qty</th>
              <th className="sa-doc-col-check">✓</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.lineNumber}>
                <td className="sa-doc-col-num">{item.lineNumber}</td>
                <td>{item.productName}</td>
                <td className="sa-mono">{item.productId || '—'}</td>
                <td className="sa-num sa-doc-qty">{item.quantity}</td>
                <td className="sa-doc-col-check"><span className="sa-doc-check" aria-hidden="true" /></td>
              </tr>
            ))}
            {order.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="sa-doc-muted">No item snapshot is available for this order.</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <p className="sa-doc-callout">
          Check every line against the order before sealing the parcel. This slip
          carries no prices, so it can travel inside the parcel with the goods.
        </p>

        <div className="sa-doc-sign">
          <span>Packed by</span>
          <span>Received by / date</span>
        </div>

        <footer className="sa-doc-note">
          {footer ? <p>{footer}</p> : null}
          <p>
            Packing slip for {order.txnid} · printed from the store back office on{' '}
            {formatDate(new Date().toISOString())}.
          </p>
        </footer>
      </article>
    </div>
  );
}

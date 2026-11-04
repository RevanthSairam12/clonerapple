import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PrintButton } from '@/components/store-admin/PrintButton';
import { documentTitle, OrderDocument } from '@/components/orders/OrderDocument';
import { getDocumentState } from '@/lib/orders/document-data';
import { writeAudit } from '@/lib/store-admin/audit';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getOrderDocument, orderTotals } from '@/lib/store-admin/order-documents';
import { getStoreSettings } from '@/lib/store-admin/settings';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ txnid: string }>;
}

export default async function OrderInvoicePage({ params }: Props) {
  const { txnid } = await params;
  const session = await getStoreSession();
  if (!session) notFound();
  if (session.role !== 'store_owner') {
    return <div className="sa-doc-wrap">
      <Link className="sa-back" href={`/store-admin/orders/${encodeURIComponent(txnid)}`}>← Back to order</Link>
      <div className="sa-notice">Printable invoices and packing slips show the full delivery address, so they are limited to the store owner. Ask the owner to print, or use the order detail page for the masked view.</div>
    </div>;
  }

  const [result, settingsResult] = await Promise.all([
    getOrderDocument(txnid, session.role), getStoreSettings(),
  ]);
  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return <div><Link className="sa-back" href="/store-admin/orders">← Orders</Link><h1 className="sa-page-title">Document unavailable</h1><p className="sa-notice">Order records are not available. Check the database connection.</p></div>;
  }
  const order = result.data;
  const state = await getDocumentState(order.id);
  const settings = settingsResult.ok ? settingsResult.settings : null;
  await writeAudit({
    actorId: session.adminId, actorEmail: session.email, action: 'order.document.view',
    entity: 'order', entityId: order.id, reason: 'invoice_print',
    after: { document: state.kind, txnid: order.txnid },
    route: `/store-admin/orders/${order.txnid}/invoice`,
  });

  return <div className="sa-doc-wrap">
    <div className="sa-doc-bar">
      <Link className="sa-back sa-back-inline" href={`/store-admin/orders/${encodeURIComponent(order.txnid)}`}>← Back to order</Link>
      <div className="sa-doc-bar-actions">
        <Link className="sa-btn sa-btn-quiet" prefetch={false} href={`/store-admin/orders/${encodeURIComponent(order.txnid)}/packing-slip`}>Packing slip</Link>
        <PrintButton label={`Print ${documentTitle(state).toLowerCase()}`} />
      </div>
    </div>
    <OrderDocument state={state} settings={settings} totals={orderTotals(order)} order={{
      ...order,
      paymentLabel: order.paymentMethod?.replace(/_/g, ' ') ?? (order.channel === 'pos' ? 'point of sale' : 'online payment'),
    }} />
  </div>;
}

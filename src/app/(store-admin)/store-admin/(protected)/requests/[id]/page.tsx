import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrderRequestControls } from '@/components/store-admin/OrderRequestControls';
import { getOrderRequestDetail, REQUESTS_UNAVAILABLE_MESSAGE } from '@/lib/store-admin/order-requests';
import { getStoreSession } from '@/lib/store-admin/auth';

export const dynamic = 'force-dynamic';

export default async function StoreAdminRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStoreSession();
  const { id } = await params;
  const result = await getOrderRequestDetail(id);
  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <div className="sa-breadcrumb"><Link href="/store-admin/requests">← Requests</Link></div>
        <h1 className="sa-page-title">Request unavailable</h1>
        <p className="sa-notice">{REQUESTS_UNAVAILABLE_MESSAGE}</p>
      </div>
    );
  }
  const request = result.data;
  return <div><div className="sa-breadcrumb"><Link href="/store-admin/requests">← Requests</Link></div><h1 className="sa-page-title">{request.type} request</h1><p className="sa-page-sub">Request {request.id} · {request.createdAt.toLocaleString('en-IN')}</p><div className="sa-detail-grid"><section className="sa-card"><h2 className="sa-card-title">Order summary</h2><dl className="sa-detail-list"><div><dt>Order</dt><dd><Link className="sa-table-link" href={`/store-admin/orders/${request.txnid}`}>{request.txnid}</Link></dd></div><div><dt>Customer</dt><dd>{request.customerName}<br /><span className="sa-muted">{request.customerEmail} · {request.customerPhone}</span></dd></div><div><dt>Amount</dt><dd>₹{request.amount.toLocaleString('en-IN')}</dd></div><div><dt>Payment</dt><dd>{request.paymentStatus}</dd></div><div><dt>Fulfilment</dt><dd>{request.fulfilmentStatus}</dd></div></dl></section><section className="sa-card"><h2 className="sa-card-title">Customer message</h2><p className="sa-request-reason">{request.reason}</p><p className="sa-muted">Changing this request does not cancel, refund, or change the order. Use the order page for existing fulfilment controls.</p></section>{session?.role !== 'store_viewer' ? <OrderRequestControls id={request.id} currentStatus={request.status} currentNote={request.adminNote} /> : <section className="sa-card"><h2 className="sa-card-title">Staff response</h2><p className="sa-muted">Viewers can read requests. Admins and owners can update them.</p></section>}</div></div>;
}

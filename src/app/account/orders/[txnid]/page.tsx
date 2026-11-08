import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountFrame } from '@/components/account/AccountFrame';
import { LiveOrderPoller } from '@/components/account/LiveOrderPoller';
import { OrderRequestButtons } from '@/components/account/OrderRequestButtons';
import { OrderStatusChip } from '@/components/account/OrderStatusChip';
import { requireAccountPageSession } from '@/lib/account/auth';
import { getCustomerOrderDetail } from '@/lib/account/orders';
import { getCustomerDocumentState } from '@/lib/orders/document-data';
import { optionSnapshotLabel } from '@/lib/orders/option-snapshot';
import { OrderDocumentStatus } from '@/components/orders/OrderDocument';
import {
  accountOrderHistoryLabel,
  accountRequestStatusLabel,
  accountRequestTypeLabel,
  isInFlightAccountOrderStatus,
} from '@/lib/account/order-live';

import { FULFILMENT_STEPS, fulfilmentLabel, hasShipmentStarted } from '@/lib/orders/fulfilment';
import { validateHttpsTrackingUrl } from '@/lib/store-admin/delivery';

export const dynamic = 'force-dynamic';

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ txnid: string }> }) {
  const { txnid } = await params;
  const session = await requireAccountPageSession(`/account/orders/${encodeURIComponent(txnid)}`);
  const order = await getCustomerOrderDetail(session.userId, txnid);
  if (!order) notFound();
  const documentState = await getCustomerDocumentState(order.id);

  const inFlight = isInFlightAccountOrderStatus(order.status);
  const shipmentStarted = hasShipmentStarted(order.fulfilmentStatus, order.history);
  const trackingUrl = shipmentStarted ? validateHttpsTrackingUrl(order.trackingUrl) : null;
  const timeline = order.history.flatMap((entry) => {
    const label = accountOrderHistoryLabel(entry.domain, entry.toStatus, shipmentStarted ? order.deliveryMethod : null);
    return label ? [{ ...entry, label }] : [];
  });
  return (
    <AccountFrame session={session} active="/account/orders">
      <div className="space-y-5">
        {inFlight && <LiveOrderPoller txnid={order.txnid} initialStatus={order.status} />}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/account/orders" className="text-sm font-semibold text-[#1d1d1f]">← All orders</Link>
            <h2 className="mt-3 font-mono text-2xl font-semibold">{order.txnid}</h2>
            <p className="mt-1 text-sm text-[#6e6e73]">Placed {order.createdAt.toLocaleString('en-IN')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <OrderStatusChip status={order.status} />
              <span className="inline-flex items-center rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-semibold text-[#1d1d1f]" data-status-domain="payment">
                Payment: {documentState.paymentStatusLabel}
              </span>
              <span className="inline-flex items-center rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-semibold text-[#1d1d1f]" data-status-domain="order">
                Order: {documentState.orderStatusLabel}
              </span>
              <span className="text-sm text-[#6e6e73]">{documentState.label}</span>
            </div>
            {inFlight && (
              <p className="mt-2 text-xs text-[#6e6e73]" role="status">
                This page updates automatically every 30 seconds while the order is in progress.
              </p>
            )}
          </div>
          {(documentState.canViewInvoice || documentState.canViewReceipt) && <Link prefetch={false} href={`/account/orders/${encodeURIComponent(order.txnid)}/receipt${documentState.canViewInvoice ? '?document=invoice' : ''}`} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
            {documentState.canViewInvoice ? 'View / Print invoice' : 'View Payment receipt'}
          </Link>}
        </div>

        <OrderDocumentStatus state={documentState} currency={order.currency} customer />

        <section aria-label="Fulfilment progress" className="rounded-3xl border border-[#e5e5ea] bg-white p-5">
          <h3 className="font-semibold">{fulfilmentLabel(order.fulfilmentStatus, shipmentStarted ? order.deliveryMethod : null)}</h3>
          <p className="mt-2 text-sm text-[#6e6e73]">
            {FULFILMENT_STEPS.map((step) => fulfilmentLabel(step, shipmentStarted ? order.deliveryMethod : null)).join(' → ')}
          </p>
        </section>

        <OrderRequestButtons
          txnid={order.txnid}
          canCancel={order.canRequestCancellation}
          canReturn={order.canRequestReturn}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold">Items</h3>
            <div className="mt-4 divide-y divide-[#e5e5ea]">
              {order.items.map((item, index) => (
                <div key={`${item.id}:${item.variantId ?? 'legacy'}:${index}`} className="flex gap-4 py-4">
                  <div className="h-20 w-20 shrink-0 rounded-2xl bg-[#f5f5f7] p-2">
                    {item.image && <img src={item.image} alt={item.imageAlt ?? item.name} className="h-full w-full object-contain" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold">{item.name}</h4>
                    {optionSnapshotLabel(item) && <p className="text-sm text-[#6e6e73]">{optionSnapshotLabel(item)}</p>}
                    {item.variantSku && <p className="text-xs text-[#6e6e73]">SKU: {item.variantSku}</p>}
                    <p className="mt-1 text-sm text-[#6e6e73]">Qty {item.quantity} · ₹{item.unitPrice.toLocaleString('en-IN')} each</p>
                  </div>
                  <p className="font-semibold">₹{item.totalPrice.toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-[#e5e5ea] pt-4 text-sm">
              <div className="flex justify-between"><span className="text-[#6e6e73]">Subtotal</span><span>₹{(order.subtotalPaise / 100).toLocaleString('en-IN')}</span></div>
              {order.discountPaise > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</span>
                  <span>−₹{(order.discountPaise / 100).toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#6e6e73]">Shipping</span>
                <span>{order.shippingPaise === 0 ? 'Free' : `₹${(order.shippingPaise / 100).toLocaleString('en-IN')}`}</span>
              </div>
              {documentState.refundedPaise > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Refunded</span>
                  <span>−₹{(documentState.refundedPaise / 100).toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-semibold"><span>Total</span><span>₹{order.amount.toLocaleString('en-IN')}</span></div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Delivery</h3>
              {shipmentStarted ? (
                <>
                  <p className="mt-3 text-sm text-[#6e6e73]">
                    {fulfilmentLabel(order.fulfilmentStatus, order.deliveryMethod)}
                    {order.deliveryMethod ? ` · ${order.deliveryMethod === 'self' ? 'Store delivery' : 'Courier'}` : ''}
                    {order.courier ? ` · ${order.courier}` : ''}
                  </p>
                  {order.trackingNumber && <p className="mt-2 text-sm">Tracking {order.trackingNumber}</p>}
                  {trackingUrl && (
                    <a className="mt-3 inline-block text-sm font-semibold text-[#1d1d1f]" href={trackingUrl} target="_blank" rel="noreferrer">
                      Track delivery →
                    </a>
                  )}
                  {order.scheduledFor && <p className="mt-2 text-sm">Scheduled {new Date(order.scheduledFor).toLocaleString('en-IN')}</p>}
                  {order.deliverySlot && <p className="mt-2 text-sm">Delivery slot {order.deliverySlot}</p>}
                  {order.deliveredAt && <p className="mt-2 text-sm">Delivered {order.deliveredAt.toLocaleString('en-IN')}</p>}
                </>
              ) : order.fulfilmentStatus === 'CANCELED' || order.paymentStatus === 'CANCELLED' ? (
                <p className="mt-3 text-sm text-[#6e6e73]">Shipment cancelled.</p>
              ) : (
                <p className="mt-3 text-sm text-[#6e6e73]">Shipment details will appear after pickup.</p>
              )}
              {order.address && (
                <p className="mt-4 text-sm leading-6">
                  {order.address.name}<br />
                  {order.address.line1}{order.address.line2 ? `, ${order.address.line2}` : ''}<br />
                  {order.address.city}, {order.address.state} {order.address.pincode}<br />
                  {order.address.phone}
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Requests</h3>
              {order.requests.length === 0 ? (
                <p className="mt-3 text-sm text-[#6e6e73]">No requests on this order.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {order.requests.map((request) => (
                    <li key={request.id} className="flex justify-between gap-3">
                      <span>{accountRequestTypeLabel(request.type)}</span>
                      <span className="text-[#6e6e73]">{accountRequestStatusLabel(request.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {order.refunds.length > 0 && (
                <>
                  <h3 className="mt-5 font-semibold">Refunds</h3>
                  <ul className="mt-3 space-y-2 text-sm">
                    {order.refunds.map((refund) => (
                      <li key={refund.id} className="flex justify-between gap-3">
                        <span>₹{(refund.amountPaise / 100).toLocaleString('en-IN')}</span>
                        <span className="text-[#6e6e73]">{refund.method.replaceAll('_', ' ')}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Status timeline</h3>
              <ol className="mt-4 space-y-4">
                {timeline.map((entry, index) => (
                  <li key={`${entry.createdAt.toISOString()}-${index}`} className="relative pl-6 text-sm">
                    <span className="absolute left-0 top-1 h-3 w-3 rounded-full bg-[#1d1d1f]" />
                    <p className="font-semibold">{entry.label}</p>
                    <p className="text-xs text-[#6e6e73]">{entry.createdAt.toLocaleString('en-IN')} · {entry.domain}</p>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
        <p className="text-sm text-[#6e6e73]">
          Need help? <Link href="/support" className="font-semibold text-[#1d1d1f]">Contact Gadzio Support</Link>
        </p>
      </div>
    </AccountFrame>
  );
}
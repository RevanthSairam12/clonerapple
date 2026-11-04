import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckPaymentButton } from '@/components/checkout/CheckPaymentButton';
import { ClearCartOnSuccess } from '@/components/checkout/ClearCartOnSuccess';
import { formatPaise } from '@/lib/catalog/storefront';
import { accountOrderHistoryLabel } from '@/lib/account/order-live';
import { getCustomerOrderStatus } from '@/lib/order-status';
import { getCustomerDocumentState } from '@/lib/orders/document-data';
import { fulfilmentLabel, hasShipmentStarted } from '@/lib/orders/fulfilment';
import { customerOrderResult } from '@/lib/orders/result-state';
import { carryReturnToken, resolveReturnAccess } from '@/lib/payu/return-access';
import { validateHttpsTrackingUrl } from '@/lib/store-admin/delivery';
import { getUserSession } from '@/lib/user-auth';

export interface OrderResultPageProps {
  searchParams: Promise<{ txnid?: string; rt?: string; recovery?: string }>;
}

const primaryAction = 'flex min-h-12 items-center justify-center rounded-xl bg-[#ffe100] px-6 py-3 text-center text-sm font-bold text-black transition hover:bg-[#ffea33] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black';
const secondaryAction = 'flex min-h-12 items-center justify-center rounded-xl border border-black/20 bg-white px-6 py-3 text-center text-sm font-semibold text-black transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black';

function ResultCard({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">{children}</div>;
}

function Unavailable({ signIn = false, missing = false }: { signIn?: boolean; missing?: boolean }) {
  return <ResultCard>
    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{signIn ? 'Sign in to view this order' : 'Order status unavailable'}</h1>
    <p className="mt-3 text-sm leading-relaxed text-[#333336]">{signIn
      ? 'Please sign in with the account that placed this order, or use a valid payment return link.'
      : missing ? 'No transaction identifier was provided.' : 'We could not load this order. Check your reference or try again later.'}</p>
    <div className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="Order actions">
      {signIn && <Link href="/auth" className={primaryAction}>Sign in</Link>}
      <Link href="/" className={signIn ? secondaryAction : primaryAction}>Continue shopping</Link>
    </div>
  </ResultCard>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  });
}

/** All five entry URLs use the same access gate and authoritative financial wording. */
export async function OrderResultPage({ searchParams, route }: OrderResultPageProps & {
  route: 'success' | 'status' | 'processing' | 'failed' | 'cancelled';
}) {
  const query = await searchParams;
  // Duplicate query parameters are not valid credentials or order references.
  const txnid = typeof query.txnid === 'string' ? query.txnid : undefined;
  const rt = typeof query.rt === 'string' ? query.rt : undefined;
  const recovery = typeof query.recovery === 'string' ? query.recovery : undefined;
  const preserveCart = recovery === '1';
  if (!txnid) return <Unavailable missing />;

  const [session, result] = await Promise.all([getUserSession(), getCustomerOrderStatus(txnid)]);
  if (!result.ok) return <Unavailable />;
  const order = result.data;
  const access = resolveReturnAccess({
    txnid: order.txnid, token: rt, userId: order.userId,
    sessionUserId: session?.userId ?? null,
  });
  if (!access) return <Unavailable signIn />;

  // Read document facts only after return access is established. The customer
  // projection strips pre-delivery invoice identity; no document DTO goes to guests.
  let documentState;
  try {
    documentState = await getCustomerDocumentState(order.id);
  } catch {
    return <Unavailable />;
  }
  const state = customerOrderResult(documentState, order.paymentReviewRequired, order.reservationState);
  const summaryOnly = access === 'summary';
  const withToken = (href: string) => carryReturnToken(href, summaryOnly ? rt ?? null : null);
  const statusHref = withToken(`/order/status?txnid=${encodeURIComponent(order.txnid)}${preserveCart ? '&recovery=1' : ''}`);
  // The status summary never links back to success (which could clear a newer bag).
  const summaryHref = access === 'owner' ? `/account/orders/${encodeURIComponent(order.txnid)}`
    : route === 'status' ? '#order-summary' : statusHref;
  const reference = order.orderNumber ? `#${order.orderNumber}` : order.txnid;
  const shipmentStarted = hasShipmentStarted(order.fulfilmentStatus, order.history);
  const delivery = !summaryOnly && shipmentStarted ? order.delivery : null;
  const trackingUrl = validateHttpsTrackingUrl(delivery?.trackingUrl);
  const timeline = order.history.map((entry) => ({ ...entry,
    label: accountOrderHistoryLabel(entry.domain, entry.toStatus, delivery?.method),
  })).filter((entry): entry is typeof entry & { label: string } => Boolean(entry.label));
  const amount = state.amountLabel === 'Amount received' ? documentState.capturedPaise : order.totalPaise;

  return <ResultCard>
    {route === 'success' && state.confirmedActiveOrder && !preserveCart && <ClearCartOnSuccess />}
    <header>
      <p className="inline-block rounded-md bg-[#ffe100] px-3 py-1 text-xs font-bold uppercase tracking-wider">{state.kind === 'success' ? 'Payment confirmed' : 'Order update'}</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{state.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-[#333336]">{state.message}</p>
    </header>

    <section id="order-summary" tabIndex={-1} className="mt-8 scroll-mt-32 rounded-2xl border border-black/10 bg-[#e8eaee]/40 p-5 focus-visible:outline-2 focus-visible:outline-black" aria-label="Order summary">
      <dl className="space-y-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#333336]">Order reference</dt><dd className="min-w-0 break-all font-semibold">{reference}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt className="text-[#333336]">{state.amountLabel}</dt><dd className="text-lg font-bold">{formatPaise(amount)}</dd></div>
        {documentState.pendingRefundPaise > 0 && <div className="flex flex-wrap justify-between gap-2"><dt>Refund initiated</dt><dd>{formatPaise(documentState.pendingRefundPaise)}</dd></div>}
        {documentState.refundedPaise > 0 && <div className="flex flex-wrap justify-between gap-2"><dt>Refund completed</dt><dd>{formatPaise(documentState.refundedPaise)}</dd></div>}
        {documentState.refundDuePaise > 0 && <div className="flex flex-wrap justify-between gap-2"><dt>Refund due — not yet initiated</dt><dd>{formatPaise(documentState.refundDuePaise)}</dd></div>}
      </dl>
    </section>

    {route === 'status' && <>
      <section className="mt-8" aria-labelledby="order-timeline-title">
        <h2 id="order-timeline-title" className="text-base font-bold">Status timeline</h2>
        {timeline.length ? <ol className="mt-4 space-y-4 border-l-2 border-black/15 pl-5">
          {timeline.map((entry, index) => <li key={`${entry.createdAt}-${index}`}>
            <p className="text-sm font-semibold">{entry.label}</p>
            <p className="mt-1 text-xs text-[#333336]">{formatDate(entry.createdAt)}</p>
          </li>)}
        </ol> : <p className="mt-3 text-sm text-[#333336]">No status updates are available yet.</p>}
      </section>
      {delivery && <section className="mt-8 rounded-2xl border border-black/10 p-5" aria-label="Delivery details">
        <h2 className="text-base font-bold">Delivery</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div><dt className="text-[#333336]">Status</dt><dd className="font-semibold">{fulfilmentLabel(order.fulfilmentStatus, delivery.method)}</dd></div>
          {delivery.carrier && <div><dt className="text-[#333336]">Courier</dt><dd>{delivery.carrier}</dd></div>}
          {delivery.trackingNumber && <div><dt className="text-[#333336]">Tracking reference</dt><dd className="break-all">{delivery.trackingNumber}</dd></div>}
          {delivery.scheduledFor && <div><dt className="text-[#333336]">Scheduled</dt><dd>{formatDate(delivery.scheduledFor)}</dd></div>}
          {delivery.deliverySlot && <div><dt className="text-[#333336]">Delivery slot</dt><dd>{delivery.deliverySlot}</dd></div>}
          {delivery.deliveredAt && <div><dt className="text-[#333336]">Delivered</dt><dd>{formatDate(delivery.deliveredAt)}</dd></div>}
        </dl>
        {trackingUrl && <a href={trackingUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-black">Open courier tracking</a>}
      </section>}
      {access === 'owner' && (documentState.canViewInvoice || documentState.canViewReceipt) && <p className="mt-6 text-sm">
        <Link prefetch={false} className="font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-black"
          href={`/account/orders/${encodeURIComponent(order.txnid)}/receipt${documentState.canViewInvoice ? '?document=invoice' : ''}`}>
          {documentState.canViewInvoice ? 'View invoice' : 'Payment receipt'}
        </Link>
      </p>}
    </>}

    <div className="mt-8 grid items-start gap-3 sm:grid-cols-2" aria-label="Order actions">
      {state.canCheck ? access === 'owner' ? <CheckPaymentButton txnid={order.txnid} />
        : <a href={statusHref} className={primaryAction}>Refresh status</a>
        : <Link prefetch={false} href={state.canRetry ? '/checkout' : summaryHref} className={primaryAction}>{state.canRetry ? 'Start a new checkout' : 'View order summary'}</Link>}
      <Link href="/" className={secondaryAction}>Continue shopping</Link>
    </div>
  </ResultCard>;
}

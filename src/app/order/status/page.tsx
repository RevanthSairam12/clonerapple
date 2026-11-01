import Link from 'next/link';

import { ReservationCountdown } from '@/components/checkout/ReservationCountdown';
import {
  customerPaymentPhase,
  secondsRemaining,
} from '@/lib/checkout/reservation-rules';
import { getCustomerOrderStatus } from '@/lib/order-status';
import { getUserSession } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ txnid?: string }>;
}

const SAFE_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Order received',
  PENDING: 'Payment pending',
  PAID: 'Payment confirmed',
  ACCEPTED: 'Order accepted',
  PROCESSING: 'Preparing your order',
  ON_THE_WAY: 'On the way',
  DELIVERED: 'Delivered',
  FAILED: 'Payment failed',
  CANCELLED: 'Order cancelled',
  CANCELED: 'Order cancelled',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function statusLabel(value: string): string | null {
  return SAFE_STATUS_LABELS[value.toUpperCase()] ?? null;
}

function deliveryMethod(channel: string, slot: string | null): string {
  if (channel === 'pos') return 'Point of sale';
  return slot ? 'Scheduled delivery' : 'Online delivery';
}

function MessageCard({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f]">
      <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center border border-[#e5e5ea]">
        <h1 className="text-2xl font-semibold mb-2">{title}</h1>
        <p className="text-[#86868b] mb-6">{body}</p>
        {action}
      </div>
    </div>
  );
}

export default async function OrderStatusPage({ searchParams }: Props) {
  const { txnid } = await searchParams;
  if (!txnid) {
    return <MessageCard title="Order status" body="No transaction identifier was provided." action={<Link href="/" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">Return to Store</Link>} />;
  }

  const [session, result] = await Promise.all([
    getUserSession(),
    getCustomerOrderStatus(txnid),
  ]);

  if (!result.ok) {
    return <MessageCard title="Order status unavailable" body={result.reason === 'not-found' ? 'We could not find an order for that reference.' : 'Order status is temporarily unavailable. Please try again later.'} action={<Link href="/" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">Return to Store</Link>} />;
  }

  // Match the success page: account-linked orders require the account that placed them;
  // guest orders remain accessible by their transaction reference.
  if (!session) {
    return <MessageCard title="Sign in to view this order" body="Please sign in before viewing order status." action={<Link href="/auth" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">Sign In</Link>} />;
  }

  if (result.data.userId && session.userId !== result.data.userId) {
    return <MessageCard title="Sign in to view this order" body="Please sign in with the account that placed this order to view its status." action={<Link href="/auth" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">Sign In</Link>} />;
  }

  const delivery = result.data.delivery;
  const trackingUrl = delivery?.trackingUrl;
  const timeline = result.data.history
    .map((entry) => ({ ...entry, label: statusLabel(entry.toStatus) }))
    .filter((entry): entry is typeof entry & { label: string } => Boolean(entry.label));

  const now = new Date();
  const phase = customerPaymentPhase(
    {
      status: result.data.paymentStatus,
      reservationState: result.data.reservationState,
      reservationExpiresAt: result.data.reservationExpiresAt,
      reservationReleasedReason: result.data.reservationReleasedReason,
    },
    now,
  );
  const remainingSeconds = secondsRemaining(result.data.reservationExpiresAt, now);
  const currentLabel = phase === 'processing'
    ? 'Payment being verified'
    : phase === 'expired'
      ? 'Reservation expired'
      : statusLabel(result.data.fulfilmentStatus)
        ?? statusLabel(result.data.paymentStatus)
        ?? 'Order received';

  return (
    <div className="gz-storefront-page min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f]" style={{ fontFamily: 'transducer, sans-serif' }}>
      <div className="max-w-2xl mx-auto bg-white rounded-3xl p-8 sm:p-12 shadow-sm border border-[#e5e5ea]">
        <div className="text-center mb-8">
          <span className="text-xs font-extrabold uppercase tracking-wider text-black bg-[#ffe100] px-3 py-1 rounded-sm">Order status</span>
          <h1 className="text-3xl font-semibold tracking-tight mt-3 mb-2">{currentLabel}</h1>
          <p className="text-sm text-[#86868b]">Reference <span className="font-mono text-[#1d1d1f]">{result.data.txnid}</span></p>
        </div>

        {phase === 'processing' ? (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-8 text-sm leading-relaxed" role="status">
            <p className="font-medium text-amber-900 mb-1">Your payment is being verified.</p>
            <p className="text-amber-900">
              If your bank has debited the amount, please do not pay again while this transaction
              is being checked. We&apos;ll update your order status when confirmation is received.
            </p>
            <Link
              href={`/order/processing?txnid=${encodeURIComponent(result.data.txnid)}`}
              className="inline-block mt-3 text-[#0071e3] font-medium hover:underline"
            >
              Check payment status
            </Link>
          </section>
        ) : null}

        {phase === 'expired' ? (
          <section className="bg-[#fbfbfd] border border-[#e5e5ea] rounded-2xl p-5 mb-8 text-sm" role="status">
            <p className="font-medium mb-1">This reservation has ended.</p>
            <p className="text-[#86868b]">
              The unit was returned to the store because the payment was not confirmed in time.
              The items must be bought again through a new checkout while stock lasts.
            </p>
          </section>
        ) : null}

        {phase === 'failed' ? (
          <section className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-8 text-sm" role="status">
            <p className="font-medium text-red-800 mb-1">The payment did not complete.</p>
            <p className="text-red-800">
              If your bank shows a debit, contact us before paying again. Otherwise start a new
              checkout while stock lasts.
            </p>
          </section>
        ) : null}

        {phase === 'active' && remainingSeconds > 0 ? (
          <section className="bg-[#fbfbfd] border border-[#e5e5ea] rounded-2xl p-5 mb-8">
            <ReservationCountdown seconds={remainingSeconds} />
          </section>
        ) : null}

        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#86868b] mb-4">Status timeline</h2>
          {timeline.length ? (
            <ol className="relative border-l border-[#d2d2d7] ml-2">
              {timeline.map((entry, index) => (
                <li className="ml-6 pb-6 last:pb-0" key={`${entry.createdAt}-${index}`}>
                  <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-[#0071e3] ring-4 ring-white" aria-hidden="true" />
                  <p className="font-medium">{entry.label}</p>
                  <p className="text-xs text-[#86868b] mt-1">{formatDate(entry.createdAt)}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-[#86868b]">Your order has been received. We will show updates here.</p>}
        </section>

        <section className="bg-[#fbfbfd] rounded-2xl p-6 border border-[#e5e5ea] mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#86868b] mb-4">Delivery</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-[#86868b]">Method</dt><dd className="font-medium text-right">{delivery?.method ?? deliveryMethod(result.data.channel, result.data.deliverySlot)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-[#86868b]">Courier</dt><dd className="font-medium text-right">{delivery?.carrier ?? 'To be assigned'}</dd></div>
            {delivery?.trackingNumber ? <div className="flex justify-between gap-4"><dt className="text-[#86868b]">Tracking</dt><dd className="font-mono text-right">{delivery.trackingNumber}</dd></div> : null}
            {trackingUrl ? <div className="pt-2"><a className="text-[#0071e3] font-medium hover:underline" href={trackingUrl} rel="noreferrer" target="_blank">Open courier tracking ↗</a></div> : null}
            {delivery?.scheduledFor ? <div className="flex justify-between gap-4"><dt className="text-[#86868b]">Scheduled</dt><dd className="font-medium text-right">{formatDate(delivery.scheduledFor)}</dd></div> : null}
          </dl>
        </section>

        <div className="flex flex-col sm:flex-row gap-3">
          {phase === 'paid' ? (
            <Link href={`/order/success?txnid=${encodeURIComponent(result.data.txnid)}`} className="flex-1 text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">View order summary</Link>
          ) : phase === 'processing' ? (
            <Link href={`/order/processing?txnid=${encodeURIComponent(result.data.txnid)}`} className="flex-1 text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">Check payment status</Link>
          ) : phase === 'failed' || phase === 'expired' || phase === 'cancelled' ? (
            <Link href="/checkout" className="flex-1 text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">Start a new checkout</Link>
          ) : (
            <Link href={`/order/status?txnid=${encodeURIComponent(result.data.txnid)}`} className="flex-1 text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">Refresh status</Link>
          )}
          <Link href="/" className="flex-1 text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}

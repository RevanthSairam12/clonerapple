import Link from 'next/link';

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
  const currentLabel = statusLabel(result.data.fulfilmentStatus) ?? statusLabel(result.data.paymentStatus) ?? 'Order received';

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f]">
      <div className="max-w-2xl mx-auto bg-white rounded-3xl p-8 sm:p-12 shadow-sm border border-[#e5e5ea]">
        <div className="text-center mb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#0071e3] bg-[#0071e3]/10 px-3 py-1 rounded-full">Order status</span>
          <h1 className="text-3xl font-semibold tracking-tight mt-3 mb-2">{currentLabel}</h1>
          <p className="text-sm text-[#86868b]">Reference <span className="font-mono text-[#1d1d1f]">{result.data.txnid}</span></p>
        </div>

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
          <Link href={`/order/success?txnid=${encodeURIComponent(result.data.txnid)}`} className="flex-1 text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">View order summary</Link>
          <Link href="/" className="flex-1 text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}

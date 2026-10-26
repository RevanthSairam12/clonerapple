import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOrderByTxnid } from '@/lib/payu/orders';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ txnid?: string; error?: string }>;
}

/**
 * Shown only for a definitive failure (or an order that cannot be found). An
 * ambiguous outcome is sent to /order/processing instead, so this page never
 * tells a customer "no charge" while their bank might still be settling one.
 */
export default async function OrderFailedPage({ searchParams }: Props) {
  const { txnid } = await searchParams;
  const order = txnid ? await getOrderByTxnid(txnid) : null;

  if (order?.status === 'PAID') {
    redirect(`/order/success?txnid=${encodeURIComponent(order.txnid)}`);
  }
  if (order?.status === 'PROCESSING') {
    redirect(`/order/processing?txnid=${encodeURIComponent(order.txnid)}`);
  }

  const holdReleased = order?.reservationState === 'RELEASED'
    || order?.reservationState === 'EXPIRED';

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f] flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea] text-center">
        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
          ✕
        </div>

        <span className="text-xs font-semibold uppercase tracking-wider text-red-600 bg-red-50 px-3 py-1 rounded-full">
          Payment unsuccessful
        </span>

        <h1 className="text-2xl font-semibold tracking-tight mt-3 mb-2">Payment could not be completed</h1>

        <p className="text-sm text-[#86868b] mb-4">
          We could not confirm a successful payment for this order, so it will not be dispatched.
          {holdReleased ? ' The unit held for this checkout has been returned to the store.' : ''}
        </p>

        <p className="text-xs text-[#86868b] mb-6">
          If your bank shows a debit for this transaction, contact us before trying again. A new
          checkout is required to buy the item.
        </p>

        {txnid && (
          <div className="bg-[#fbfbfd] rounded-xl p-4 border border-[#e5e5ea] mb-6 text-xs text-left">
            <div className="flex justify-between py-1">
              <span className="text-[#86868b]">Transaction Reference:</span>
              <span className="font-mono font-medium break-all text-right">{txnid}</span>
            </div>
            {order && (
              <div className="flex justify-between py-1">
                <span className="text-[#86868b]">Attempted Amount:</span>
                <span className="font-medium">₹{order.amount.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <Link
            href="/checkout"
            className="block w-full text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition"
          >
            Start a new checkout
          </Link>
          {txnid ? (
            <Link
              href={`/order/status?txnid=${encodeURIComponent(txnid)}`}
              className="block w-full text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition"
            >
              View order status
            </Link>
          ) : (
            <Link
              href="/"
              className="block w-full text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition"
            >
              Return to Store
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

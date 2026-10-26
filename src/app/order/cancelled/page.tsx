import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOrderByTxnid } from '@/lib/payu/orders';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ txnid?: string }>;
}

export default async function OrderCancelledPage({ searchParams }: Props) {
  const { txnid } = await searchParams;
  const order = txnid ? await getOrderByTxnid(txnid) : null;

  if (order?.status === 'PAID') {
    redirect(`/order/success?txnid=${encodeURIComponent(order.txnid)}`);
  }
  if (order?.status === 'PROCESSING') {
    redirect(`/order/processing?txnid=${encodeURIComponent(order.txnid)}`);
  }

  const expired = order?.reservationState === 'EXPIRED';
  const holdReleased = expired
    || order?.reservationState === 'RELEASED';

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f] flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea] text-center">
        <div className="w-16 h-16 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center mx-auto mb-6 text-xl font-bold">
          ↺
        </div>

        <span className="text-xs font-semibold uppercase tracking-wider text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
          {expired ? 'Reservation expired' : 'Transaction cancelled'}
        </span>

        <h1 className="text-2xl font-semibold tracking-tight mt-3 mb-2">
          {expired ? 'Your reservation expired' : 'Checkout was cancelled'}
        </h1>

        <p className="text-sm text-[#86868b] mb-4">
          {expired
            ? 'The checkout did not confirm a payment before its reservation window ended, so the unit was returned to the store. A new checkout is required to buy it.'
            : 'The payment was cancelled before it completed. No order will be dispatched from this checkout.'}
        </p>

        {holdReleased ? (
          <p className="text-xs text-[#86868b] mb-6">
            If your bank shows a debit for this transaction, contact us before paying again.
          </p>
        ) : null}

        {txnid && (
          <div className="bg-[#fbfbfd] rounded-xl p-3 border border-[#e5e5ea] mb-6 text-xs text-left">
            <span className="text-[#86868b]">Reference:</span>{' '}
            <span className="font-mono break-all">{txnid}</span>
          </div>
        )}

        <div className="space-y-3">
          <Link
            href="/checkout"
            className="block w-full text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition"
          >
            Start a new checkout
          </Link>
          <Link
            href="/"
            className="block w-full text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition"
          >
            Return to Homepage
          </Link>
        </div>
      </div>
    </div>
  );
}

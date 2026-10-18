import Link from 'next/link';
import { getOrderByTxnid } from '@/lib/payu/orders';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ txnid?: string; error?: string }>;
}

export default async function OrderFailedPage({ searchParams }: Props) {
  const { txnid } = await searchParams;
  const order = txnid ? await getOrderByTxnid(txnid) : null;

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f] flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea] text-center">
        {/* Failure Icon */}
        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
          ✕
        </div>

        <span className="text-xs font-semibold uppercase tracking-wider text-red-600 bg-red-50 px-3 py-1 rounded-full">
          Payment Unsuccessful
        </span>

        <h1 className="text-2xl font-semibold tracking-tight mt-3 mb-2">Payment Could Not Be Processed</h1>

        <p className="text-sm text-[#86868b] mb-6">
          Your bank or payment provider declined the transaction, or the session expired. No charges were captured.
        </p>

        {txnid && (
          <div className="bg-[#fbfbfd] rounded-xl p-4 border border-[#e5e5ea] mb-6 text-xs text-left">
            <div className="flex justify-between py-1">
              <span className="text-[#86868b]">Transaction Reference:</span>
              <span className="font-mono font-medium">{txnid}</span>
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
            Try Payment Again
          </Link>
          <Link
            href="/"
            className="block w-full text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition"
          >
            Return to Store
          </Link>
        </div>
      </div>
    </div>
  );
}

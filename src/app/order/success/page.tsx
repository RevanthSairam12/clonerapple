import { getOrderByTxnid } from '@/lib/payu/orders';
import { getUserSession } from '@/lib/user-auth';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ txnid?: string }>;
}

export default async function OrderSuccessPage({ searchParams }: Props) {
  const { txnid } = await searchParams;

  if (!txnid) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f]">
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center">
          <h1 className="text-2xl font-semibold mb-2">Order Not Found</h1>
          <p className="text-[#86868b] mb-6">No transaction identifier was provided.</p>
          <Link href="/" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">
            Return to Store
          </Link>
        </div>
      </div>
    );
  }

  // Load order directly from DB (never trust URL parameters alone)
  const order = await getOrderByTxnid(txnid);

  if (!order) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f]">
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center">
          <h1 className="text-2xl font-semibold mb-2">Order Not Found</h1>
          <p className="text-[#86868b] mb-6">We could not find an order matching transaction ID <code className="bg-[#f5f5f7] px-2 py-0.5 rounded">{txnid}</code>.</p>
          <Link href="/" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">
            Return to Store
          </Link>
        </div>
      </div>
    );
  }

  // Enforce Authorization: If order belongs to an authenticated user, only that user can view it
  const session = await getUserSession();
  if (order.userId && (!session || session.userId !== order.userId)) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f]">
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center">
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-lg">!</div>
          <h1 className="text-2xl font-semibold mb-2">Access Denied</h1>
          <p className="text-[#86868b] mb-6">Please log in with the account that placed this order to view its summary.</p>
          <Link href="/auth" className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  // Verify that the order is actually in PAID status in the database
  if (order.status !== 'PAID') {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f]">
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center">
          <h1 className="text-2xl font-semibold mb-2">Payment Verification Required</h1>
          <p className="text-[#86868b] mb-4">
            This order status is currently <span className="font-semibold text-amber-600">{order.status}</span>.
          </p>
          <p className="text-xs text-[#86868b] mb-6">
            If payment was just debited, it will update automatically once verified by PayU.
          </p>
          <Link href={`/order/status?txnid=${encodeURIComponent(order.txnid)}`} className="inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition">
            Check Order Status
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f]">
      <div className="max-w-2xl mx-auto bg-white rounded-3xl p-8 sm:p-12 shadow-sm border border-[#e5e5ea]">
        {/* Success Icon */}
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
          ✓
        </div>

        <div className="text-center mb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
            Payment Confirmed
          </span>
          <h1 className="text-3xl font-semibold tracking-tight mt-3 mb-2">Thank you for your order!</h1>
          <p className="text-sm text-[#86868b]">
            A confirmation receipt has been sent to <span className="text-[#1d1d1f] font-medium">{order.customerEmail}</span>.
          </p>
        </div>

        {/* Order Details Grid */}
        <div className="bg-[#fbfbfd] rounded-2xl p-6 border border-[#e5e5ea] mb-8 space-y-3 text-sm">
          <div className="flex justify-between py-1 border-b border-[#e5e5ea]">
            <span className="text-[#86868b]">Transaction ID</span>
            <span className="font-mono font-medium">{order.txnid}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#e5e5ea]">
            <span className="text-[#86868b]">Order ID</span>
            <span className="font-mono text-xs">{order.id}</span>
          </div>
          {order.payuMihpayid && (
            <div className="flex justify-between py-1 border-b border-[#e5e5ea]">
              <span className="text-[#86868b]">PayU Payment ID</span>
              <span className="font-mono text-xs">{order.payuMihpayid}</span>
            </div>
          )}
          {order.payuMode && (
            <div className="flex justify-between py-1 border-b border-[#e5e5ea]">
              <span className="text-[#86868b]">Payment Mode</span>
              <span className="capitalize">{order.payuMode}</span>
            </div>
          )}
          <div className="flex justify-between py-1">
            <span className="text-[#86868b]">Paid At</span>
            <span>{order.paidAt ? order.paidAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Verified'}</span>
          </div>
        </div>

        {/* Purchased Items */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#86868b] mb-4">Items Purchased</h2>
          <div className="divide-y divide-[#e5e5ea] border-y border-[#e5e5ea]">
            {order.items.map((item, idx) => (
              <div key={idx} className="py-4 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium text-[#1d1d1f]">{item.name}</div>
                  <div className="text-xs text-[#86868b]">Qty: {item.quantity} × ₹{item.unitPrice.toLocaleString('en-IN')}</div>
                </div>
                <div className="font-medium text-[#1d1d1f]">
                  ₹{item.totalPrice.toLocaleString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Total Calculation */}
        <div className="flex justify-between items-baseline pt-2 mb-8">
          <span className="text-base font-semibold">Total Paid</span>
          <span className="text-2xl font-bold tracking-tight text-[#1d1d1f]">
            ₹{order.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/"
            className="flex-1 text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition"
          >
            Continue Shopping
          </Link>
          <Link
            href={`/order/status?txnid=${encodeURIComponent(order.txnid)}`}
            className="flex-1 text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition"
          >
            Track Order
          </Link>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOrderByTxnid } from '@/lib/payu/orders';
import { getUserSession } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ txnid?: string }>;
}

/**
 * The page a customer sees when PayU has not given a reliable outcome yet.
 *
 * It never starts a payment and it never claims success. The only action is a
 * GET refresh that re-reads the order from the database; a verified PAID row
 * redirects to the success page, a definitive failure to the failed page and a
 * released reservation to the cancelled page. The customer is explicitly told
 * not to pay a second time while the bank may already have debited them.
 */
export default async function OrderProcessingPage({ searchParams }: Props) {
  const { txnid } = await searchParams;

  if (!txnid) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f] gz-storefront-page" style={{ fontFamily: 'transducer, sans-serif' }}>
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center border border-[#e5e5ea]">
          <h1 className="text-2xl font-bold tracking-tight mb-2">Payment status</h1>
          <p className="text-[#86868b] mb-6">No transaction identifier was provided.</p>
          <Link href="/" className="inline-block bg-[#ffe100] text-black px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider hover:bg-[#ffea33] transition">
            Return to Store
          </Link>
        </div>
      </div>
    );
  }

  const order = await getOrderByTxnid(txnid);

  if (!order) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f] gz-storefront-page" style={{ fontFamily: 'transducer, sans-serif' }}>
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center border border-[#e5e5ea]">
          <h1 className="text-2xl font-bold tracking-tight mb-2">Payment status</h1>
          <p className="text-[#86868b] mb-6">We could not find an order for that reference.</p>
          <Link href="/" className="inline-block bg-[#ffe100] text-black px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider hover:bg-[#ffea33] transition">
            Return to Store
          </Link>
        </div>
      </div>
    );
  }

  const session = await getUserSession();
  if (order.userId && (!session || session.userId !== order.userId)) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 text-[#1d1d1f] gz-storefront-page" style={{ fontFamily: 'transducer, sans-serif' }}>
        <div className="bg-white max-w-md w-full p-8 rounded-2xl shadow-sm text-center border border-[#e5e5ea]">
          <h1 className="text-2xl font-bold tracking-tight mb-2">Sign in to view this payment</h1>
          <p className="text-[#86868b] mb-6">Please sign in with the account that placed this order.</p>
          <Link href="/auth" className="inline-block bg-[#ffe100] text-black px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider hover:bg-[#ffea33] transition">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (order.status === 'PAID') {
    redirect(`/order/success?txnid=${encodeURIComponent(order.txnid)}`);
  }
  if (order.status === 'FAILED') {
    redirect(`/order/failed?txnid=${encodeURIComponent(order.txnid)}`);
  }
  if (order.status === 'CANCELLED') {
    redirect(`/order/cancelled?txnid=${encodeURIComponent(order.txnid)}`);
  }
  if (order.status === 'CREATED') {
    redirect(`/order/status?txnid=${encodeURIComponent(order.txnid)}`);
  }

  const statusHref = `/order/status?txnid=${encodeURIComponent(order.txnid)}`;

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f] flex items-center justify-center gz-storefront-page" style={{ fontFamily: 'transducer, sans-serif' }}>
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea] text-center">
        <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl" aria-hidden="true">
          ⏳
        </div>

        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
          Payment being verified
        </span>

        <h1 className="text-2xl font-bold tracking-tight mt-3 mb-3">We are checking your payment</h1>

        <p className="text-sm text-[#1d1d1f] leading-relaxed mb-4">
          Your payment is being verified. If your bank has debited the amount, please do not pay
          again while this transaction is being checked. We&apos;ll update your order status when
          confirmation is received.
        </p>

        <div className="bg-[#fbfbfd] rounded-xl p-4 border border-[#e5e5ea] mb-6 text-xs text-left space-y-1.5">
          <div className="flex justify-between gap-3">
            <span className="text-[#86868b]">Reference</span>
            <span className="font-mono font-medium break-all text-right">{order.txnid}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#86868b]">Amount</span>
            <span className="font-medium">₹{order.amount.toFixed(2)}</span>
          </div>
        </div>

        <p className="text-xs text-[#86868b] mb-6">
          This page only checks the status. It never starts another payment.
        </p>

        <div className="space-y-3">
          <Link
            href={`/order/processing?txnid=${encodeURIComponent(order.txnid)}`}
            className="block w-full text-center bg-[#ffe100] text-black py-3.5 rounded-full text-xs font-bold uppercase tracking-wider hover:bg-[#ffea33] transition"
          >
            Check status again
          </Link>
          <Link
            href={statusHref}
            className="block w-full text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8ed] transition"
          >
            View order details
          </Link>
        </div>
      </div>
    </div>
  );
}

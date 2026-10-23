import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountFrame } from '@/components/account/AccountFrame';
import { PrintButton } from '@/components/account/PrintButton';
import { requireAccountPageSession } from '@/lib/account/auth';
import { RECEIPT_TRADE_NAME } from '@/lib/account/config';
import { getCustomerOrderDetail } from '@/lib/account/orders';

export const dynamic = 'force-dynamic';

export default async function AccountReceiptPage({ params }: { params: Promise<{ txnid: string }> }) {
  const { txnid } = await params;
  const session = await requireAccountPageSession(`/account/orders/${encodeURIComponent(txnid)}/receipt`);
  const order = await getCustomerOrderDetail(session.userId, txnid);
  if (!order) notFound();
  return <AccountFrame session={session} active="/account/orders"><div className="mx-auto max-w-3xl"><div className="mb-4 flex justify-between gap-3 print:hidden"><Link href={`/account/orders/${encodeURIComponent(order.txnid)}`} className="text-sm font-semibold text-[#0071e3]">← Back to order</Link><PrintButton /></div><article className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm sm:p-10"><div className="flex flex-col justify-between gap-5 border-b border-[#e5e5ea] pb-6 sm:flex-row"><div><p className="text-sm text-[#6e6e73]">{RECEIPT_TRADE_NAME}</p><h1 className="mt-1 text-3xl font-semibold">Receipt / Bill of Supply</h1><p className="mt-2 text-sm text-[#6e6e73]">Order {order.txnid}</p></div><div className="text-sm sm:text-right"><p>{order.createdAt.toLocaleDateString('en-IN')}</p><p className="mt-1 font-semibold">{order.paymentStatus}</p></div></div><div className="mt-8 divide-y divide-[#e5e5ea]">{order.items.map((item) => <div key={item.id} className="flex justify-between gap-4 py-3 text-sm"><span>{item.name} × {item.quantity}</span><span className="font-semibold">₹{item.totalPrice.toLocaleString('en-IN')}</span></div>)}</div><div className="mt-5 flex justify-between border-t border-[#e5e5ea] pt-5 text-lg font-semibold"><span>Total</span><span>₹{order.amount.toLocaleString('en-IN')}</span></div><p className="mt-8 text-sm text-[#6e6e73]">This receipt is provided for your records. Gadzio is not GST-registered and this is not a tax invoice. Need help? <Link href="/support" className="font-semibold text-[#0071e3] print:hidden">Contact support</Link></p></article></div></AccountFrame>;
}

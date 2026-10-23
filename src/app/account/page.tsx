import Link from 'next/link';
import { AccountFrame } from '@/components/account/AccountFrame';
import { requireAccountPageSession } from '@/lib/account/auth';
import { getLatestCustomerOrder } from '@/lib/account/orders';
import { maskAccountEmail } from '@/lib/account/rules';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await requireAccountPageSession('/account');
  const latest = await getLatestCustomerOrder(session.userId);
  return <AccountFrame session={session} active="/account"><div className="grid gap-5 md:grid-cols-2"><section className="rounded-3xl bg-[#1d1d1f] p-6 text-white shadow-sm md:col-span-2"><p className="text-sm text-white/60">Your account</p><h2 className="mt-2 text-2xl font-semibold">{session.firstName} {session.lastName}</h2><p className="mt-2 text-sm text-white/70">{maskAccountEmail(session.email)}</p></section><section className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Quick links</h2><div className="mt-4 grid gap-2"><Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed]" href="/account/orders">View orders</Link><Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed]" href="/account/addresses">Manage addresses</Link><Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed]" href="/shop/iphone/accessories/cases-protection">Continue shopping</Link></div></section><section className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Latest order</h2>{latest ? <div className="mt-4"><p className="font-mono text-sm">{latest.txnid}</p><p className="mt-2 text-sm text-[#6e6e73]">{latest.status.replaceAll('_', ' ')} · {latest.itemCount} item{latest.itemCount === 1 ? '' : 's'}</p><p className="mt-1 text-sm font-semibold">₹{latest.amount.toLocaleString('en-IN')}</p><Link href={`/account/orders/${encodeURIComponent(latest.txnid)}`} className="mt-4 inline-block text-sm font-semibold text-[#0071e3]">View order →</Link></div> : <p className="mt-4 text-sm text-[#6e6e73]">No orders yet. <Link href="/shop/iphone/accessories/cases-protection" className="text-[#0071e3]">Visit the shop.</Link></p>}</section></div></AccountFrame>;
}

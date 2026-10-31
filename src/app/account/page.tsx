import Link from 'next/link';
import { AccountFrame } from '@/components/account/AccountFrame';
import { BuyAgainRow } from '@/components/account/BuyAgainRow';
import { LiveOrderPoller } from '@/components/account/LiveOrderPoller';
import { OrderStatusChip } from '@/components/account/OrderStatusChip';
import { requireAccountPageSession } from '@/lib/account/auth';
import { getLatestCustomerOrder, listBuyAgainProducts } from '@/lib/account/orders';
import { isInFlightAccountOrderStatus, liveSignature } from '@/lib/account/order-live';
import { maskAccountEmail } from '@/lib/account/rules';
import { readSaleState } from '@/lib/storefront/sale-state';

export const dynamic = 'force-dynamic';

const SHOP_HREF = '/shop/iphone/accessories/cases-protection';

export default async function AccountPage() {
  const session = await requireAccountPageSession('/account');
  const [latest, buyAgain] = await Promise.all([
    getLatestCustomerOrder(session.userId),
    listBuyAgainProducts(session.userId),
  ]);
  // Buy again prices and stock come from the same resolver as the storefront.
  const sale = await readSaleState();
  const latestInFlight = latest ? isInFlightAccountOrderStatus(latest.status) : false;

  return (
    <AccountFrame session={session} active="/account">
      <div className="space-y-5">
        <section className="rounded-3xl bg-[#1d1d1f] p-6 text-white shadow-sm">
          <p className="text-sm text-white/60">Your account</p>
          <h2 className="mt-2 text-2xl font-semibold">{session.firstName} {session.lastName}</h2>
          <p className="mt-2 text-sm text-white/70">{maskAccountEmail(session.email)}</p>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">Latest order</h2>
              <Link href="/account/orders" className="text-sm font-semibold text-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
                All orders
              </Link>
            </div>
            {latest ? (
              <div className="mt-4">
                {latestInFlight && (
                  <LiveOrderPoller txnid={latest.txnid} initialStatus={latest.status} />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm">{latest.txnid}</p>
                  <OrderStatusChip status={latest.status} />
                </div>
                <p className="mt-2 text-sm text-[#6e6e73]">
                  {latest.itemCount} item{latest.itemCount === 1 ? '' : 's'} · placed {latest.createdAt.toLocaleDateString('en-IN')}
                </p>
                <p className="mt-1 text-sm font-semibold">₹{latest.amount.toLocaleString('en-IN')}</p>
                <Link
                  href={`/account/orders/${encodeURIComponent(latest.txnid)}`}
                  className="mt-4 inline-block text-sm font-semibold text-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                >
                  View order →
                </Link>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-[#6e6e73]">You have no orders yet.</p>
                <Link href={SHOP_HREF} className="mt-4 inline-flex rounded-full bg-[#0071e3] px-5 py-2.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
                  Start shopping
                </Link>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Quick links</h2>
            <div className="mt-4 grid gap-2">
              <Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed] focus:outline-none focus:ring-2 focus:ring-[#0071e3]" href="/account/orders">View orders</Link>
              <Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed] focus:outline-none focus:ring-2 focus:ring-[#0071e3]" href="/account/addresses">Manage addresses</Link>
              <Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed] focus:outline-none focus:ring-2 focus:ring-[#0071e3]" href="/account/profile">Profile and security</Link>
              <Link className="rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm font-semibold hover:bg-[#e8e8ed] focus:outline-none focus:ring-2 focus:ring-[#0071e3]" href={SHOP_HREF}>Continue shopping</Link>
            </div>
          </section>
        </div>

        <BuyAgainRow items={buyAgain} saleLive={sale.live} />
      </div>
    </AccountFrame>
  );
}
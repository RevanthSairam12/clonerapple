import Link from 'next/link';
import { AccountFrame } from '@/components/account/AccountFrame';
import { OrderStatusChip, PaymentAndOrderStatusChips } from '@/components/account/OrderStatusChip';
import { requireAccountPageSession } from '@/lib/account/auth';
import { listCustomerOrders } from '@/lib/account/orders';

export const dynamic = 'force-dynamic';

const filters: Array<[string, string]> = [
  ['ALL', 'All'],
  ['PENDING', 'Pending'],
  ['PROCESSING', 'Processing'],
  ['ON_THE_WAY', 'On the way'],
  ['DELIVERED', 'Delivered'],
  ['CANCELED', 'Canceled'],
  ['PAYMENT_FAILED', 'Payment failed'],
];

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const session = await requireAccountPageSession('/account/orders');
  const params = await searchParams;
  const status = filters.some(([value]) => value === params.status) ? params.status! : 'ALL';
  const result = await listCustomerOrders(session.userId, {
    status,
    search: params.q || '',
    page: Number(params.page || 1),
  });
  const query = (next: Record<string, string>) =>
    `/account/orders?${new URLSearchParams({
      status,
      q: params.q || '',
      page: String(result.page),
      ...next,
    }).toString()}`;

  return (
    <AccountFrame session={session} active="/account/orders">
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold">Orders</h2>
            <p className="mt-1 text-sm text-[#6e6e73]">Your newest orders appear first.</p>
          </div>
          <form className="flex gap-2" role="search">
            <label htmlFor="order-search" className="sr-only">
              Search by order ID
            </label>
            <input
              id="order-search"
              name="q"
              defaultValue={params.q || ''}
              placeholder="Search order ID"
              className="min-w-0 rounded-full border border-[#d2d2d7] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
            />
            <input type="hidden" name="status" value={status} />
            <button className="rounded-full bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white">
              Search
            </button>
          </form>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filter orders">
          {filters.map(([value, label]) => (
            <Link
              key={value}
              href={query({ status: value, page: '1' })}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                status === value
                  ? 'bg-[#1d1d1f] text-white'
                  : 'bg-white text-[#6e6e73] ring-1 ring-[#e5e5ea] hover:text-[#1d1d1f]'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {result.orders.length === 0 ? (
          <div className="rounded-3xl border border-[#e5e5ea] bg-white p-10 text-center">
            <h3 className="text-xl font-semibold">No orders found</h3>
            <p className="mt-2 text-sm text-[#6e6e73]">Try another filter or explore the shop.</p>
            <Link
              href="/shop/iphone/accessories/cases-protection"
              className="mt-5 inline-flex rounded-full bg-[#ffe100] px-5 py-3 text-sm font-bold text-black hover:bg-[#ffea33]"
            >
              Shop Gadzio
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {result.orders.map((order) => (
              <Link
                key={order.txnid}
                href={`/account/orders/${encodeURIComponent(order.txnid)}`}
                className="block rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-black/30 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-black"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-semibold">{order.txnid}</span>
                      <OrderStatusChip status={order.status} />
                      <PaymentAndOrderStatusChips
                        paymentStatus={order.paymentStatus}
                        orderProgress={order.fulfilmentStatus}
                        refundCount={order.refundCount}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[#6e6e73]">
                      {order.createdAt.toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-lg font-semibold">₹{order.amount.toLocaleString('en-IN')}</p>
                    <p className="text-xs font-semibold text-[#1d1d1f]">View details →</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {result.totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <Link
              href={query({ page: String(Math.max(1, result.page - 1)) })}
              className={`rounded-full border border-[#d2d2d7] bg-white px-4 py-2 font-medium ${
                result.page <= 1 ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              Previous
            </Link>
            <span className="text-[#6e6e73]">
              Page {result.page} of {result.totalPages}
            </span>
            <Link
              href={query({ page: String(Math.min(result.totalPages, result.page + 1)) })}
              className={`rounded-full border border-[#d2d2d7] bg-white px-4 py-2 font-medium ${
                result.page >= result.totalPages ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              Next
            </Link>
          </div>
        )}
      </div>
    </AccountFrame>
  );
}

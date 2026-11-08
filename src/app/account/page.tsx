import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountFrame } from '@/components/account/AccountFrame';
import { BuyAgainRow } from '@/components/account/BuyAgainRow';
import { LiveOrderPoller } from '@/components/account/LiveOrderPoller';
import { OrderStatusChip } from '@/components/account/OrderStatusChip';
import { ProductRecommendationRow } from '@/components/account/ProductRecommendationRow';
import { requireAccountPageSession } from '@/lib/account/auth';
import { getAccountDashboardSummary } from '@/lib/account/dashboard-summary';
import { getDashboardRecommendations } from '@/lib/account/browsing-history';
import { listBuyAgainProducts } from '@/lib/account/orders';
import { isInFlightAccountOrderStatus } from '@/lib/account/order-live';
import { readSaleState } from '@/lib/storefront/sale-state';

export const dynamic = 'force-dynamic';

const SHOP_HREF = '/shop/iphone/accessories/cases-protection';

export default async function AccountPage() {
  const session = await requireAccountPageSession('/account');

  const [summary, buyAgain, recommendations, sale] = await Promise.all([
    getAccountDashboardSummary(session.userId),
    listBuyAgainProducts(session.userId),
    getDashboardRecommendations(session.userId),
    readSaleState(),
  ]);

  if (!summary) notFound();

  const latest = summary.orders.latestOrder;
  const latestInFlight = latest ? isInFlightAccountOrderStatus(latest.status) : false;

  return (
    <AccountFrame session={session} active="/account">
      <div className="space-y-8">
        {/* Poller for live in-flight order status */}
        {latest && (
          latestInFlight && (
            <LiveOrderPoller txnid={latest.txnid} initialStatus={latest.status} />
          )
        )}

        {/* Greeting Banner */}
        <section className="rounded-3xl bg-[#1d1d1f] p-6 text-white shadow-sm sm:p-8">
          <p className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-white/60">
            Account Overview
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">
            Hello, {summary.user.firstName || session.firstName || 'there'}
          </h1>
          <p className="mt-2 text-sm text-white/70">
            {summary.user.emailMasked}
            {summary.user.phoneMasked && ` · ${summary.user.phoneMasked}`}
          </p>
        </section>

        {/* Grid of 8 Live Dashboard Cards (3 cols desktop, 2 tablet, 1 mobile) */}
        <section aria-label="Account Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* 1. Your Orders */}
          <Link
            href="/account/orders"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">📦</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  View all →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Your Orders</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {summary.orders.totalCount === 0
                  ? 'No orders placed yet'
                  : `${summary.orders.totalCount} order${summary.orders.totalCount === 1 ? '' : 's'}`}
                {summary.orders.inTransitCount > 0 && ` · ${summary.orders.inTransitCount} in transit`}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3">
              {latest ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-[#6e6e73]">{latest.txnid}</span>
                  <OrderStatusChip status={latest.status} />
                </div>
              ) : (
                <span className="text-xs font-semibold text-[#1d1d1f]">Start shopping</span>
              )}
            </div>
          </Link>

          {/* 2. Returns and Requests */}
          <Link
            href="/account/orders"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🔄</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  Manage →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Returns and requests</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {summary.requests.openCount === 0
                  ? 'No open returns or requests'
                  : `${summary.requests.openCount} open request${summary.requests.openCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
              {summary.requests.latestRequest ? (
                <span>
                  Latest: {summary.requests.latestRequest.type} ({summary.requests.latestRequest.status.toLowerCase()})
                </span>
              ) : (
                <span>Eligible items can be returned within 7 days</span>
              )}
            </div>
          </Link>

          {/* 3. Your Addresses */}
          <Link
            href="/account/addresses"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">📍</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  Edit →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Your Addresses</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {summary.addresses.totalCount === 0
                  ? 'No addresses saved'
                  : `${summary.addresses.totalCount} saved address${summary.addresses.totalCount === 1 ? '' : 'es'}`}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73] truncate">
              {summary.addresses.defaultAddressMasked ? (
                <span>Default: {summary.addresses.defaultAddressMasked}</span>
              ) : (
                <span>Add delivery address for faster checkout</span>
              )}
            </div>
          </Link>

          {/* 4. Login and Security */}
          <Link
            href="/account/profile"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🔒</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  Security →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Login and security</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {summary.security.activeSessionsCount} active session{summary.security.activeSessionsCount === 1 ? '' : 's'} · Last sign-in: {summary.security.lastLoginDisplay}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs">
              {summary.security.passwordChangePrompt ? (
                <span className="text-amber-700 font-medium">
                  Consider updating your password
                </span>
              ) : (
                <span className="text-[#6e6e73]">Password up to date</span>
              )}
            </div>
          </Link>

          {/* 5. Your Coupons */}
          <Link
            href="/account/coupons"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🏷️</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  View coupons →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Your Coupons</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {summary.coupons.availableCount === 0
                  ? 'No private coupons available'
                  : `${summary.coupons.availableCount} available coupon${summary.coupons.availableCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
              <span>Private offers assigned to your account</span>
            </div>
          </Link>

          {/* 6. Message Centre */}
          <Link
            href="/account/messages"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">💬</span>
                {summary.messages.unreadCount > 0 ? (
                  <span className="rounded-full bg-[#ffe100] px-2 py-0.5 text-xs font-bold text-[#1d1d1f]">
                    {summary.messages.unreadCount} new
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                    Inbox →
                  </span>
                )}
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Message centre</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {summary.messages.unreadCount === 0
                  ? 'All caught up'
                  : `${summary.messages.unreadCount} unread message${summary.messages.unreadCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
              <span>Order notifications and status alerts</span>
            </div>
          </Link>

          {/* 7. Profile */}
          <Link
            href="/account/profile"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">👤</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  Edit profile →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Profile</h2>
              <p className="mt-1 text-sm text-[#6e6e73] truncate">
                {summary.user.firstName} {summary.user.lastName}
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
              {!summary.user.hasPhone ? (
                <span className="text-amber-700 font-medium">Add phone number for SMS delivery alerts</span>
              ) : (
                <span>Contact details verified</span>
              )}
            </div>
          </Link>

          {/* 8. Contact and Support */}
          <Link
            href="/support"
            className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">📞</span>
                <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
                  Support →
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">Contact and support</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                Need help with an order? We&apos;re here for you.
              </p>
            </div>
            <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73] truncate">
              <span>{summary.support.phone} · {summary.support.email}</span>
            </div>
          </Link>
        </section>

        {/* Grouped Links Below Grid */}
        <section aria-label="Account Navigation" className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-[#1d1d1f]">Quick navigation</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Group 1: Orders and Shopping */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                Orders &amp; Shopping
              </h3>
              <ul className="space-y-2 text-sm font-semibold">
                <li>
                  <Link href="/account/orders" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Your Orders
                  </Link>
                </li>
                <li>
                  <Link href="/account/orders" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Returns &amp; refunds
                  </Link>
                </li>
                <li>
                  <Link href="/account/addresses" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Delivery addresses
                  </Link>
                </li>
                <li>
                  <Link href="/account/history" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Browsing history
                  </Link>
                </li>
              </ul>
            </div>

            {/* Group 2: Messages & Preferences */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                Messages &amp; Offers
              </h3>
              <ul className="space-y-2 text-sm font-semibold">
                <li>
                  <Link href="/account/messages" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Message centre
                  </Link>
                </li>
                <li>
                  <Link href="/account/coupons" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Your coupons
                  </Link>
                </li>
                <li>
                  <Link href="/account/preferences" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Communication preferences
                  </Link>
                </li>
              </ul>
            </div>

            {/* Group 3: Login and Security */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                Login &amp; Security
              </h3>
              <ul className="space-y-2 text-sm font-semibold">
                <li>
                  <Link href="/account/profile" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Name and phone
                  </Link>
                </li>
                <li>
                  <Link href="/account/profile" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Change password
                  </Link>
                </li>
                <li>
                  <Link href="/account/profile" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Active sessions
                  </Link>
                </li>
              </ul>
            </div>

            {/* Group 4: Manage Your Data */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                Manage Your Data
              </h3>
              <ul className="space-y-2 text-sm font-semibold">
                <li>
                  <Link href="/account/data" className="text-[#1d1d1f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">
                    Download personal data
                  </Link>
                </li>
                <li>
                  <Link href="/account/data" className="text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-600">
                    Close account
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Personalized Rows at Bottom */}
        {/* Buy again row */}
        <BuyAgainRow items={buyAgain} saleLive={sale.live} />

        {/* Recently viewed row */}
        {recommendations.recentlyViewed.length > 0 && (
          <ProductRecommendationRow
            title="Recently viewed"
            subtitle="Products you browsed during your recent visits."
            items={recommendations.recentlyViewed}
            viewAllHref="/account/history"
          />
        )}

        {/* Inspired by your browsing history row */}
        {recommendations.inspiredByHistory.length > 0 && (
          <ProductRecommendationRow
            title="Inspired by your browsing history"
            subtitle="Recommended products matching the brands and categories you like."
            items={recommendations.inspiredByHistory}
          />
        )}
      </div>
    </AccountFrame>
  );
}

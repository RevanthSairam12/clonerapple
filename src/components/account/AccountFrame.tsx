import Link from 'next/link';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { getUnreadMessageCount } from '@/lib/account/messages';
import type { UserSession } from '@/lib/user-auth';

const links = [
  ['/account', 'Overview'],
  ['/account/orders', 'Orders'],
  ['/account/addresses', 'Addresses'],
  ['/account/coupons', 'Coupons'],
  ['/account/messages', 'Messages'],
  ['/account/history', 'History'],
  ['/account/preferences', 'Preferences'],
  ['/account/profile', 'Profile'],
  ['/account/data', 'Data & Privacy'],
] as const;

export async function AccountFrame({
  session,
  active,
  children,
}: {
  session: UserSession;
  active: string;
  children: React.ReactNode;
}) {
  const unreadMessagesCount = await getUnreadMessageCount(session.userId);

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <GadzioHeader
        accountHref="/account"
        bannerVisible={false}
        unreadMessagesCount={unreadMessagesCount}
        customerFirstName={session.firstName}
      />
      <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#6e6e73]">Gadzio account</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Welcome, {session.firstName}
            </h1>
          </div>
          {active !== '/account' && (
            <Link
              href="/account"
              className="text-sm font-semibold text-[#0071e3] hover:underline"
            >
              ← Back to account overview
            </Link>
          )}
        </div>
        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
          <nav aria-label="Account" className="rounded-3xl border border-[#e5e5ea] bg-white p-2 shadow-sm">
            <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">
              {links.map(([href, label]) => {
                const isSelected = active === href || (href !== '/account' && active.startsWith(href));
                const isMessages = href === '/account/messages';
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`flex items-center justify-between shrink-0 rounded-2xl px-4 py-3 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${
                      isSelected
                        ? 'bg-[#1d1d1f] text-white'
                        : 'text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                    }`}
                  >
                    <span>{label}</span>
                    {isMessages && unreadMessagesCount > 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          isSelected ? 'bg-white text-black' : 'bg-[#0071e3] text-white'
                        }`}
                      >
                        {unreadMessagesCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>
          <section className="min-w-0">{children}</section>
        </div>
      </main>
      <GlobalFooter />
    </div>
  );
}

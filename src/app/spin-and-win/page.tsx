import type { Metadata } from 'next';

import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { CustomerSpinWheelClient } from '@/components/spin-wheel/CustomerSpinWheelClient';
import { getUnreadMessageCount } from '@/lib/account/messages';
import { getCustomerSpinState } from '@/lib/spin-wheel/store';
import { getUserSession } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Spin and Win — Gadzio',
  description: 'Spin the Gadzio daily prize wheel once a day for a chance to win an instant personal coupon.',
};

export default async function SpinAndWinPage() {
  const session = await getUserSession();
  const [spinState, unreadMessagesCount] = await Promise.all([
    getCustomerSpinState(session?.userId ?? null),
    session ? getUnreadMessageCount(session.userId) : Promise.resolve(0),
  ]);

  return (
    <div
      className="gz-storefront-page min-h-screen bg-[#fbf8ef] text-[#111111] selection:bg-[#e8c6ff] selection:text-[#111111]"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <GadzioHeader
        accountHref={session ? '/account' : '/auth?redirect=/spin-and-win'}
        bannerVisible={false}
        unreadMessagesCount={unreadMessagesCount}
        customerFirstName={session?.firstName}
      />
      <main>
        <CustomerSpinWheelClient initialState={spinState} />
      </main>
      <GlobalFooter />
    </div>
  );
}


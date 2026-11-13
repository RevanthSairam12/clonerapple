import { AccountFrame } from '@/components/account/AccountFrame';
import { CouponsList } from '@/components/account/CouponsList';
import { requireAccountPageSession } from '@/lib/account/auth';
import { listCustomerCoupons } from '@/lib/account/coupons';
import { getCustomerSpinState } from '@/lib/spin-wheel/store';

export const dynamic = 'force-dynamic';

export default async function AccountCouponsPage() {
  const session = await requireAccountPageSession('/account/coupons');
  const [coupons, spinState] = await Promise.all([
    listCustomerCoupons(session.userId),
    getCustomerSpinState(session.userId),
  ]);
  const spinAvailable = spinState.available && spinState.isOpen && spinState.segments.length >= 2;

  return (
    <AccountFrame session={session} active="/account/coupons">
      <CouponsList coupons={coupons} spinAvailable={spinAvailable} />
    </AccountFrame>
  );
}

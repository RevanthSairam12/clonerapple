import { AccountFrame } from '@/components/account/AccountFrame';
import { CouponsList } from '@/components/account/CouponsList';
import { requireAccountPageSession } from '@/lib/account/auth';
import { listCustomerCoupons } from '@/lib/account/coupons';

export const dynamic = 'force-dynamic';

export default async function AccountCouponsPage() {
  const session = await requireAccountPageSession('/account/coupons');
  const coupons = await listCustomerCoupons(session.userId);

  return (
    <AccountFrame session={session} active="/account/coupons">
      <CouponsList coupons={coupons} />
    </AccountFrame>
  );
}

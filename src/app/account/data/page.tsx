import { AccountFrame } from '@/components/account/AccountFrame';
import { ManageDataManager } from '@/components/account/ManageDataManager';
import { requireAccountPageSession } from '@/lib/account/auth';

export const dynamic = 'force-dynamic';

export default async function AccountDataPage() {
  const session = await requireAccountPageSession('/account/data');

  return (
    <AccountFrame session={session} active="/account/data">
      <ManageDataManager email={session.email} />
    </AccountFrame>
  );
}

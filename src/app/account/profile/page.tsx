import { AccountFrame } from '@/components/account/AccountFrame';
import { ProfileManager } from '@/components/account/ProfileManager';
import { requireAccountPageSession } from '@/lib/account/auth';

export const dynamic = 'force-dynamic';

export default async function AccountProfilePage() {
  const session = await requireAccountPageSession('/account/profile');
  return <AccountFrame session={session} active="/account/profile"><ProfileManager firstName={session.firstName} lastName={session.lastName} phone={session.phone} /></AccountFrame>;
}

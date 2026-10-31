import { AccountFrame } from '@/components/account/AccountFrame';
import { CommunicationPreferencesManager } from '@/components/account/CommunicationPreferencesManager';
import { requireAccountPageSession } from '@/lib/account/auth';
import { getCommunicationPreferences } from '@/lib/account/preferences';

export const dynamic = 'force-dynamic';

export default async function AccountPreferencesPage() {
  const session = await requireAccountPageSession('/account/preferences');
  const preferences = await getCommunicationPreferences(session.userId);

  return (
    <AccountFrame session={session} active="/account/preferences">
      <CommunicationPreferencesManager
        initialMarketingOptIn={preferences.marketingOptIn}
      />
    </AccountFrame>
  );
}

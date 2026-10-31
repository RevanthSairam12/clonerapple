import { AccountFrame } from '@/components/account/AccountFrame';
import { BrowsingHistoryManager } from '@/components/account/BrowsingHistoryManager';
import { requireAccountPageSession } from '@/lib/account/auth';
import {
  getBrowsingHistorySettings,
  listBrowsingHistory,
} from '@/lib/account/browsing-history';

export const dynamic = 'force-dynamic';

export default async function AccountBrowsingHistoryPage() {
  const session = await requireAccountPageSession('/account/history');
  const [items, saveBrowsingHistory] = await Promise.all([
    listBrowsingHistory(session.userId),
    getBrowsingHistorySettings(session.userId),
  ]);

  return (
    <AccountFrame session={session} active="/account/history">
      <BrowsingHistoryManager
        initialItems={items}
        initialSaveHistory={saveBrowsingHistory}
      />
    </AccountFrame>
  );
}

import { AccountFrame } from '@/components/account/AccountFrame';
import { MessagesManager } from '@/components/account/MessagesManager';
import { requireAccountPageSession } from '@/lib/account/auth';
import { listCustomerMessages } from '@/lib/account/messages';

export const dynamic = 'force-dynamic';

export default async function AccountMessagesPage() {
  const session = await requireAccountPageSession('/account/messages');
  const messages = await listCustomerMessages(session.userId);

  return (
    <AccountFrame session={session} active="/account/messages">
      <MessagesManager initialMessages={messages} />
    </AccountFrame>
  );
}

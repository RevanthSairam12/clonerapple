import { NextResponse } from 'next/server';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { getUnreadMessageCount, listCustomerMessages } from '@/lib/account/messages';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const [messages, unreadCount] = await Promise.all([
    listCustomerMessages(auth.session.userId),
    getUnreadMessageCount(auth.session.userId),
  ]);

  return NextResponse.json(
    { messages, unreadCount },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

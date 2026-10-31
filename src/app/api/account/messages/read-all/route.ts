import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { markAllMessagesRead } from '@/lib/account/messages';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const markedCount = await markAllMessagesRead(auth.session.userId);
  return NextResponse.json({ success: true, markedCount });
}

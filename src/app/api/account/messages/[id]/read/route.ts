import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { markMessageRead } from '@/lib/account/messages';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const success = await markMessageRead(auth.session.userId, id);
  return NextResponse.json({ success });
}

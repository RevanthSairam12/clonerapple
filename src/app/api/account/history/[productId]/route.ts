import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { removeBrowsingHistoryItem } from '@/lib/account/browsing-history';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const { productId } = await params;
  const success = await removeBrowsingHistoryItem(auth.session.userId, productId);
  return NextResponse.json({ success });
}

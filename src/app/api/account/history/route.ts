import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import {
  clearBrowsingHistory,
  getBrowsingHistorySettings,
  listBrowsingHistory,
} from '@/lib/account/browsing-history';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const [items, saveBrowsingHistory] = await Promise.all([
    listBrowsingHistory(auth.session.userId),
    getBrowsingHistorySettings(auth.session.userId),
  ]);

  return NextResponse.json(
    { items, saveBrowsingHistory },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

export async function DELETE(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const count = await clearBrowsingHistory(auth.session.userId);
  return NextResponse.json({ success: true, count });
}

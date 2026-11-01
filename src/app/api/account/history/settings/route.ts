import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { setBrowsingHistorySettings } from '@/lib/account/browsing-history';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const saveBrowsingHistory = Boolean(body?.saveBrowsingHistory);
  const clearExisting = Boolean(body?.clearExisting);

  await setBrowsingHistorySettings(auth.session.userId, saveBrowsingHistory, clearExisting);

  return NextResponse.json({
    success: true,
    saveBrowsingHistory,
  });
}

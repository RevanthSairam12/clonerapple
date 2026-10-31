import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import {
  getCommunicationPreferences,
  updateCommunicationPreferences,
} from '@/lib/account/preferences';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const preferences = await getCommunicationPreferences(auth.session.userId);
  return NextResponse.json(
    { preferences },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const marketingOptIn = Boolean(body?.marketingOptIn);

  const success = await updateCommunicationPreferences(auth.session.userId, marketingOptIn);
  return NextResponse.json({ success, marketingOptIn });
}

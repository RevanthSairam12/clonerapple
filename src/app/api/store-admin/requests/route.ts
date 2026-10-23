import { NextResponse } from 'next/server';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { listOrderRequests, REQUESTS_UNAVAILABLE_MESSAGE } from '@/lib/store-admin/order-requests';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;
  const status = new URL(request.url).searchParams.get('status') || undefined;
  const result = await listOrderRequests(status);
  if (!result.ok) {
    return NextResponse.json({ error: REQUESTS_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  return NextResponse.json(result.data);
}

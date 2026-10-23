import { NextRequest, NextResponse } from 'next/server';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { listCustomerOrders } from '@/lib/account/orders';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  return NextResponse.json({
    ...(await listCustomerOrders(auth.session.userId, {
      page: Number(url.searchParams.get('page') || 1),
      status: url.searchParams.get('status') || 'ALL',
      search: url.searchParams.get('q') || '',
    })),
  });
}

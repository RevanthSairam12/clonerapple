import { NextRequest, NextResponse } from 'next/server';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { getCustomerOrderLiveStatus } from '@/lib/account/orders';

export const dynamic = 'force-dynamic';

/**
 * The lightweight no-store read the in-flight order poller uses. Owner-scoped
 * like every account route (see check-account-routes.mjs), and never cached:
 * the whole point is the value as of this request.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ txnid: string }> }) {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const { txnid } = await context.params;
  const live = await getCustomerOrderLiveStatus(auth.session.userId, txnid);
  return live
    ? NextResponse.json({ order: live }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
}
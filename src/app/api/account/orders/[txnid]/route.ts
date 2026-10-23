import { NextRequest, NextResponse } from 'next/server';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { getCustomerOrderDetail } from '@/lib/account/orders';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ txnid: string }> }) {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const { txnid } = await context.params;
  const order = await getCustomerOrderDetail(auth.session.userId, txnid);
  return order ? NextResponse.json({ order }) : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
}

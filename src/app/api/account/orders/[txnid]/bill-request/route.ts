import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { BillRequestError, requestBill } from '@/lib/account/bill-requests';

export async function POST(request: NextRequest, context: { params: Promise<{ txnid: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const { txnid } = await context.params;
  try {
    // Do not parse obsolete reasons or return an old request as a successful action.
    await requestBill(auth.session.userId, txnid);
  } catch (error) {
    if (error instanceof BillRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.warn('[account/bill-request] request unavailable');
    return NextResponse.json({ error: 'Bill requests are unavailable. Please try again.' }, { status: 503 });
  }
}

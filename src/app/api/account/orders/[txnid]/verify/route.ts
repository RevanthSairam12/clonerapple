import { NextResponse } from 'next/server';

import { requireAccountSessionApi } from '@/lib/account/auth';
import { checkCustomerPayment } from '@/lib/account/payment-verification';
import { assertSameOrigin } from '@/lib/platform/api-guard';

export const dynamic = 'force-dynamic';

/** An explicit owner action; never a new charge or a browser status claim. */
export async function POST(request: Request, context: { params: Promise<{ txnid: string }> }) {
  const violation = assertSameOrigin(request);
  if (violation) return violation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const { txnid } = await context.params;
  try {
    const result = await checkCustomerPayment(auth.session.userId, txnid, request);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: {
        'Cache-Control': 'no-store',
        ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
      },
    });
  } catch {
    // Do not expose database, configuration, or upstream response details.
    return NextResponse.json(
      { error: 'Payment status is temporarily unavailable. Please try again shortly. Do not pay again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

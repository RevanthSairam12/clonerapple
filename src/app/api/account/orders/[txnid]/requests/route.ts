import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { validateRequestType, type RequestType } from '@/lib/account/request-rules';
import { createCustomerOrderRequest } from '@/lib/store-admin/order-requests';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export async function POST(request: NextRequest, context: { params: Promise<{ txnid: string }> }) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-order-request:${auth.session.userId}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  const { txnid } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!validateRequestType(body?.type)) return NextResponse.json({ error: 'Invalid request type.' }, { status: 400 });
  const reason = typeof body?.reason === 'string' ? body.reason : '';
  try {
    const created = await createCustomerOrderRequest(auth.session.userId, txnid, body.type as RequestType, reason);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create request.';
    return NextResponse.json({ error: message }, { status: message === 'Order not found.' ? 404 : 400 });
  }
}

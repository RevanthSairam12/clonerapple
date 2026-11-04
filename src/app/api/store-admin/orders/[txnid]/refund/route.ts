import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { initiateRefund, enqueueRefundLifecycleNotification } from '@/lib/store-admin/refund-lifecycle';

export const dynamic = 'force-dynamic';

/** Reserve a manual refund. No money movement or completed ledger entry occurs. */
export async function POST(request: Request, context: { params: Promise<{ txnid: string }> }) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed;
  } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  const { txnid } = await context.params;
  const result = await initiateRefund({ txnid, amountPaise: body.amountPaise as number,
    method: body.method, reason: body.reason, note: body.note,
    actorId: guard.session.adminId, actorEmail: guard.session.email, request });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status:
    result.reason === 'not-found' ? 404 : result.reason === 'unavailable' ? 503 :
      ['invalid-input', 'invalid-amount'].includes(result.reason) ? 400 : 409 });
  await enqueueRefundLifecycleNotification(result);
  return NextResponse.json(result, { status: 201 });
}

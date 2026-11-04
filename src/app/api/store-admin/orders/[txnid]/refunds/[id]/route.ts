import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { resolveRefundRequest, enqueueRefundLifecycleNotification } from '@/lib/store-admin/refund-lifecycle';

export const dynamic = 'force-dynamic';

/** Terminal history is append-only. Repeating the same resolution is idempotent. */
export async function POST(request: Request, context: { params: Promise<{ txnid: string; id: string }> }) {
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
  if (body.status !== 'COMPLETED' && body.status !== 'FAILED' && body.status !== 'REJECTED') {
    return NextResponse.json({ error: 'Choose Completed, Failed or Rejected.' }, { status: 400 });
  }
  const { txnid, id } = await context.params;
  const result = await resolveRefundRequest({ txnid, requestId: id, status: body.status,
    providerRef: body.providerRef, actorId: guard.session.adminId, actorEmail: guard.session.email, request });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status:
    result.reason === 'not-found' ? 404 : result.reason === 'unavailable' ? 503 :
      ['invalid-input', 'invalid-amount'].includes(result.reason) ? 400 : 409 });
  // Retries also enqueue, using the same lifecycle token to recover an earlier enqueue failure.
  await enqueueRefundLifecycleNotification(result);
  return NextResponse.json(result);
}

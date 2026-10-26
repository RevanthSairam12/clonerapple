import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { cancelOrder } from '@/lib/store-admin/returns';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'invalid-input') return 400;
  if (reason === 'already-cancelled' || reason === 'already-delivered') return 409;
  if (reason === 'owner-required') return 403;
  return 503;
}

/**
 * Cancel an order that has not been delivered. The reason comes from the
 * catalogue so reports can group cancellations; the free-text note stays on the
 * order and is never copied into the audit payload.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { reasonId?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await cancelOrder({
    txnid,
    reasonId: body.reasonId,
    note: body.note,
    actorId: guard.session.adminId,
    role: guard.session.role,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.cancel',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { reasonId: typeof body.reasonId === 'string' ? body.reasonId : null },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.cancel',
    entity: 'order',
    entityId: result.orderId,
    reason: 'order_cancelled',
    after: {
      txnid: result.txnid,
      reasonId: typeof body.reasonId === 'string' ? body.reasonId : null,
      previousStatus: result.previousStatus,
      paymentStatus: result.paymentStatus,
    },
    request,
  });

  return NextResponse.json({
    txnid: result.txnid,
    previousStatus: result.previousStatus,
    paymentStatus: result.paymentStatus,
  });
}

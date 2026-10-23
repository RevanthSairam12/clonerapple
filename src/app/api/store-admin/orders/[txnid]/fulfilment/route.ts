import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole, type StoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  isFulfilmentStatus,
  transitionFulfilment,
  type FulfilmentStatus,
} from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (
    reason === 'invalid-transition' ||
    reason === 'payment-required' ||
    reason === 'owner-required' ||
    reason === 'delivery-required'
  ) {
    return 409;
  }
  if (reason === 'invalid-input') return 400;
  return 503;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { target?: unknown; status?: unknown; fulfilmentStatus?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const targetValue = body.target ?? body.fulfilmentStatus ?? body.status;
  if (!isFulfilmentStatus(targetValue)) {
    return NextResponse.json({ error: 'Invalid fulfilment status.' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 200) {
    return NextResponse.json({ error: 'Reason must be 200 characters or fewer.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await transitionFulfilment({
    txnid,
    target: targetValue as FulfilmentStatus,
    staffId: guard.session.adminId,
    role: guard.session.role as StoreRole,
    reason,
  });
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.fulfilment.transition',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { target: targetValue },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.fulfilment.transition',
    entity: 'order',
    entityId: result.orderId,
    before: { fulfilmentStatus: result.previousStatus },
    after: { fulfilmentStatus: result.currentStatus },
    reason: result.currentStatus === 'CANCELED' ? 'cancellation_requested' : 'status_transition',
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.txnid,
    previousStatus: result.previousStatus,
    fulfilmentStatus: result.currentStatus,
  });
}

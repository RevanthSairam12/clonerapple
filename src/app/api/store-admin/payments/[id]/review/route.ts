import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { reviewManualPayment } from '@/lib/store-admin/payments';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'not-pending' || reason === 'cancelled') return 409;
  if (reason === 'invalid-input') return 400;
  return 503;
}

/**
 * Approve or reject a manual payment that was parked for review.
 *
 * Only store admins and owners may decide; viewers can read the queue through
 * the page but not this route. The rejection reason is required and is stored on
 * the payment row, never in the audit `after` payload.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { decision?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const decision = body.decision === 'approve' || body.decision === 'reject' ? body.decision : null;
  if (!decision) {
    return NextResponse.json({ error: 'Decision must be approve or reject.' }, { status: 400 });
  }

  const paymentId = Number((await context.params).id);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
  }

  const result = await reviewManualPayment({
    paymentId,
    decision,
    reason: typeof body.reason === 'string' ? body.reason : '',
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'payment.review',
      entity: 'payment',
      entityId: String(paymentId),
      status: 'denied',
      reason: result.reason,
      after: { decision },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'payment.review',
    entity: 'payment',
    entityId: String(paymentId),
    reason: decision === 'reject' ? 'manual_payment_rejected' : 'manual_payment_verified',
    after: {
      decision: result.decision,
      txnid: result.txnid,
      orderPaidNow: result.orderPaidNow,
      paidPaise: result.paidPaise,
      totalPaise: result.totalPaise,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    decision: result.decision,
    txnid: result.txnid,
    orderPaidNow: result.orderPaidNow,
    paidPaise: result.paidPaise,
    totalPaise: result.totalPaise,
  });
}

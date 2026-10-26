import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { recordRefund } from '@/lib/store-admin/returns';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'invalid-input' || reason === 'invalid-amount') return 400;
  if (reason === 'refund-exceeds-captured' || reason === 'return-not-received') return 409;
  return 503;
}

/**
 * Record a refund that is not tied to a return — for example a goodwill refund
 * on a delivered order, or money back after cancelling a paid order.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: {
    amountPaise?: unknown;
    method?: unknown;
    providerRef?: unknown;
    reason?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const amountPaise = Number(body.amountPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return NextResponse.json({ error: 'Enter a refund amount greater than zero.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await recordRefund({
    txnid,
    returnId: null,
    amountPaise,
    method: body.method,
    providerRef: body.providerRef,
    reason: body.reason,
    note: body.note,
    actorId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'refund.record',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { amountPaise },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'refund.record',
    entity: 'order',
    entityId: result.orderId,
    reason: 'manual_refund',
    after: {
      refundId: result.refundId,
      txnid: result.txnid,
      amountPaise: result.amountPaise,
      method: typeof body.method === 'string' ? body.method : 'unknown',
      remainingPaise: result.remainingPaise,
    },
    request,
  });

  return NextResponse.json(
    { refundId: result.refundId, amountPaise: result.amountPaise, remainingPaise: result.remainingPaise },
    { status: 201 },
  );
}

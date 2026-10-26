import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getReturnDetail, recordRefund } from '@/lib/store-admin/returns';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'invalid-input' || reason === 'invalid-amount') return 400;
  if (reason === 'refund-exceeds-captured' || reason === 'return-not-received') return 409;
  return 503;
}

/**
 * Record a manual refund against a received return. Refunds are staff-initiated
 * transfers (cash, UPI, bank, machine) — there is no PayU refund call. The row is
 * append-only and the repository refuses to exceed the captured total.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
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

  const { id } = await context.params;
  const detail = await getReturnDetail(id);
  if (!detail.ok) {
    return NextResponse.json(
      { error: detail.reason === 'not-found' ? 'Return not found.' : 'Returns are not available.' },
      { status: detail.reason === 'not-found' ? 404 : 503 },
    );
  }

  const result = await recordRefund({
    txnid: detail.data.txnid,
    returnId: detail.data.id,
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
      entity: 'return',
      entityId: id,
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
    entity: 'return',
    entityId: id,
    reason: 'manual_refund',
    after: {
      refundId: result.refundId,
      txnid: result.txnid,
      amountPaise: result.amountPaise,
      method: typeof body.method === 'string' ? body.method : 'unknown',
      remainingPaise: result.remainingPaise,
      returnClosed: result.returnClosed,
    },
    request,
  });

  return NextResponse.json(
    {
      refundId: result.refundId,
      amountPaise: result.amountPaise,
      remainingPaise: result.remainingPaise,
      returnClosed: result.returnClosed,
    },
    { status: 201 },
  );
}

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { voidPosSale } from '@/lib/store-admin/pos';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json({ error: 'A void reason is required.' }, { status: 400 });
  }
  if (reason.length > 200) {
    return NextResponse.json({ error: 'Reason must be 200 characters or fewer.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await voidPosSale({
    txnid,
    staffId: guard.session.adminId,
    role: guard.session.role,
    reason,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.payment.pos.void',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status =
      result.reason === 'not-found'
        ? 404
        : result.reason === 'unavailable'
          ? 503
          : result.reason === 'forbidden'
            ? 403
            : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.payment.pos.void',
    entity: 'order',
    entityId: result.orderId,
    before: { status: 'PAID' },
    after: { status: 'CANCELLED', receiptNo: result.receiptNo },
    reason,
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.txnid,
    receiptNo: result.receiptNo,
    status: 'CANCELLED',
  });
}

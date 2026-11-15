import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { saveOrderSerialNumbers } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'payment-required' || reason === 'invalid-transition') return 409;
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

  let body: { serialNumbers?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await saveOrderSerialNumbers({
    txnid,
    serialNumbers: body.serialNumbers,
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.serial_numbers.save',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.serial_numbers.save',
    entity: 'order',
    entityId: result.orderId,
    after: { itemCount: result.itemCount, invoiceNumber: result.invoiceNumber },
    reason: 'serial_numbers_recorded',
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.txnid,
    itemCount: result.itemCount,
    invoiceNumber: result.invoiceNumber,
    invoiceIssuedAt: result.invoiceIssuedAt,
  });
}

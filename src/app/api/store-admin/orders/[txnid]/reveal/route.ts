import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  isOrderRevealField,
  revealOrderField,
} from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { field?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const field = body.field;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!isOrderRevealField(field) || reason.length < 10 || reason.length > 200) {
    return NextResponse.json({ error: 'A valid field and a 10-200 character reason are required.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await revealOrderField(txnid, field);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.reveal',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { field },
      request,
    });
    return NextResponse.json({ error: result.reason === 'not-found' ? 'Order not found.' : 'Order field unavailable.' }, { status: result.reason === 'not-found' ? 404 : 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.reveal',
    entity: 'order',
    entityId: txnid,
    after: { field },
    reason,
    request,
  });
  return NextResponse.json({ ok: true, field, value: result.value });
}

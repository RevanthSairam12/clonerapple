import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { updateOrderContact, type ContactEditInput } from '@/lib/store-admin/order-edits';
import { getOrderDetail } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { txnid } = await context.params;
  const result = await getOrderDetail(txnid, guard.session.role);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Order records are not available.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.view',
    entity: 'order',
    entityId: result.data.id,
    reason: 'detail_api',
    request,
  });

  return NextResponse.json({ order: result.data });
}

/**
 * Edit the customer contact block and shipping address.
 *
 * Items and amounts are intentionally not editable here — the gateway amount is
 * captured at payment time. Every applied change writes an immutable
 * `order_edit_logs` row plus an audit row; neither carries full PII.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: ContactEditInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await updateOrderContact({
    txnid,
    edit: body,
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
  });

  if (!result.ok) {
    const status =
      result.reason === 'not-found'
        ? 404
        : result.reason === 'invalid-input' || result.reason === 'not-editable'
          ? 400
          : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.edit',
    entity: 'order',
    entityId: result.orderId,
    reason: typeof body.reason === 'string' ? body.reason.trim() : 'order_edit',
    after: { changedFields: result.changedFields },
    request,
  });

  return NextResponse.json({ ok: true, changedFields: result.changedFields });
}

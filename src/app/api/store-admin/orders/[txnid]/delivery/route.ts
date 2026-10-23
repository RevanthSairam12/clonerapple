import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { validateDeliveryInput } from '@/lib/store-admin/delivery';
import { updateDelivery } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateDeliveryInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { txnid } = await context.params;
  const result = await updateDelivery({
    txnid,
    value: validation.value,
    staffId: guard.session.adminId,
  });
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.delivery.update',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status = result.reason === 'not-found' ? 404 : result.reason === 'invalid-transition' ? 409 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.delivery.update',
    entity: 'order',
    entityId: result.orderId,
    after: {
      deliveryId: result.deliveryId,
      method: result.value.method,
      hasTrackingNumber: Boolean(result.value.trackingNumber),
      hasTrackingUrl: Boolean(result.value.trackingUrl),
      scheduledFor: result.value.scheduledFor,
      deliverySlot: result.value.deliverySlot,
    },
    reason: 'delivery_details_updated',
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.txnid,
    delivery: {
      id: result.deliveryId,
      method: result.value.method,
      carrier: result.value.carrier,
      trackingNumber: result.value.trackingNumber,
      trackingUrl: result.value.trackingUrl,
      scheduledFor: result.value.scheduledFor,
      deliverySlot: result.value.deliverySlot,
    },
  });
}

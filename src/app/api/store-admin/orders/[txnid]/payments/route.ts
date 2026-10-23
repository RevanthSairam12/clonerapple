import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { listOrderPayments, recordManualPayment, validateManualPayment, type ManualMethod } from '@/lib/store-admin/payments';
import { parseAmountToPaise } from '@/lib/store-admin/amount';
import { getOrderDetail } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'already-paid' || reason === 'cancelled') return 409;
  if (reason === 'invalid-input') return 400;
  return 503;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { txnid } = await context.params;
  const detail = await getOrderDetail(txnid, guard.session.role);
  if (!detail.ok) {
    if (detail.reason === 'not-found') {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Order records are not available.' }, { status: 503 });
  }

  const payments = await listOrderPayments(detail.data.id);
  if (!payments.ok) {
    return NextResponse.json({ error: 'Payments are not available.' }, { status: 503 });
  }
  return NextResponse.json({ payments: payments.data });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { method?: unknown; amountPaise?: unknown; amount?: unknown; providerRef?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { txnid } = await context.params;

  const amountPaise =
    body.amountPaise !== undefined ? body.amountPaise : parseAmountToPaise(body.amount);

  const validation = validateManualPayment({
    method: body.method,
    amountPaise,
    providerRef: body.providerRef,
    notes: body.notes,
    role: guard.session.role,
  });
  if (!validation.ok) {
    const status =
      validation.code === 'invalid-input' || validation.code === 'ref-required'
        ? 400
        : 403;
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.payment.manual',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: validation.code,
      after: { method: body.method },
      request,
    });
    return NextResponse.json({ error: validation.error }, { status });
  }

  const result = await recordManualPayment({
    txnid,
    method: body.method as ManualMethod,
    amountPaise: validation.amountPaise,
    providerRef: validation.providerRef,
    notes: validation.notes,
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.payment.manual',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { method: body.method },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.payment.manual',
    entity: 'order',
    entityId: result.orderId,
    after: {
      method: body.method,
      orderPaidNow: result.orderPaidNow,
      paidPaise: result.paidPaise,
      totalPaise: result.totalPaise,
    },
    reason: 'manual_payment_recorded',
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.txnid,
    paymentId: result.paymentId,
    orderPaidNow: result.orderPaidNow,
    paidPaise: result.paidPaise,
    totalPaise: result.totalPaise,
  });
}

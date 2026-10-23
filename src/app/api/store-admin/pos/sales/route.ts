import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { createPosSale } from '@/lib/store-admin/pos';
import { isPosMethod, validatePosReference } from '@/lib/store-admin/pos-rules';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: {
    lines?: unknown;
    method?: unknown;
    providerRef?: unknown;
    customerPhone?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!isPosMethod(body.method)) {
    return NextResponse.json({ error: 'Choose cash, UPI or card machine.' }, { status: 400 });
  }

  const reference = validatePosReference(body.method, body.providerRef);
  if (!reference.ok) {
    return NextResponse.json({ error: reference.error }, { status: 400 });
  }

  const result = await createPosSale({
    lines: body.lines,
    method: body.method,
    providerRef: reference.reference,
    customerPhone:
      typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null,
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.payment.pos',
      entity: 'order',
      entityId: '',
      status: 'denied',
      reason: result.reason,
      after: { method: body.method },
      request,
    });
    const status = result.reason === 'invalid-input' ? 400 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.payment.pos',
    entity: 'order',
    entityId: '',
    after: {
      txnid: result.data.txnid,
      receiptNo: result.data.receiptNo,
      method: result.data.method,
      totalPaise: result.data.totalPaise,
      lines: result.data.lines.length,
    },
    reason: 'pos_sale_recorded',
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.data.txnid,
    receiptNo: result.data.receiptNo,
    paymentId: result.data.paymentId,
    lines: result.data.lines,
    subtotalPaise: result.data.subtotalPaise,
    totalPaise: result.data.totalPaise,
    method: result.data.method,
    shiftId: result.data.shiftId,
    customerPhoneMasked: result.data.customerPhoneMasked,
  });
}

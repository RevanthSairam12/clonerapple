import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { createPosSale } from '@/lib/store-admin/pos';
import { isPosMethod, validatePosReference } from '@/lib/store-admin/pos-rules';
import { revalidateCatalog } from '@/lib/storefront/revalidate';
import { BUSY_RETRY_AFTER } from '@/lib/checkout/transaction-guards';

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
    confirmUnusualPrices?: unknown;
    confirmedFreeItemIds?: unknown;
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
    role: guard.session.role,
    confirmUnusualPrices: body.confirmUnusualPrices === true,
    confirmedFreeItemIds: body.confirmedFreeItemIds,
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
    const status =
      result.reason === 'invalid-input'
        ? 400
        : result.reason === 'forbidden'
          ? 403
          : result.reason === 'unavailable'
            ? 503
            : 409;
    return NextResponse.json(
      {
        error: result.error,
        ...(result.warnings ? { needsConfirmation: true, warnings: result.warnings } : {}),
      },
      {
        status,
        ...(status === 503 ? { headers: { 'Retry-After': BUSY_RETRY_AFTER } } : {}),
      },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.payment.pos',
    entity: 'order',
    entityId: result.data.orderId,
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

  // One row per sale: what the cashier charged and the list price it was
  // compared against. No customer contact value is copied into the log.
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'pos.price_entered',
    entity: 'order',
    entityId: result.data.orderId,
    after: {
      txnid: result.data.txnid,
      receiptNo: result.data.receiptNo,
      lines: result.data.lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        referencePricePaise: line.referencePricePaise,
        chargedPricePaise: line.unitPricePaise,
      })),
    },
    reason: 'pos_price_entered',
    request,
  });

  revalidateCatalog(result.data.lines.map((line) => line.productId));

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

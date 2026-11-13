import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { setOrderTestFlag, validateTestOrderReason } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/orders/[txnid]/test-order
 *
 * Owner-only audited action to mark or unmark an order as a test order.
 * Nothing is deleted or renumbered; marked orders remain inspectable in Orders
 * and are excluded from revenue, overview analytics, customers, and reports.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { isTest?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof body.isTest !== 'boolean') {
    return NextResponse.json({ error: 'Specify whether to mark or unmark as a test order.' }, { status: 400 });
  }

  const reasonCheck = validateTestOrderReason(body.reason);
  if (!reasonCheck.ok) {
    return NextResponse.json({ error: reasonCheck.error }, { status: 400 });
  }

  const { txnid } = await context.params;
  const action = body.isTest ? 'order.test.mark' : 'order.test.unmark';

  const result = await setOrderTestFlag({
    txnid,
    isTest: body.isTest,
    reason: reasonCheck.reason,
    staffId: guard.session.adminId,
    role: guard.session.role,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action,
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status =
      result.reason === 'not-found'
        ? 404
        : result.reason === 'owner-required'
          ? 403
          : result.reason === 'migration-pending'
            ? 409
            : result.reason === 'invalid-input'
              ? 400
              : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action,
    entity: 'order',
    entityId: result.orderId,
    before: { isTest: result.previousIsTest },
    after: { isTest: result.isTest, orderNumber: result.orderNumber },
    reason: reasonCheck.reason,
    request,
  });

  return NextResponse.json({
    ok: true,
    txnid: result.txnid,
    isTest: result.isTest,
  });
}


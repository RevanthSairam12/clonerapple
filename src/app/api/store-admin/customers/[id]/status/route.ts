import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { setCustomerBlocked } from '@/lib/store-admin/customer-accounts';
import { blockReasonError } from '@/lib/store-admin/customer-rules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/customers/[id]/status
 *
 * Body: `{ blocked: boolean, reason?: string }`.
 *
 * Blocking ends every storefront session for the account immediately, and
 * `getUserSession()` refuses blocked accounts even if a session row somehow
 * survives. Unblocking leaves the customer's sessions deleted.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { blocked?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof body.blocked !== 'boolean') {
    return NextResponse.json({ error: 'State must be true or false.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (body.blocked) {
    const reasonProblem = blockReasonError(reason);
    if (reasonProblem) {
      return NextResponse.json({ error: reasonProblem }, { status: 400 });
    }
  }

  const { id } = await context.params;
  const result = await setCustomerBlocked({
    customerId: id,
    blocked: body.blocked,
    reason,
  });

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'The account could not be updated.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: body.blocked ? 'customer.block' : 'customer.unblock',
    entity: 'customer',
    entityId: id,
    before: result.before,
    after: {
      blocked: result.after.blocked,
      reason: result.after.reason,
      revokedSessions: result.revokedSessions,
    },
    reason: body.blocked ? 'account_blocked' : 'account_unblocked',
    request,
  });

  return NextResponse.json({
    ok: true,
    blocked: result.after.blocked,
    revokedSessions: result.revokedSessions,
  });
}

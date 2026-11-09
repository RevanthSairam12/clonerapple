import { NextResponse } from 'next/server';

import { checkAdminPayment } from '@/lib/account/payment-verification';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';

export const dynamic = 'force-dynamic';

/**
 * Staff "Verify with PayU" on one order.
 *
 * Uses the shared PostgreSQL-backed verification claim (`checkAdminPayment`) so
 * the per-staff rate limit (10/min), per-order 15-second cooldown/lease, and
 * already-paid short-circuit are enforced atomically across all serverless
 * instances before making an outbound PayU verify_payment request.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { txnid } = await context.params;
  const result = await checkAdminPayment(
    { adminId: guard.session.adminId, email: guard.session.email },
    txnid,
    request,
  );

  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
      ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
    },
  });
}

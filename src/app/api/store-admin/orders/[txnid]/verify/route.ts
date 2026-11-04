import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { verifyOrderWithPayU } from '@/lib/payu/process-response';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';

export const dynamic = 'force-dynamic';

/**
 * Staff "Verify with PayU" on one order.
 *
 * It reads the gateway and runs the same processor as the callbacks, so a
 * capture that the customer's browser never reported can still settle the
 * order — and a mismatch flags it for review instead of marking it paid. It
 * moves no money by itself and never refunds; it only records what the gateway
 * says.
 *
 * Rate limited per staff account: the verify API is a paid, upstream call and
 * a stuck button must not become a poll loop.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const limit = checkRateLimit(`store-admin-verify:${guard.session.adminId}`, {
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many verification attempts. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const { txnid } = await context.params;
  const key = (txnid || '').trim();
  if (!key) return NextResponse.json({ error: 'Which order?' }, { status: 400 });

  const result = await verifyOrderWithPayU(key);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.payment.verify',
    entity: 'order',
    entityId: key,
    status: result.ok ? 'ok' : result.rejected ? 'flagged' : 'denied',
    reason: result.reason ?? (result.ok ? 'verified_with_payu' : 'verify_failed'),
    after: {
      orderStatus: result.status,
      outcome: result.ok ? 'settled' : 'not_settled',
    },
    request,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.order
          ? 'PayU did not confirm a capture for this order. It has not been marked paid.'
          : 'Order not found.',
        status: result.status,
      },
      { status: result.order ? 409 : 404 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      txnid: result.txnid,
      status: result.status,
      reason: result.reason ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

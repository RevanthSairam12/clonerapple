import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { clearPaymentReview } from '@/lib/store-admin/payments';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'not-flagged') return 409;
  return 503;
}

/**
 * Acknowledge a paid order whose stock could not be re-claimed.
 *
 * This clears the review flag only. Stock and any refund stay manual, so this
 * route never moves money. The audit row names the order and outcome, never a
 * customer address or contact.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { txnid?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const txnid = typeof body.txnid === 'string' ? body.txnid.trim() : '';
  if (!txnid) return NextResponse.json({ error: 'Which order?' }, { status: 400 });

  const result = await clearPaymentReview({ txnid, staffId: guard.session.adminId });

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'payment.review_cleared',
    entity: 'order',
    entityId: txnid,
    status: result.ok ? 'ok' : 'denied',
    reason: result.ok ? 'late_capture_reviewed' : result.reason,
    request,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: statusForFailure(result.reason) },
    );
  }

  return NextResponse.json({ ok: true, txnid: result.txnid }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

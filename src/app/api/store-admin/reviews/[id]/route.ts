import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';
import { isReviewAction } from '@/lib/store-admin/review-rules';
import { getReview, setReviewReply, setReviewStatus } from '@/lib/store-admin/reviews';

/**
 * One review read plus its two moderation actions:
 * publish/reject (with a mandatory rejection reason) and the public reply.
 * Every change is audited without the customer's email or name.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getReview(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }
  return NextResponse.json({ review: result.data });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = payload.action;
  if (!isReviewAction(action)) {
    return NextResponse.json(
      { error: 'Use action "publish", "reject" or "reply".' },
      { status: 400 },
    );
  }

  const { id } = await context.params;

  if (action === 'reply') {
    const reply = typeof payload.reply === 'string' ? payload.reply : '';
    const result = await setReviewReply({
      id,
      reply,
      staffId: guard.session.adminId,
    });
    if (!result.ok) {
      await writeAudit({
        actorId: guard.session.adminId,
        actorEmail: guard.session.email,
        action: 'review.reply',
        entity: 'product_review',
        entityId: id,
        status: 'denied',
        reason: result.reason,
        request,
      });
      return NextResponse.json(
        { error: result.error },
        { status: catalogFailureStatus(result.reason) },
      );
    }

    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'review.reply',
      entity: 'product_review',
      entityId: id,
      before: { store_reply: result.data.before.store_reply ?? '' },
      after: { store_reply: result.data.after.store_reply ?? '' },
      reason: 'store_reply_saved',
      request,
    });

    return NextResponse.json({ ok: true, review: result.data.after });
  }

  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  const result = await setReviewStatus({ id, action, reason });
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'review.status',
      entity: 'product_review',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      after: { action, rejection_reason: action === 'reject' ? reason.trim() : '' },
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'review.status',
    entity: 'product_review',
    entityId: id,
    before: { status: result.data.before.status ?? '' },
    after: {
      status: result.data.after.status ?? '',
      rejection_reason: result.data.after.rejection_reason ?? '',
    },
    reason: action === 'publish' ? 'review_published' : 'review_rejected',
    request,
  });

  return NextResponse.json({ ok: true, review: result.data.after });
}

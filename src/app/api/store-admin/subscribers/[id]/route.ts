import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { unsubscribeReasonError } from '@/lib/store-admin/customer-rules';
import { resubscribeSubscriber, unsubscribeSubscriber } from '@/lib/store-admin/subscribers';

export const dynamic = 'force-dynamic';

/** PATCH body: `{ action: "unsubscribe" | "resubscribe", reason?: string }`. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { action?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'unsubscribe' && action !== 'resubscribe') {
    return NextResponse.json(
      { error: 'Action must be "unsubscribe" or "resubscribe".' },
      { status: 400 },
    );
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const reasonProblem = unsubscribeReasonError(reason);
  if (reasonProblem) {
    return NextResponse.json({ error: reasonProblem }, { status: 400 });
  }

  const { id } = await context.params;
  const result =
    action === 'unsubscribe'
      ? await unsubscribeSubscriber(id, reason)
      : await resubscribeSubscriber(id);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json(
        { error: 'That subscriber is already in the requested state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'The subscriber could not be updated.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: action === 'unsubscribe' ? 'subscriber.unsubscribe' : 'subscriber.resubscribe',
    entity: 'newsletter_subscriber',
    entityId: id,
    before: { status: result.data.before },
    after: { status: result.data.after, reason },
    reason: 'staff_change',
    request,
  });

  return NextResponse.json({ ok: true, status: result.data.after });
}

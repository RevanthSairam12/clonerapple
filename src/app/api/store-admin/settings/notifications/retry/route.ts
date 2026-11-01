import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { retryNotification } from '@/lib/notifications/outbox';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';

export const dynamic = 'force-dynamic';

/**
 * Retry one terminal FAILED message.
 *
 * Only store admins and owners may trigger a send; viewers can read the log.
 * The audit row names the message id and outcome, never its recipient, subject
 * or body.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'Which message?' }, { status: 400 });

  const result = await retryNotification(id);
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'notification.retry',
    entity: 'notification',
    entityId: id,
    status: result.ok ? 'ok' : 'denied',
    reason: result.ok ? 'requeued' : (result.error ?? 'not_retryable'),
    request,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

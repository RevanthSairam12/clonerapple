import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { listStaffSessions, revokeAllStaffSessions, revokeStaffSession } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

/** GET /api/store-admin/staff/[id]/sessions — active sessions for one account. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await listStaffSessions(id, null);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(
    { sessions: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * DELETE /api/store-admin/staff/[id]/sessions — revoke one session or all.
 * Body: `{ sessionId?: string }`; omitting it signs the account out everywhere.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { sessionId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "revoke everything", which the UI asks for
    // explicitly; a malformed body is treated the same way.
  }

  const { id } = await context.params;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  const result = sessionId
    ? await revokeStaffSession(id, sessionId)
    : await revokeAllStaffSessions(id, null);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'staff.sessions_revoke',
      entity: 'store_admin',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: result.reason === 'not-found' ? 404 : 503 },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'staff.sessions_revoke',
    entity: 'store_admin',
    entityId: id,
    reason: sessionId ? 'single_session' : 'all_sessions',
    after: 'sessionsRevoked' in (result.data as object) ? result.data : { sessionId },
    request,
  });

  return NextResponse.json({
    ok: true,
    sessionsRevoked: 'sessionsRevoked' in (result.data as object) ? (result.data as { sessionsRevoked: number }).sessionsRevoked : 1,
  });
}

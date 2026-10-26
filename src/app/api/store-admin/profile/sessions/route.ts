import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { currentStoreTokenHash, requireStoreRole } from '@/lib/store-admin/auth';
import { listStaffSessions, revokeAllStaffSessions, revokeStaffSession } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

/** GET /api/store-admin/profile/sessions — your own signed-in devices. */
export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const tokenHash = await currentStoreTokenHash();
  const result = await listStaffSessions(guard.session.adminId, tokenHash);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(
    { sessions: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * DELETE /api/store-admin/profile/sessions — sign out one other device, or
 * every other device. Body: `{ sessionId?: string }`.
 */
export async function DELETE(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  let body: { sessionId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Treat a missing body as "revoke everything else".
  }

  const tokenHash = await currentStoreTokenHash();
  if (!tokenHash) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (sessionId) {
    const sessions = await listStaffSessions(guard.session.adminId, tokenHash);
    if (!sessions.ok) {
      return NextResponse.json({ error: sessions.error }, { status: 503 });
    }
    const target = sessions.data.find((session) => session.id === sessionId);
    if (!target) {
      return NextResponse.json({ error: 'That session does not exist.' }, { status: 404 });
    }
    if (target.current) {
      return NextResponse.json(
        { error: 'Use sign out to end this session.' },
        { status: 400 },
      );
    }
  }

  const result = sessionId
    ? await revokeStaffSession(guard.session.adminId, sessionId)
    : await revokeAllStaffSessions(guard.session.adminId, tokenHash);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'profile.sessions_revoke',
    entity: 'store_admin',
    entityId: guard.session.adminId,
    reason: sessionId ? 'single_session' : 'all_other_sessions',
    request,
  });

  return NextResponse.json({
    ok: true,
    sessionsRevoked: 'sessionsRevoked' in (result.data as object) ? (result.data as { sessionsRevoked: number }).sessionsRevoked : 1,
  });
}

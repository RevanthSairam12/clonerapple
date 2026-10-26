import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { currentStoreTokenHash, requireStoreRole } from '@/lib/store-admin/auth';
import { changeOwnPassword } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/profile/password — change your own password.
 *
 * The current password is required. Every other session for the account is
 * revoked; this one stays signed in. Neither password reaches the audit log.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const tokenHash = await currentStoreTokenHash();
  if (!tokenHash) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await changeOwnPassword({
    adminId: guard.session.adminId,
    currentTokenHash: tokenHash,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'profile.password_change',
      entity: 'store_admin',
      entityId: guard.session.adminId,
      status: 'denied',
      reason: result.reason === 'invalid-input' ? 'invalid_current_password' : result.reason,
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: result.reason === 'invalid-input' ? 400 : 503 },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'profile.password_change',
    entity: 'store_admin',
    entityId: guard.session.adminId,
    reason: `other_sessions_revoked:${result.data.sessionsRevoked}`,
    request,
  });

  return NextResponse.json({ ok: true, sessionsRevoked: result.data.sessionsRevoked });
}

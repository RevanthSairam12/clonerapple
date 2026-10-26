import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { generateTemporaryPassword, resetStaffPassword } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/staff/[id]/password — owner resets a staff password.
 *
 * Body: `{ password?: string }`. When omitted the server generates one. The
 * new password is returned once, every existing session for that account is
 * revoked, and the account is flagged to change it at next sign-in.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { password?: unknown };
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const supplied = typeof body.password === 'string' ? body.password : '';
  const password = supplied || generateTemporaryPassword();

  const { id } = await context.params;
  const result = await resetStaffPassword(id, password);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'staff.password_reset',
      entity: 'store_admin',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status = result.reason === 'not-found' ? 404 : result.reason === 'invalid-input' ? 400 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'staff.password_reset',
    entity: 'store_admin',
    entityId: id,
    after: { mustChangePassword: true },
    reason: `sessions_revoked:${result.data.sessionsRevoked}`,
    request,
  });

  return NextResponse.json(
    {
      staff: result.data.staff,
      temporaryPassword: password,
      sessionsRevoked: result.data.sessionsRevoked,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

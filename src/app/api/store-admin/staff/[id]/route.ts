import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { getStaff, updateStaff } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getStaff(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.reason === 'not-found' ? 404 : 503 });
  }
  return NextResponse.json({ staff: result.data }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * PATCH /api/store-admin/staff/[id] — name, phone, role or active state.
 *
 * Deactivating, or changing the role, revokes every session for that account.
 * The rules refuse to leave the store without an active owner and refuse
 * self-lockout. The audit row carries the changed fields only.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await updateStaff(
    id,
    { name: body.name, phone: body.phone, role: body.role, isActive: body.isActive },
    guard.session.adminId,
  );

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'staff.update',
      entity: 'store_admin',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status =
      result.reason === 'not-found'
        ? 404
        : result.reason === 'invalid-input' || result.reason === 'last-owner'
          ? 400
          : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  const { before, after, sessionsRevoked } = result.data;
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'staff.update',
    entity: 'store_admin',
    entityId: after.id,
    before: { name: before.name, role: before.role, isActive: before.isActive },
    after: { name: after.name, role: after.role, isActive: after.isActive },
    reason: sessionsRevoked > 0 ? `sessions_revoked:${sessionsRevoked}` : 'staff_edit',
    request,
  });

  return NextResponse.json({ staff: after, sessionsRevoked });
}

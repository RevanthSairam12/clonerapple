import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { createStaff, listStaff } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

/** GET /api/store-admin/staff — the staff list (admin and owner). */
export async function GET() {
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const result = await listStaff();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(
    { staff: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/store-admin/staff — create an account (owner only).
 *
 * The temporary password is returned exactly once in this response. Only its
 * bcrypt hash is stored; the audit row records the role and name, never the
 * credential.
 */
export async function POST(request: Request) {
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

  const result = await createStaff({
    name: body.name,
    email: body.email,
    phone: body.phone,
    role: body.role,
    password: body.password,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'staff.create',
      entity: 'store_admin',
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status = result.reason === 'conflict' ? 409 : result.reason === 'invalid-input' ? 400 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'staff.create',
    entity: 'store_admin',
    entityId: result.data.staff.id,
    after: { name: result.data.staff.name, role: result.data.staff.role, isActive: true },
    reason: 'staff_created',
    request,
  });

  return NextResponse.json(
    {
      staff: result.data.staff,
      temporaryPassword: result.data.temporaryPassword,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}

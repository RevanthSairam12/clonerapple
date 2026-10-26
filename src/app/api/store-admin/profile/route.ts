import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { getStaff, updateOwnProfile } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

/** GET /api/store-admin/profile — the signed-in person's own record. */
export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getStaff(guard.session.adminId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(
    { profile: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** PUT /api/store-admin/profile — name and phone only. Role is never self-editable. */
export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  let body: { name?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await updateOwnProfile(guard.session.adminId, {
    name: body.name,
    phone: body.phone,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.reason === 'invalid-input' ? 400 : 503 },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'profile.update',
    entity: 'store_admin',
    entityId: guard.session.adminId,
    after: { name: result.data.name, phone: result.data.phone },
    reason: 'self_service',
    request,
  });

  return NextResponse.json({ profile: result.data });
}

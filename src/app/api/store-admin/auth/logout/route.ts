import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { logout, requireStoreRole, storeSessionCookie } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';

/**
 * POST /api/store-admin/auth/logout
 *
 * Authenticated: any signed-in store admin may end their own session. The
 * audit row is written after the session row is deleted; `actorId` is captured
 * first so the row still names the account that logged out.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { adminId, email, role } = guard.session;

  await logout();
  const store = await cookies();
  store.delete(storeSessionCookie.name);

  await writeAudit({
    actorId: adminId,
    actorEmail: email,
    action: 'store_admin.logout',
    entity: 'store_admin',
    entityId: adminId,
    after: { role },
    request,
  });

  return NextResponse.json({ ok: true });
}

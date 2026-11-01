import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { disableTotp } from '@/lib/store-admin/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/profile/totp/disable — turn two-factor off.
 *
 * Requires the current password AND a valid authenticator or backup code, so
 * a stolen session alone cannot weaken the account.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole({ allowPasswordChange: true });
  if (!guard.ok) return guard.response;

  let body: { password?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await disableTotp(guard.session.adminId, body.password, body.code);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'profile.totp_disable',
    entity: 'store_admin',
    entityId: guard.session.adminId,
    status: result.ok ? 'ok' : 'denied',
    reason: result.ok ? undefined : result.error,
    request,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

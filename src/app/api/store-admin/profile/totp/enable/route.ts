import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { confirmEnrollment } from '@/lib/store-admin/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/profile/totp/enable — confirm enrolment.
 *
 * Requires a valid 6-digit code generated from the pending secret. On success
 * the ten one-time backup codes are returned ONCE; only their hashes are
 * stored and no code reaches the audit log.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await confirmEnrollment(guard.session.adminId, body.code);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'profile.totp_enable',
    entity: 'store_admin',
    entityId: guard.session.adminId,
    status: result.ok ? 'ok' : 'denied',
    reason: result.ok ? undefined : result.error,
    request,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json(
    { ok: true, backupCodes: result.data.backupCodes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

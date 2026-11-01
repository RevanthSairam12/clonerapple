import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { startEnrollment } from '@/lib/store-admin/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/profile/totp/setup — start two-factor enrolment.
 *
 * Returns the setup key, the otpauth:// URL and a QR data URI once. The secret
 * is not enabled until a code from the app is confirmed through /enable.
 * Neither the secret nor the QR is written to the audit log.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await startEnrollment(guard.session.adminId, guard.session.email);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'profile.totp_setup',
    entity: 'store_admin',
    entityId: guard.session.adminId,
    status: result.ok ? 'ok' : 'failed',
    reason: result.ok ? undefined : result.error,
    request,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 503 });
  }

  return NextResponse.json(
    { ok: true, ...result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

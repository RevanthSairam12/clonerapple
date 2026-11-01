import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { getTotpState, resetStaffTotp } from '@/lib/store-admin/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/store-admin/staff/[id]/totp/reset — owner turns off another
 * staff member's two-factor so a lost device cannot lock them out.
 *
 * Audited with the before/after enabled state only — never a secret or code.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const before = await getTotpState(id);
  const ok = await resetStaffTotp(id);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'staff.totp_reset',
    entity: 'store_admin',
    entityId: id,
    before: { totp_enabled: before.enabled },
    after: { totp_enabled: false },
    status: ok ? 'ok' : 'failed',
    reason: ok ? undefined : 'not_found',
    request,
  });

  if (!ok) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

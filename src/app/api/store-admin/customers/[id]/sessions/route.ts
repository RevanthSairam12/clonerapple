import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  getAccountSecurity,
  revokeCustomerSessions,
} from '@/lib/store-admin/customer-accounts';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getAccountSecurity(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'Sessions are not available.' }, { status: 503 });
  }
  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST body: `{ sessionId: string }` to end one session, or
 * `{ all: true }` to end every session for the account.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { sessionId?: unknown; all?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const all = body.all === true;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  if (!all && !sessionId) {
    return NextResponse.json(
      { error: 'Choose a session, or revoke every session.' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const result = await revokeCustomerSessions(id, all ? null : sessionId);

  if (!result.ok) {
    if (result.reason === 'invalid-input') {
      return NextResponse.json({ error: 'Invalid session.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'The sessions could not be revoked.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'customer.sessions.revoke',
    entity: 'customer',
    entityId: id,
    after: { all, revoked: result.revoked },
    reason: 'staff_revoked_sessions',
    request,
  });

  return NextResponse.json({ ok: true, revoked: result.revoked });
}

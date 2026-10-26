import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getReturnDetail, transitionReturn, type ReturnAction } from '@/lib/store-admin/returns';

export const dynamic = 'force-dynamic';

const ACTIONS: readonly ReturnAction[] = ['approve', 'reject', 'receive', 'cancel'];

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'invalid-transition') return 409;
  if (reason === 'invalid-input') return 400;
  return 503;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getReturnDetail(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === 'not-found' ? 'Return not found.' : 'Returns are not available.' },
      { status: result.reason === 'not-found' ? 404 : 503 },
    );
  }
  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Move a return along: approve, reject, receive (this restocks eligible lines)
 * or cancel. Every decision is audited with the transition, never with the
 * free-text note.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const action = ACTIONS.find((candidate) => candidate === body.action);
  if (!action) {
    return NextResponse.json({ error: 'Action must be approve, reject, receive or cancel.' }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await transitionReturn({
    id,
    action,
    note: body.note,
    actorId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'return.transition',
      entity: 'return',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      after: { action },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'return.transition',
    entity: 'return',
    entityId: result.id,
    reason: action,
    after: { action, status: result.status },
    request,
  });

  return NextResponse.json({ id: result.id, status: result.status });
}

import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { getOrderRequestDetail, transitionOrderRequest, REQUESTS_UNAVAILABLE_MESSAGE } from '@/lib/store-admin/order-requests';
import { writeAudit } from '@/lib/store-admin/audit';
import { canTransitionRequest, type RequestStatus } from '@/lib/account/request-rules';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const detail = await getOrderRequestDetail(id);
  if (!detail.ok) {
    if (detail.reason === 'not-found') {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: REQUESTS_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  return NextResponse.json({ request: detail.data });
}

export async function PATCH(request: NextRequest, context: Context) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const before = await getOrderRequestDetail(id);
  if (!before.ok) {
    if (before.reason === 'not-found') return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    return NextResponse.json({ error: REQUESTS_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const status = body?.status as RequestStatus;
  const adminNote = typeof body?.adminNote === 'string' ? body.adminNote : '';
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(status) || (!canTransitionRequest(before.data.status, status) && before.data.status !== status)) {
    return NextResponse.json({ error: 'That request status change is not allowed.' }, { status: 400 });
  }
  try {
    const result = await transitionOrderRequest(id, status, adminNote, guard.session.adminId);
    await writeAudit({ request, actorId: guard.session.adminId, actorEmail: guard.session.email, action: 'update_request', entity: 'order_request', entityId: id, before: { status: result.before }, after: { status }, reason: 'request_status_changed' });
    return NextResponse.json({ request: result.after });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update request.' }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getOrderDetail } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { txnid } = await context.params;
  const result = await getOrderDetail(txnid, guard.session.role);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Order records are not available.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.view',
    entity: 'order',
    entityId: result.data.id,
    reason: 'detail_api',
    request,
  });

  return NextResponse.json({ order: result.data });
}

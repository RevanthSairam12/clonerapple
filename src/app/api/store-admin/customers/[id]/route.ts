import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getCustomerDetail } from '@/lib/store-admin/customers';

/**
 * Read-only customer detail for the store admin.
 *
 * GET only. The response carries masked contact details and the order summary
 * (txnid, amount, status, dates); payment gateway payloads are never selected.
 * Each successful view is recorded in the audit log.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getCustomerDetail(id);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Customer records are not available.' },
      { status: 503 },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'customer.view',
    entity: 'customer',
    entityId: result.data.id,
    reason: 'detail_api',
    request,
  });

  return NextResponse.json({ customer: result.data });
}

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { adjustStock } from '@/lib/store-admin/catalog-crud';
import { validateStockAdjustment } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Manual stock movement: receipt, adjustment or damage. */
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateStockAdjustment(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { productId } = await context.params;
  const result = await adjustStock({
    productId,
    adjustment: validation.value,
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.stock.adjust',
      entity: 'product',
      entityId: productId,
      status: 'denied',
      reason: result.reason,
      after: validation.value,
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'catalog.stock.adjust',
    entity: 'product',
    entityId: productId,
    before: result.data.before,
    after: result.data.after,
    reason: validation.value.reason,
    request,
  });

  return NextResponse.json({ ok: true, stock: result.data });
}

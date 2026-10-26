import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { queueNotification } from '@/lib/notifications/queue';
import { stockNotificationEvent } from '@/lib/notifications/stock-events';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { adjustStock } from '@/lib/store-admin/catalog-crud';
import { validateStockAdjustment } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

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

  revalidateCatalog(productId);

  // Only a crossing raises an alert: going below the threshold, or coming
  // back above zero. Staying low or staying in stock is silent, and the
  // movement id is the token so one adjustment cannot notify twice.
  const snapshot = result.data;
  const availableBefore = snapshot.before.onHand - snapshot.before.reserved;
  const availableAfter = snapshot.after.onHand - snapshot.after.reserved;
  const threshold = snapshot.lowStockThreshold;
  const stockContext = {
    productName: snapshot.productName,
    stockAvailable: availableAfter,
    staffLink: `/store-admin/stock/${encodeURIComponent(productId)}`,
    token: `movement:${snapshot.movementId}`,
  };
  const event = stockNotificationEvent({
    availableBefore,
    availableAfter,
    threshold,
  });
  if (event) {
    queueNotification(event, { type: 'product', id: productId }, stockContext);
  }

  return NextResponse.json({ ok: true, stock: result.data });
}

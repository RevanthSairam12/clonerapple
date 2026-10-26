import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getStockDetail, updateStockSettings } from '@/lib/store-admin/catalog-crud';
import { validateStockSettings } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Stock detail and settings: read for any role, edits for owner or admin. */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { productId } = await context.params;
  const result = await getStockDetail(productId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }
  return NextResponse.json({ stock: result.data });
}

export async function PATCH(
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

  const validation = validateStockSettings(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { productId } = await context.params;
  const result = await updateStockSettings({
    productId,
    settings: validation.value,
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.stock.settings',
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
    action: 'catalog.stock.settings',
    entity: 'product',
    entityId: productId,
    before: result.data.before,
    after: result.data.after,
    reason: 'stock_settings_updated',
    request,
  });

  return NextResponse.json({ ok: true, stock: result.data });
}

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getCatalogProduct } from '@/lib/store-admin/catalog';
import { validateProductPatch } from '@/lib/store-admin/catalog-rules';
import { catalogFailureStatus, updateProduct } from '@/lib/store-admin/catalog-writes';

/**
 * Catalogue detail for the store admin.
 *
 * GET returns the full record. PATCH edits copy and organisation only.
 * Price changes go through `products/[id]/price` so they append to
 * `price_history`; `validateProductPatch()` still refuses price fields here.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getCatalogProduct(id);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Catalogue is not available.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ product: result.data });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
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

  const validation = validateProductPatch(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await updateProduct(id, validation.value, guard.session.adminId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.product.update',
      entity: 'product',
      entityId: id,
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
    action: 'catalog.product.update',
    entity: 'product',
    entityId: id,
    before: result.data.before,
    after: result.data.after,
    reason: 'product_details_updated',
    request,
  });

  return NextResponse.json({ ok: true, product: result.data.after });
}

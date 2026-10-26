import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { listCatalogOverview } from '@/lib/store-admin/catalog';
import { createProduct } from '@/lib/store-admin/catalog-crud';
import { validateNewProductInput } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/**
 * Catalogue list and product creation.
 *
 * POST creates the product, its opening `price_history` row and its stock row
 * in one transaction. Price edits afterwards go through
 * `products/[id]/price` so every change is appended to the same history.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await listCatalogOverview();
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Catalogue is not available.' },
      { status: 503 },
    );
  }

  return NextResponse.json(result.data);
}

export async function POST(request: Request) {
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

  const validation = validateNewProductInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await createProduct(validation.value, guard.session.adminId);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.product.create',
      entity: 'product',
      entityId: validation.value.id,
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
    action: 'catalog.product.create',
    entity: 'product',
    entityId: result.data.id,
    after: {
      name: result.data.name,
      slug: result.data.slug,
      price_paise: result.data.pricePaise,
      track_inventory: result.data.trackInventory,
      initial_on_hand: result.data.initialOnHand,
    },
    reason: 'product_created',
    request,
  });

  return NextResponse.json({ ok: true, product: result.data }, { status: 201 });
}

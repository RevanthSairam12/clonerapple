import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { validateProductImageInput } from '@/lib/store-admin/catalog-rules';
import {
  archiveProductImage,
  catalogFailureStatus,
  restoreProductImage,
  updateProductImage,
} from '@/lib/store-admin/catalog-writes';

/**
 * One gallery image.
 *
 * PUT    replace url / alt / role / order
 * DELETE archive it (soft delete — the row is kept and can be restored)
 * POST   restore an archived image
 *
 * Setting a second primary or hover image is safe: the write layer demotes the
 * current holder inside the same transaction, so the partial unique indexes
 * are never violated.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; imageId: string }> };

export async function PUT(request: Request, context: Params) {
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

  const validation = validateProductImageInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id, imageId } = await context.params;
  const result = await updateProductImage(id, imageId, validation.value);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.image.update',
      entity: 'product_image',
      entityId: imageId,
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
    action: 'catalog.image.update',
    entity: 'product_image',
    entityId: imageId,
    after: result.data.image,
    reason: 'product_image_updated',
    request,
  });

  return NextResponse.json({ ok: true, image: result.data.image });
}

export async function DELETE(request: Request, context: Params) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id, imageId } = await context.params;
  const result = await archiveProductImage(id, imageId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.image.archive',
      entity: 'product_image',
      entityId: imageId,
      status: 'denied',
      reason: result.reason,
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
    action: 'catalog.image.archive',
    entity: 'product_image',
    entityId: imageId,
    after: result.data.image,
    reason: 'product_image_archived',
    request,
  });

  return NextResponse.json({ ok: true, image: result.data.image });
}

export async function POST(request: Request, context: Params) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id, imageId } = await context.params;
  const result = await restoreProductImage(id, imageId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.image.restore',
      entity: 'product_image',
      entityId: imageId,
      status: 'denied',
      reason: result.reason,
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
    action: 'catalog.image.restore',
    entity: 'product_image',
    entityId: imageId,
    after: result.data.image,
    reason: 'product_image_restored',
    request,
  });

  return NextResponse.json({ ok: true, image: result.data.image });
}

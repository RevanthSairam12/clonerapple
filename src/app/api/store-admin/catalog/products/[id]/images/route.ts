import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { validateProductImageInput } from '@/lib/store-admin/catalog-rules';
import { addProductImage, catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Add one image to a product's gallery. */
export const dynamic = 'force-dynamic';

export async function POST(
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

  const validation = validateProductImageInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await addProductImage(id, validation.value);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.image.add',
      entity: 'product_image',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      after: { ...validation.value, productId: id },
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
    action: 'catalog.image.add',
    entity: 'product_image',
    entityId: result.data.id,
    after: result.data,
    reason: 'product_image_added',
    request,
  });

  return NextResponse.json({ ok: true, image: result.data }, { status: 201 });
}

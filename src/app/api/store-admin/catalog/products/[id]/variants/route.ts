import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { upsertVariant } from '@/lib/store-admin/catalog-crud';
import { validateVariantInput } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Create or update a product variant. Price overrides append price history. */
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

  const validation = validateVariantInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await upsertVariant(id, validation.value, guard.session.adminId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.variant.save',
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
    action: 'catalog.variant.save',
    entity: 'product',
    entityId: id,
    before: result.data.before,
    after: result.data.after,
    reason: result.data.created ? 'variant_created' : 'variant_updated',
    request,
  });

  return NextResponse.json(
    { ok: true, created: result.data.created, variant: result.data.after },
    { status: result.data.created ? 201 : 200 },
  );
}

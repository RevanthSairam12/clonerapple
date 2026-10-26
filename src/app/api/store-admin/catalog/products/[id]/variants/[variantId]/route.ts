import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { archiveVariant } from '@/lib/store-admin/catalog-crud';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Archive a variant. Rows are kept so past orders still resolve. */
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; variantId: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id, variantId } = await context.params;
  const result = await archiveVariant(id, variantId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.variant.archive',
      entity: 'product',
      entityId: id,
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
    action: 'catalog.variant.archive',
    entity: 'product',
    entityId: id,
    before: result.data.before,
    after: result.data.after,
    reason: 'variant_archived',
    request,
  });

  return NextResponse.json({ ok: true });
}

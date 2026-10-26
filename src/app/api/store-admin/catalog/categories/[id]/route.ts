import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { archiveCategory } from '@/lib/store-admin/catalog-crud';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Archive a category. Refused while children or products still point at it. */
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await archiveCategory(id, guard.session.adminId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.category.archive',
      entity: 'category',
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
    action: 'catalog.category.archive',
    entity: 'category',
    entityId: id,
    before: result.data.before,
    after: result.data.after,
    reason: 'category_archived',
    request,
  });

  return NextResponse.json({ ok: true });
}

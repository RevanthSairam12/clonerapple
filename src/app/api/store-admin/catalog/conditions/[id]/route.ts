import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { setConditionActive } from '@/lib/store-admin/catalog-crud';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Show or hide a condition. Hiding is refused while products still use it. */
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || typeof (body as { isActive?: unknown }).isActive !== 'boolean') {
    return NextResponse.json({ error: 'Send isActive as true or false.' }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await setConditionActive(id, (body as { isActive: boolean }).isActive);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.condition.visibility',
      entity: 'condition',
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
    action: 'catalog.condition.visibility',
    entity: 'condition',
    entityId: id,
    before: result.data.before,
    after: result.data.after,
    reason: 'condition_visibility_changed',
    request,
  });

  return NextResponse.json({ ok: true, condition: result.data.after });
}

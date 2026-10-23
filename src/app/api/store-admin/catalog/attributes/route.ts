import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { listAttributes } from '@/lib/store-admin/catalog';
import { validateAttributeInput } from '@/lib/store-admin/catalog-rules';
import { catalogFailureStatus, upsertAttribute } from '@/lib/store-admin/catalog-writes';

/** Attribute reference data: list and create/update. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await listAttributes();
  if (!result.ok) {
    return NextResponse.json({ error: 'Catalogue is not available.' }, { status: 503 });
  }
  return NextResponse.json({ attributes: result.data });
}

export async function POST(request: Request) {
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

  const validation = validateAttributeInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await upsertAttribute(validation.value, guard.session.adminId);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.attribute.save',
      entity: 'attribute',
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
    action: 'catalog.attribute.save',
    entity: 'attribute',
    entityId: validation.value.id,
    before: result.data.before,
    after: result.data.after,
    reason: result.data.created ? 'attribute_created' : 'attribute_updated',
    request,
  });

  return NextResponse.json(
    { ok: true, created: result.data.created, attribute: result.data.after },
    { status: result.data.created ? 201 : 200 },
  );
}

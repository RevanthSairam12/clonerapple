import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { listUnits } from '@/lib/store-admin/catalog';
import { validateUnitInput } from '@/lib/store-admin/catalog-rules';
import { catalogFailureStatus, upsertUnit } from '@/lib/store-admin/catalog-writes';

/**
 * Unit reference data: list and create/update.
 *
 * Units are private reference data (RLS with no policy), so the storefront
 * never reads them; the unit label is rendered from the attribute instead.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await listUnits();
  if (!result.ok) {
    return NextResponse.json({ error: 'Catalogue is not available.' }, { status: 503 });
  }
  return NextResponse.json({ units: result.data });
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

  const validation = validateUnitInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await upsertUnit(validation.value);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.unit.save',
      entity: 'unit',
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
    action: 'catalog.unit.save',
    entity: 'unit',
    entityId: validation.value.id,
    before: result.data.before,
    after: result.data.after,
    reason: result.data.created ? 'unit_created' : 'unit_updated',
    request,
  });

  return NextResponse.json(
    { ok: true, created: result.data.created, unit: result.data.after },
    { status: result.data.created ? 201 : 200 },
  );
}

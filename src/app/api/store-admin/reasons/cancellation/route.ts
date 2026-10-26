import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { listCancellationReasons, saveCancellationReason } from '@/lib/store-admin/returns';

export const dynamic = 'force-dynamic';

/** Cancellation reasons, active first. */
export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const activeOnly = new URL(request.url).searchParams.get('active') === '1';
  const result = await listCancellationReasons(activeOnly);
  if (!result.ok) {
    return NextResponse.json({ error: 'Reasons are not available.' }, { status: 503 });
  }
  return NextResponse.json({ reasons: result.reasons }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Create or update a reason. Nothing is deleted — a reason that is no longer
 * wanted is deactivated so past orders keep their label.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { id?: unknown; label?: unknown; sortOrder?: unknown; isActive?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await saveCancellationReason({
    id: body.id,
    label: body.label,
    sortOrder: body.sortOrder,
    isActive: body.isActive,
  });

  if (!result.ok) {
    const status = result.reason === 'invalid-input' ? 400 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'reasons.cancellation.save',
    entity: 'cancellation_reason',
    entityId: result.reason.id,
    reason: typeof body.id === 'string' ? 'updated' : 'created',
    after: {
      label: result.reason.label,
      sortOrder: result.reason.sortOrder,
      isActive: result.reason.isActive,
    },
    request,
  });

  return NextResponse.json({ reason: result.reason }, { status: 201 });
}

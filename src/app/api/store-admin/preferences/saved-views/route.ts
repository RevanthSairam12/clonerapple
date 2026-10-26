import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getSavedViews, saveSavedViews } from '@/lib/store-admin/preferences';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getSavedViews(guard.session.adminId);
  if (!result.ok) {
    return NextResponse.json({ error: 'Preferences are not available.' }, { status: 503 });
  }
  return NextResponse.json({ views: result.views });
}

/**
 * Replace the caller's own saved order views. Everyone can manage their own
 * list; the payload is normalised to allow-listed filters before it is stored.
 */
export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  let body: { views?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await saveSavedViews(guard.session.adminId, body.views);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.reason === 'invalid-input' ? 400 : 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'preferences.saved_views',
    entity: 'store_admin_preference',
    entityId: guard.session.adminId,
    reason: 'saved_view_update',
    after: { count: result.views.length, names: result.views.map((view) => view.name) },
    request,
  });

  return NextResponse.json({ ok: true, views: result.views });
}

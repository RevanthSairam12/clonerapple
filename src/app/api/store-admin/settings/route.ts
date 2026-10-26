import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getStoreSettings, updateStoreSettings } from '@/lib/store-admin/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getStoreSettings();
  if (!result.ok) {
    return NextResponse.json({ error: 'Settings are not available.' }, { status: 503 });
  }
  return NextResponse.json(
    { settings: result.settings },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * PUT /api/store-admin/settings
 *
 * Accepts either a single `{ key, value }` (the old shape) or
 * `{ values: [{ key, value }, …] }` so one screen saves as one atomic call.
 * Admins may edit operational settings; maintenance keys stay owner-only.
 */
export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { key?: unknown; value?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const values = Array.isArray(body.values)
    ? body.values.map((item) => ({
        key: (item as { key?: unknown })?.key,
        value: (item as { value?: unknown })?.value,
      }))
    : [{ key: body.key, value: body.value }];

  const result = await updateStoreSettings(
    values,
    guard.session.adminId,
    guard.session.role === 'store_owner',
  );

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'settings.update',
      entity: 'store_settings',
      entityId: values.map((item) => String(item.key)).join(',').slice(0, 200),
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status =
      result.reason === 'invalid-input' ? 400 : result.reason === 'forbidden' ? 403 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  for (const change of result.changes) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'settings.update',
      entity: 'store_settings',
      entityId: change.key,
      before: { key: change.key, value: change.before },
      after: { key: change.key, value: change.after },
      reason: 'settings_edit',
      request,
    });
  }

  return NextResponse.json({ ok: true, changes: result.changes });
}

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { isStoreSettingKey } from '@/lib/store-admin/settings-rules';
import { getStoreSettings, updateStoreSetting } from '@/lib/store-admin/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getStoreSettings();
  if (!result.ok) {
    return NextResponse.json({ error: 'Settings are not available.' }, { status: 503 });
  }
  return NextResponse.json({ settings: result.settings });
}

export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { key?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!isStoreSettingKey(body.key)) {
    return NextResponse.json({ error: 'Unknown setting.' }, { status: 400 });
  }

  const result = await updateStoreSetting(body.key, body.value, guard.session.adminId);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'settings.update',
      entity: 'store_settings',
      entityId: String(body.key),
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status = result.reason === 'invalid-input' ? 400 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'settings.update',
    entity: 'store_settings',
    entityId: result.key,
    before: { key: result.key, value: result.before },
    after: { key: result.key, value: result.after },
    reason: 'settings_edit',
    request,
  });

  return NextResponse.json({ ok: true, key: result.key, value: result.after });
}

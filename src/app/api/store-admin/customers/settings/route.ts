import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { isCustomerSettingKey } from '@/lib/store-admin/customer-rules';
import {
  getCustomerSettings,
  updateCustomerSetting,
} from '@/lib/store-admin/customer-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getCustomerSettings();
  if (!result.ok) {
    return NextResponse.json({ error: 'Customer settings are not available.' }, { status: 503 });
  }
  return NextResponse.json(
    { settings: result.settings },
    { headers: { 'Cache-Control': 'no-store' } },
  );
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

  if (!isCustomerSettingKey(body.key)) {
    return NextResponse.json({ error: 'Unknown setting.' }, { status: 400 });
  }

  const result = await updateCustomerSetting(body.key, body.value, guard.session.adminId);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'customer.settings.update',
      entity: 'customer_settings',
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
    action: 'customer.settings.update',
    entity: 'customer_settings',
    entityId: result.key,
    before: { key: result.key, value: result.before },
    after: { key: result.key, value: result.after },
    reason: 'customer_settings_edit',
    request,
  });

  return NextResponse.json({ ok: true, key: result.key, value: result.after });
}

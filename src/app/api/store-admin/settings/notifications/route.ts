import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  listNotificationToggles,
  saveNotificationToggle,
} from '@/lib/store-admin/notification-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const result = await listNotificationToggles();
  if (!result.ok) {
    return NextResponse.json({ error: 'Notifications are not available.' }, { status: 503 });
  }
  return NextResponse.json(
    { toggles: result.toggles },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Toggle one channel × audience × topic cell. */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { id?: unknown; isActive?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await saveNotificationToggle({ id: body.id, isActive: body.isActive });
  if (!result.ok) {
    const status =
      result.reason === 'invalid-input' ? 400 : result.reason === 'not-found' ? 404 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'settings.notifications.toggle',
    entity: 'notification_channel_settings',
    entityId: result.toggle.id,
    reason: 'notification_matrix',
    after: { isActive: result.toggle.isActive },
    request,
  });

  return NextResponse.json({ toggle: result.toggle });
}

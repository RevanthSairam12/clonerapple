import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getStoreSettings, updateStoreSettings } from '@/lib/store-admin/settings';
import { isShippingMoneyKey, isShippingSetting, validateShippingRupees } from '@/lib/store-admin/settings-rules';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getStoreSettings();
  if (!result.ok) {
    return NextResponse.json({ error: 'Settings are not available.' }, { status: 503 });
  }
  return NextResponse.json(
    { settings: result.settings, shippingInitialized: result.shippingInitialized },
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

  // Canonical money writes require unit:'rupees'; GET returns stored paise.
  let body: { key?: unknown; value?: unknown; unit?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const values = Array.isArray(body.values)
    ? body.values.map((item) => ({
        key: (item as { key?: unknown })?.key,
        value: (item as { value?: unknown })?.value,
        unit: (item as { unit?: unknown })?.unit,
      }))
    : [{ key: body.key, value: body.value, unit: body.unit }];

  for (const item of values) {
    if (!isShippingMoneyKey(item.key)) continue;
    if (item.unit !== 'rupees') {
      return NextResponse.json({ error: 'Shipping amounts require unit: rupees and a rupee text value.' }, { status: 400 });
    }
    const parsed = validateShippingRupees(item.key, item.value);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    item.value = parsed.value;
  }

  const result = await updateStoreSettings(
    values,
    guard.session.adminId,
    guard.session.role === 'store_owner',
    { actorEmail: guard.session.email, request },
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

  // Maintenance takes effect on the next request, not after a cache window.
  if (result.changes.some((change) => change.key.startsWith('maintenance_'))) {
    revalidatePath('/', 'layout');
    revalidatePath('/maintenance');
  }

  if (result.changes.some((change) => isShippingSetting(change.key))) {
    revalidatePath('/store-admin/settings/shipping');
    revalidatePath('/cart');
    revalidatePath('/bag');
    revalidatePath('/checkout');
  }

  for (const change of result.changes) {
    // Shipping already has a required audit row in the write transaction.
    if (isShippingSetting(change.key)) continue;
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

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';
import {
  applySalePrices,
  getStoreTimeZone,
  updateSaleSettings,
  type SaleBulkAction,
} from '@/lib/store-admin/sale';
import {
  parseSalePercent,
  validateSaleSettingsInput,
} from '@/lib/store-admin/sale-admin-rules';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

/**
 * Sale mode and bulk sale prices.
 *
 * Reads happen on the server-rendered sale page; these are the two write
 * paths. Both require store_admin, reject cross-origin requests and write an
 * audit row. Times arrive as store-local wall clocks and are converted by the
 * database, so the stored instant does not depend on the server's zone.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateSaleSettingsInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const timezone = await getStoreTimeZone();
  const result = await updateSaleSettings(
    validation.value,
    timezone,
    guard.session.adminId,
  );

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'sale.settings',
      entity: 'sale',
      entityId: 'default',
      status: 'denied',
      reason: result.reason,
      after: { ...validation.value, timezone },
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
    action: 'sale.settings',
    entity: 'sale',
    entityId: 'default',
    before: {
      enabled: result.data.before.enabled,
      startsAt: result.data.before.startsAt,
      endsAt: result.data.before.endsAt,
    },
    after: {
      enabled: result.data.after.enabled,
      startsAt: result.data.after.startsAt,
      endsAt: result.data.after.endsAt,
      timezone,
    },
    request,
  });

  revalidateCatalog();

  return NextResponse.json({
    ok: true,
    changed: result.data.changed,
    state: {
      enabled: result.data.after.enabled,
      startsAt: result.data.after.startsAt,
      endsAt: result.data.after.endsAt,
      status: result.data.after.status,
      live: result.data.after.live,
      databaseNow: result.data.after.databaseNow,
    },
    timezone,
  });
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  let action: SaleBulkAction;
  if (record.action === 'clear') {
    action = { action: 'clear' };
  } else if (record.action === 'percent') {
    const percent = parseSalePercent(record.percent);
    if (!percent.ok) {
      return NextResponse.json({ error: percent.error }, { status: 400 });
    }
    action = { action: 'percent', percent: percent.value };
  } else {
    return NextResponse.json(
      { error: 'Choose a bulk action: percent or clear.' },
      { status: 400 },
    );
  }

  const result = await applySalePrices(action, guard.session.adminId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'sale.bulk',
      entity: 'catalogue',
      entityId: 'sale-prices',
      status: 'denied',
      reason: result.reason,
      after: action,
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
    action: 'sale.bulk',
    entity: 'catalogue',
    entityId: 'sale-prices',
    before: { withSalePrice: result.data.beforeWithSalePrice },
    after: result.data,
    request,
  });

  revalidateCatalog();

  return NextResponse.json({ ok: true, ...result.data });
}

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  openShift,
  closeShift,
  getCurrentShift,
} from '@/lib/store-admin/pos';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getCurrentShift(guard.session.adminId);
  if (!result.ok) {
    return NextResponse.json({ error: 'Shifts are not available.' }, { status: 503 });
  }
  return NextResponse.json({ shift: result.shift ?? null });
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { openingFloatPaise?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const openingFloatPaise = typeof body.openingFloatPaise === 'number'
    ? body.openingFloatPaise
    : Number(body.openingFloatPaise);

  if (!Number.isFinite(openingFloatPaise) || openingFloatPaise < 0) {
    return NextResponse.json({ error: 'Enter a non-negative opening float.' }, { status: 400 });
  }

  const result = await openShift({
    staffId: guard.session.adminId,
    openingFloatPaise: Math.trunc(openingFloatPaise),
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'pos.shift.open',
      entity: 'pos_shifts',
      entityId: '',
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status = result.reason === 'shift-open' ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'pos.shift.open',
    entity: 'pos_shifts',
    entityId: String(result.shiftId),
    after: { openingFloatPaise: openingFloatPaise },
    request,
  });

  return NextResponse.json({ ok: true, shiftId: result.shiftId });
}

export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { countedCashPaise?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const countedCashPaise = typeof body.countedCashPaise === 'number'
    ? body.countedCashPaise
    : Number(body.countedCashPaise);

  if (!Number.isFinite(countedCashPaise) || countedCashPaise < 0) {
    return NextResponse.json({ error: 'Enter a non-negative counted cash.' }, { status: 400 });
  }

  const result = await closeShift({
    staffId: guard.session.adminId,
    countedCashPaise: Math.trunc(countedCashPaise),
    notes: typeof body.notes === 'string' ? body.notes : null,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'pos.shift.close',
      entity: 'pos_shifts',
      entityId: '',
      status: 'denied',
      reason: result.reason,
      request,
    });
    const status = result.reason === 'not-found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'pos.shift.close',
    entity: 'pos_shifts',
    entityId: String(result.shift.id),
    before: { openingFloatPaise: result.shift.openingFloatPaise },
    after: {
      expectedCashPaise: result.shift.expectedCashPaise,
      countedCashPaise: result.shift.countedCashPaise,
      variancePaise: result.shift.variancePaise,
    },
    request,
  });

  return NextResponse.json({ ok: true, shift: result.shift });
}

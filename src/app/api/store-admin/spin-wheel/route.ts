import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import {
  getSpinWheelAdminData,
  saveSpinWheelConfig,
} from '@/lib/store-admin/spin-wheel';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const result = await getSpinWheelAdminData();
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Spin wheel settings could not be loaded right now.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    ...result.data,
  });
}

export async function PUT(request: Request) {
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

  const actor = {
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    request,
  };

  const result = await saveSpinWheelConfig(body, actor);
  if (!result.ok) {
    if (result.reason === 'invalid-input') {
      await writeAudit({
        ...actor,
        action: 'spin_wheel.update',
        entity: 'spin_wheel',
        entityId: 'default',
        status: 'denied',
        reason: result.error.slice(0, 120),
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    ...result.data,
  });
}


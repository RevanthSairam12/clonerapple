import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import {
  createFreeGiftRule,
  getFreeGiftsAdminData,
} from '@/lib/store-admin/free-gifts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const result = await getFreeGiftsAdminData();
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Free gift settings could not be loaded right now.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    ...result.data,
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

  const actor = {
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    request,
  };

  const result = await createFreeGiftRule(body, actor);
  if (!result.ok) {
    if (result.reason === 'invalid-input') {
      await writeAudit({
        ...actor,
        action: 'free_gift.create',
        entity: 'free_gift_rule',
        entityId: 'new',
        status: 'denied',
        reason: result.error.slice(0, 120),
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json(
    { ok: true, ruleId: result.ruleId, ...result.data },
    { status: 201 },
  );
}


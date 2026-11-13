import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { updateFreeGiftRule } from '@/lib/store-admin/free-gifts';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
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

  const result = await updateFreeGiftRule(id, body, actor);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    if (result.reason === 'invalid-input') {
      await writeAudit({
        ...actor,
        action: 'free_gift.update',
        entity: 'free_gift_rule',
        entityId: id,
        status: 'denied',
        reason: result.error.slice(0, 120),
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({ ok: true, ...result.data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const actor = {
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    request,
  };

  const result = await updateFreeGiftRule(id, { action: 'archive' }, actor);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({ ok: true, ...result.data });
}


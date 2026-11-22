import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { checkDistributedRateLimits } from '@/lib/platform/distributed-rate-limit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  isOrderRevealField,
  revealOrderField,
} from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

const REVEAL_WINDOW_MS = 10 * 60 * 1000;
const REVEAL_ACTOR_LIMIT = 20;
const REVEAL_IP_LIMIT = 40;

export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { field?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const field = body.field;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!isOrderRevealField(field) || reason.length < 10 || reason.length > 200) {
    return NextResponse.json({ error: 'A valid field and a 10-200 character reason are required.' }, { status: 400 });
  }

  const { txnid } = await context.params;
  const ip = clientIpFromRequest(request);
  const revealLimit = await checkDistributedRateLimits([
    { scope: 'store_reveal_actor', key: guard.session.adminId, limit: REVEAL_ACTOR_LIMIT, windowMs: REVEAL_WINDOW_MS },
    ...(ip
      ? [{ scope: 'store_reveal_ip', key: ip, limit: REVEAL_IP_LIMIT, windowMs: REVEAL_WINDOW_MS }]
      : []),
  ]);

  if (!revealLimit.allowed) {
    const retryAfterSec = Math.max(1, revealLimit.retryAfterSec);
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.reveal',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: 'rate_limited',
      after: { field },
      request,
    });
    return NextResponse.json(
      { error: 'Too many reveal requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  const result = await revealOrderField(txnid, field);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'order.reveal',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { field },
      request,
    });
    return NextResponse.json({ error: result.reason === 'not-found' ? 'Order not found.' : 'Order field unavailable.' }, { status: result.reason === 'not-found' ? 404 : 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.reveal',
    entity: 'order',
    entityId: txnid,
    after: { field },
    reason,
    request,
  });
  return NextResponse.json({ ok: true, field, value: result.value });
}

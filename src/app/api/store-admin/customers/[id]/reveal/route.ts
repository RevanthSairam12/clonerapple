import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { isRevealField, revealCustomerField } from '@/lib/store-admin/customers';
import { checkDistributedRateLimits } from '@/lib/platform/distributed-rate-limit';
import { clientIpFromRequest } from '@/lib/platform/client-ip';

/**
 * POST /api/store-admin/customers/[id]/reveal
 *
 * Owner-only. Returns exactly one unmasked contact value for a customer and
 * records who saw which field and why. The value itself is never audited.
 *
 * Safeguards:
 * - `store_owner` role (admins and viewers are refused).
 * - Same-origin check on the mutation.
 * - A written reason is mandatory.
 * - Distributed PostgreSQL rate limits per actor and per client IP.
 */

export const dynamic = 'force-dynamic';

const REVEAL_REASON_MIN = 10;
const REVEAL_REASON_MAX = 200;
const REVEAL_WINDOW_MS = 10 * 60 * 1000;
const REVEAL_ACTOR_LIMIT = 20;
const REVEAL_IP_LIMIT = 40;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  let body: { field?: unknown; reason?: unknown; addressId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const field = body.field;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const addressId = typeof body.addressId === 'string' ? body.addressId.trim() : '';

  if (!isRevealField(field)) {
    return NextResponse.json(
      { error: 'Field must be "email", "phone" or "address".' },
      { status: 400 },
    );
  }
  if (field === 'address' && (!addressId || addressId.length > 100)) {
    return NextResponse.json(
      { error: 'An address id is required to reveal an address.' },
      { status: 400 },
    );
  }
  if (reason.length < REVEAL_REASON_MIN || reason.length > REVEAL_REASON_MAX) {
    return NextResponse.json(
      {
        error: `A reason of ${REVEAL_REASON_MIN}-${REVEAL_REASON_MAX} characters is required.`,
      },
      { status: 400 },
    );
  }

  // The actor bucket always applies; the IP bucket only when a trusted proxy
  // supplied an address (client-ip.ts). Without one a shared bucket would let a
  // single caller block every owner.
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
      action: 'customer.reveal',
      entity: 'customer',
      entityId: id,
      status: 'denied',
      reason: 'rate_limited',
      after: { field, ...(addressId ? { addressId } : {}) },
      request,
    });
    return NextResponse.json(
      { error: 'Too many reveal requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  const result = await revealCustomerField(id, field, addressId);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    if (result.reason === 'no-value') {
      return NextResponse.json(
        { error: 'This customer has no phone on record.' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: 'Customer records are not available.' },
      { status: 503 },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'customer.reveal',
    entity: 'customer',
    entityId: id,
    after: { field, ...(addressId ? { addressId } : {}) },
    reason,
    request,
  });

  return NextResponse.json({ ok: true, field, value: result.value });
}

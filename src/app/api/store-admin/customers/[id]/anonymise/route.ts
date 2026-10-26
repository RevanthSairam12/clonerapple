import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { anonymiseCustomer } from '@/lib/store-admin/customer-accounts';

export const dynamic = 'force-dynamic';

const CONFIRM_WORD = 'ANONYMISE';

/**
 * POST /api/store-admin/customers/[id]/anonymise
 *
 * Owner-only and deliberately blunt. The caller must send
 * `{ confirm: "ANONYMISE" }`, so an accidental click cannot erase an account.
 *
 * What is removed: name, phone, saved addresses, sessions, newsletter consent.
 * What stays: order rows (financial records) and internal staff notes.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  let body: { confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (body.confirm !== CONFIRM_WORD) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'customer.anonymise',
      entity: 'customer',
      entityId: id,
      status: 'denied',
      reason: 'confirmation_missing',
      request,
    });
    return NextResponse.json(
      { error: `Type ${CONFIRM_WORD} to confirm.` },
      { status: 400 },
    );
  }

  const result = await anonymiseCustomer(id);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    if (result.reason === 'conflict') {
      return NextResponse.json(
        { error: 'This account is already anonymised.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'The account could not be anonymised.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'customer.anonymise',
    entity: 'customer',
    entityId: id,
    before: { blocked: result.wasBlocked },
    after: {
      anonymised: true,
      addressesRemoved: result.addressesRemoved,
      sessionsRevoked: result.sessionsRevoked,
    },
    reason: 'gdpr_erasure_request',
    request,
  });

  return NextResponse.json({
    ok: true,
    addressesRemoved: result.addressesRemoved,
    sessionsRevoked: result.sessionsRevoked,
  });
}

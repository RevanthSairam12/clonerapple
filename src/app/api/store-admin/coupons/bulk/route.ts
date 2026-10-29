import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { parseCouponInput } from '@/lib/store-admin/coupon-rules';
import { bulkGenerateCoupons } from '@/lib/store-admin/coupons';

/**
 * Generate many single-use coupons from one template.
 *
 * Every generated coupon is capped at one use overall and one per customer.
 * The audit row records the count and template shape, never the list of codes
 * (the codes themselves are the currency; the response and CSV are where staff
 * collect them).
 */

export const dynamic = 'force-dynamic';

const MAX_PREFIX = 12;

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const count = Number(body.count);
  if (!Number.isFinite(count) || count < 1 || count > 500) {
    return NextResponse.json({ error: 'Generate between 1 and 500 codes.' }, { status: 400 });
  }

  const prefix = typeof body.prefix === 'string' ? body.prefix : 'GZ';
  if (prefix.replace(/[^A-Za-z0-9]/g, '').length > MAX_PREFIX) {
    return NextResponse.json(
      { error: `Keep the prefix to ${MAX_PREFIX} letters or digits.` },
      { status: 400 },
    );
  }

  const length = Number(body.length);
  // A fixed placeholder satisfies the code field; every generated coupon gets
  // its own generated code instead.
  const parsed = parseCouponInput({ ...body, code: 'BULK' });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await bulkGenerateCoupons(
    {
      count: Math.trunc(count),
      prefix,
      length: Number.isFinite(length) ? length : 8,
      values: parsed.values,
    },
    guard.session.adminId,
  );

  if (!result.ok) {
    if (result.reason === 'invalid-input' || result.reason === 'conflict') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: 'The coupons could not be generated.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'coupon.bulk_generate',
    entity: 'coupon',
    entityId: 'bulk',
    after: {
      count: result.data.codes.length,
      prefix,
      type: parsed.values.type,
      value: parsed.values.value,
      scope: parsed.values.scope,
      perCustomerLimit: 1,
      totalRedemptionLimit: 1,
    },
    reason: 'staff_bulk_generation',
    request,
  });

  return NextResponse.json(
    { codes: result.data.codes, ids: result.data.ids },
    { status: 201 },
  );
}

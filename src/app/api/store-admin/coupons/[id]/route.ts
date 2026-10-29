import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { couponAuditFromRow, parseCouponInput } from '@/lib/store-admin/coupon-rules';
import { getCoupon, updateCoupon } from '@/lib/store-admin/coupons';

/**
 * One coupon: detail with usage (any store role) and edits (store_admin+).
 *
 * There is no DELETE. Archiving is the only retirement path, so a code that
 * has ever been redeemed keeps its permanent usage record.
 */

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Props) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await getCoupon(id);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ error: 'Coupons are not available.' }, { status: 503 });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request, { params }: Props) {
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

  const parsed = parseCouponInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateCoupon(id, parsed.values, guard.session.adminId);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    if (result.reason === 'conflict' || result.reason === 'invalid-input') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: 'The coupon could not be saved.' }, { status: 503 });
  }

  const { before, after } = result.data;
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'coupon.update',
    entity: 'coupon',
    entityId: after.id,
    before: couponAuditFromRow(before),
    after: couponAuditFromRow(after),
    reason: 'staff_edited',
    request,
  });

  return NextResponse.json({ coupon: after });
}

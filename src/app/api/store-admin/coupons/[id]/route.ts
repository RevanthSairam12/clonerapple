import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { couponAuditFromRow, parseCouponInput } from '@/lib/store-admin/coupon-rules';
import { archiveCouponOnDelete, getCoupon, updateCoupon } from '@/lib/store-admin/coupons';

/**
 * One coupon: detail with usage (any store role), edits and DELETE
 * (store_admin+).
 *
 * DELETE never removes a row. A code with any redemption keeps its permanent
 * usage record and is refused with 409; an unused code is archived instead,
 * so the target list and audit trail survive too.
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

  const parsed = parseCouponInput(body, { preserveOmittedVisibility: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateCoupon(id, parsed.values, {
    actorId: guard.session.adminId, actorEmail: guard.session.email, request,
  });
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    if (result.reason === 'conflict' || result.reason === 'invalid-input') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: 'The coupon could not be saved.' }, { status: 503 });
  }

  return NextResponse.json({ coupon: result.data.after }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request, { params }: Props) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await archiveCouponOnDelete(id);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    if (result.reason === 'conflict') {
      return NextResponse.json(
        { error: result.error, code: 'coupon_in_use' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'The coupon could not be deleted.' }, { status: 503 });
  }

  const { before, after } = result.data;
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'coupon.archive',
    entity: 'coupon',
    entityId: after.id,
    before: couponAuditFromRow(before),
    after: couponAuditFromRow(after),
    reason: 'staff_deleted',
    request,
  });

  // 200 with the archived coupon: nothing was removed, the code was retired.
  return NextResponse.json(
    { coupon: after, archived: true, deleted: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

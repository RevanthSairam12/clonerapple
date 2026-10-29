import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { couponAuditFromRow } from '@/lib/store-admin/coupon-rules';
import { duplicateCoupon } from '@/lib/store-admin/coupons';

/**
 * Copy a coupon into a paused draft with a fresh generated code. The copy must
 * be reviewed and resumed before it can take a single order.
 */

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Props) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await duplicateCoupon(id, guard.session.adminId);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    if (result.reason === 'conflict' || result.reason === 'invalid-input') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: 'The coupon could not be duplicated.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'coupon.duplicate',
    entity: 'coupon',
    entityId: result.data.id,
    before: { sourceCouponId: id },
    after: couponAuditFromRow(result.data),
    reason: 'duplicated',
    request,
  });

  return NextResponse.json({ coupon: result.data }, { status: 201 });
}

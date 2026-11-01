import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { couponAuditFromRow } from '@/lib/store-admin/coupon-rules';
import { setCouponStatus, type CouponStatusAction } from '@/lib/store-admin/coupons';

/**
 * Pause, resume or archive a coupon. Archive is one-way: it is the retirement
 * path for a code that may have been used, so the record stays.
 */

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

const ACTIONS: readonly CouponStatusAction[] = ['pause', 'resume', 'archive'];

function isAction(value: unknown): value is CouponStatusAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export async function POST(request: Request, { params }: Props) {
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

  if (!isAction(body.action)) {
    return NextResponse.json(
      { error: 'Choose pause, resume or archive.' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await setCouponStatus(id, body.action);
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
    action: `coupon.${body.action}`,
    entity: 'coupon',
    entityId: after.id,
    before: couponAuditFromRow(before),
    after: couponAuditFromRow(after),
    reason: 'staff_status_change',
    request,
  });

  return NextResponse.json({ coupon: after });
}

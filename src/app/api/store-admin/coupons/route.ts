import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { couponAuditFromRow, parseCouponInput } from '@/lib/store-admin/coupon-rules';
import { createCoupon, listCoupons } from '@/lib/store-admin/coupons';
import { requireStoreRole } from '@/lib/store-admin/auth';

/**
 * Coupon list and creation.
 *
 * GET is any store role. POST is store_admin and above and is audited with the
 * rule settings only — the restricted email list is customer PII and is
 * recorded as a count.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageSize = Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10);

  const result = await listCoupons({
    search: url.searchParams.get('search') ?? '',
    status: url.searchParams.get('status') ?? 'all',
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'Coupons are not available.' }, { status: 503 });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}

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

  const parsed = parseCouponInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await createCoupon(parsed.values, guard.session.adminId);
  if (!result.ok) {
    if (result.reason === 'conflict' || result.reason === 'invalid-input') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ error: 'The coupon could not be saved.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'coupon.create',
    entity: 'coupon',
    entityId: result.data.id,
    after: couponAuditFromRow(result.data),
    reason: 'staff_created',
    request,
  });

  return NextResponse.json({ coupon: result.data }, { status: 201 });
}

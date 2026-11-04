import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { parseCouponVisibilityInput } from '@/lib/store-admin/coupon-rules';
import { setCouponsVisibility } from '@/lib/store-admin/coupons';

/** Selected-ID show/hide, separate from /bulk code generation. */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers });
  }
  const parsed = parseCouponVisibilityInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers });
  }
  const result = await setCouponsVisibility(parsed, {
    actorId: guard.session.adminId, actorEmail: guard.session.email, request,
  });
  if (!result.ok) {
    const status = result.reason === 'not-found' ? 404
      : result.reason === 'conflict' ? 409 : result.reason === 'invalid-input' ? 400 : 503;
    return NextResponse.json({ error: result.error }, { status, headers });
  }
  return NextResponse.json(result.data, { headers });
}

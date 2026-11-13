import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { runStaffTestSpin } from '@/lib/store-admin/spin-wheel';

export const dynamic = 'force-dynamic';

/**
 * Staff-only preview draw using the saved segment weights.
 * Writes zero spin rows, zero coupons, and sends zero notifications.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const outcome = await runStaffTestSpin();
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    result: outcome.result,
  });
}


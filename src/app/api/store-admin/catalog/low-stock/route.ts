import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { listLowStock } from '@/lib/store-admin/catalog';

/**
 * Products whose available stock has reached its threshold.
 *
 * Read-only: stock quantities are changed by receipts, sales and voids, each
 * of which records a stock movement. A free-form quantity editor without a
 * movement row would break that trail.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const limitParam = new URL(request.url).searchParams.get('limit');
  const parsed = Number(limitParam);
  const limit = Number.isInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : 100;

  const result = await listLowStock(limit);
  if (!result.ok) {
    return NextResponse.json({ error: 'Catalogue is not available.' }, { status: 503 });
  }
  return NextResponse.json(result.data);
}

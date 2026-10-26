import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { exportStockReport } from '@/lib/store-admin/catalog-transfer';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/**
 * Stock levels as CSV: `scope=low` mirrors the low-stock report, `scope=all`
 * is the full stocktake sheet.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const scope = params.get('scope') === 'all' ? 'all' : 'low';

  const result = await exportStockReport(scope);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${result.data.csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="stock-${scope}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

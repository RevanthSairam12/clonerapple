import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { exportCatalogue } from '@/lib/store-admin/catalog-transfer';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/**
 * The filtered catalogue as CSV, in the columns the importer accepts — export,
 * edit, re-import.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const statusParam = params.get('status') ?? '';
  const status = statusParam === 'active' || statusParam === 'inactive' ? statusParam : 'all';

  const result = await exportCatalogue({
    categoryId: params.get('category') || null,
    status,
    search: params.get('q') ?? '',
  });
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
      'content-disposition': `attachment; filename="catalog-${stamp}.csv"`,
      // The catalogue changes on every edit; never let a proxy cache it.
      'cache-control': 'no-store',
    },
  });
}

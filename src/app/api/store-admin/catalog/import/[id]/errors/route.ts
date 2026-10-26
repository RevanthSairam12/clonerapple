import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { toCsv } from '@/lib/store-admin/catalog-csv';
import { getImportReport } from '@/lib/store-admin/catalog-transfer';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** The per-row error report of one import, as a CSV download. */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getImportReport(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  const { filename, errors } = result.data;
  const csv = toCsv(
    ['row', 'column', 'message'],
    errors.map((error) => [String(error.rowNumber), error.column, error.message]),
  );
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-') || 'catalog';

  return new Response(`﻿${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${base}-import-errors.csv"`,
      'cache-control': 'no-store',
    },
  });
}

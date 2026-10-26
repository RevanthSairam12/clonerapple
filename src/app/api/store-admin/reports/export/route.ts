import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { getReport } from '@/lib/store-admin/reports';
import {
  isReportKey,
  parseReportFilters,
  reportCsv,
  reportDefinition,
} from '@/lib/store-admin/report-rules';

/**
 * GET /api/store-admin/reports/export?report=<key>&… — the same table as CSV.
 *
 * The CSV is built from the `ReportData` the page renders, so a download and a
 * screen for the same filters always hold the same numbers. Money is written in
 * rupees with two decimals; the row count and filter shape are audited, never
 * the rows themselves (customer reports are masked).
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const key = url.searchParams.get('report');
  if (!isReportKey(key)) {
    return NextResponse.json({ error: 'Choose a report to export.' }, { status: 400 });
  }

  const parsed = parseReportFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await getReport(key, parsed.filters);
  if (!result.ok) {
    return NextResponse.json({ error: 'That report is not available.' }, { status: 503 });
  }

  const { data } = result;
  const definition = reportDefinition(key);
  const csv = reportCsv(data);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'report.export',
    entity: 'report',
    entityId: key,
    after: {
      from: parsed.filters.fromDay,
      to: parsed.filters.toDay,
      group: parsed.filters.groupBy,
      status: parsed.filters.status,
      channel: parsed.filters.channel,
      rows: data.rows.length,
      truncated: data.truncated === true,
    },
    reason: 'csv_export',
    request,
  });

  const stamp = `${parsed.filters.fromDay}_${parsed.filters.toDay}`;
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gadzio-${definition.key}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

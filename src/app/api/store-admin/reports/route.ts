import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import {
  getReport,
} from '@/lib/store-admin/reports';
import {
  isReportKey,
  parseReportFilters,
  reportDefinition,
} from '@/lib/store-admin/report-rules';

/**
 * GET /api/store-admin/reports?report=<key>&… — one report as JSON.
 *
 * Read-only and available to every store role. The filters are parsed by the
 * same function the page uses, so the API and the screen cannot disagree about
 * the range or defaults.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const key = url.searchParams.get('report');
  if (!isReportKey(key)) {
    return NextResponse.json({ error: 'Choose a report to run.' }, { status: 400 });
  }

  const parsed = parseReportFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await getReport(key, parsed.filters);
  if (!result.ok) {
    return NextResponse.json({ error: 'That report is not available.' }, { status: 503 });
  }

  return NextResponse.json(
    {
      report: reportDefinition(key),
      filters: parsed.filters,
      data: result.data,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

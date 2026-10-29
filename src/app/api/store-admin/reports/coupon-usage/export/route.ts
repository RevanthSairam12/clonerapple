import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { toCsv } from '@/lib/store-admin/catalog-csv';
import { couponUsageReport } from '@/lib/store-admin/coupons';
import { parseReportFilters } from '@/lib/store-admin/report-rules';

/**
 * Coupon usage as CSV for the same range and code as the page.
 *
 * Customer emails are masked in the rows; the audit row records the filter
 * shape and row count only.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = parseReportFilters({
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
  const result = await couponUsageReport({
    fromDay: parsed.filters.fromDay,
    toDay: parsed.filters.toDay,
    code,
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'The report is not available.' }, { status: 503 });
  }

  const { rows, totals, truncated } = result.data;
  const csv = toCsv(
    ['Code', 'Order', 'Customer', 'Discount (INR)', 'Order total (INR)', 'State', 'Time'],
    rows.map((row) => [
      row.code,
      row.orderNumber,
      row.customer,
      row.discountDisplay.replace(/[^\d.-]/g, ''),
      row.orderTotalDisplay.replace(/[^\d.-]/g, ''),
      row.state,
      row.createdAt,
    ]),
  );

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'report.export',
    entity: 'report',
    entityId: 'coupon-usage',
    after: {
      from: parsed.filters.fromDay,
      to: parsed.filters.toDay,
      code: code || null,
      rows: rows.length,
      discountPaise: totals.discountPaise,
      revenuePaise: totals.revenuePaise,
      truncated,
    },
    reason: 'csv_export',
    request,
  });

  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gadzio-coupon-usage-${parsed.filters.fromDay}_${parsed.filters.toDay}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

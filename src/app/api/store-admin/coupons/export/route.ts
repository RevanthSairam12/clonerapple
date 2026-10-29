import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { toCsv } from '@/lib/store-admin/catalog-csv';
import { couponScopeLabel, couponValueLabel } from '@/lib/store-admin/coupon-rules';
import { listCoupons } from '@/lib/store-admin/coupons';

/**
 * The coupon list as CSV, for the same search and status filters as the page.
 * The row count is audited, never the rows.
 */

export const dynamic = 'force-dynamic';

function rupees(paise: number | null): string {
  return paise === null ? '' : (paise / 100).toFixed(2);
}

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const search = url.searchParams.get('search') ?? '';
  const status = url.searchParams.get('status') ?? 'all';

  const result = await listCoupons({ search, status, page: 1, pageSize: 2000 });
  if (!result.ok) {
    return NextResponse.json({ error: 'Coupons are not available.' }, { status: 503 });
  }

  const header = [
    'Code',
    'Name',
    'Type',
    'Value',
    'Scope',
    'Status',
    'Uses',
    'Total limit',
    'Per customer',
    'Minimum order (INR)',
    'Starts',
    'Ends',
    'Created',
  ];

  const rows = result.data.rows.map((row) => [
    row.code,
    row.name,
    row.type,
    couponValueLabel(row.type, row.value),
    couponScopeLabel(row.scope),
    row.badge.label,
    String(row.used),
    row.totalRedemptionLimit === null ? '' : String(row.totalRedemptionLimit),
    row.perCustomerLimit === null ? '' : String(row.perCustomerLimit),
    rupees(row.minOrderPaise),
    row.startsAt ?? '',
    row.endsAt ?? '',
    row.createdAt,
  ]);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'coupon.export',
    entity: 'coupon',
    entityId: 'list',
    after: { search, status, rows: rows.length, truncated: result.data.total > rows.length },
    reason: 'csv_export',
    request,
  });

  const csv = toCsv(header, rows);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gadzio-coupons.csv"',
      'Cache-Control': 'no-store',
    },
  });
}

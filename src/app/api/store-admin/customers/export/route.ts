import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { toCsv } from '@/lib/store-admin/catalog-csv';
import { parseCustomerFilters } from '@/lib/store-admin/customer-rules';
import { exportCustomers } from '@/lib/store-admin/customers';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'type',
  'name',
  'email',
  'phone',
  'joined',
  'orders',
  'paid_orders',
  'lifetime_value',
  'last_order',
  'status',
  'group',
];

/** GET /api/store-admin/customers/export — masked CSV of the filtered list. */
export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = parseCustomerFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await exportCustomers(parsed.filters);
  if (!result.ok) {
    return NextResponse.json({ error: 'Customer records are not available.' }, { status: 503 });
  }

  const { customers, truncated } = result.data;
  const csv = toCsv(
    COLUMNS,
    customers.map((customer) => [
      customer.kind,
      customer.name,
      customer.emailMasked,
      customer.phoneMasked,
      customer.joinedAt,
      String(customer.orderCount),
      String(customer.paidOrderCount),
      customer.lifetimeValue.toFixed(2),
      customer.lastOrderAt ?? '',
      customer.status,
      customer.group,
    ]),
  );

  // The export never carries a full contact value; the row count and filter
  // shape are audited, the addresses are not.
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'customer.export',
    entity: 'customer',
    after: {
      rows: customers.length,
      truncated,
      type: parsed.filters.type,
      status: parsed.filters.status,
      orders: parsed.filters.orders,
    },
    reason: 'masked_export',
    request,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

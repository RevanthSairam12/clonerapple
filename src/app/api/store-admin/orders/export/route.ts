import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { isDateOnly } from '@/lib/store-admin/delivery';
import { isOrderSort, isSaleState, listOrdersForExport } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Order CSV export.
 *
 * Customer values are masked exactly as they are in the list. A full email,
 * phone or address still requires the owner-only reveal route, so an export
 * cannot be used to bypass that gate. The export itself is audited with its
 * filters and row count, never with row contents.
 */
export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const rawState = url.searchParams.get('state');
  const rawChannel = url.searchParams.get('channel');
  const rawSort = url.searchParams.get('sort');
  const dateFrom = url.searchParams.get('dateFrom') || null;
  const dateTo = url.searchParams.get('dateTo') || null;

  if (rawState && rawState !== 'ALL' && !isSaleState(rawState)) {
    return Response.json({ error: 'Invalid order state.' }, { status: 400 });
  }
  if (rawChannel && !['all', 'web', 'pos'].includes(rawChannel)) {
    return Response.json({ error: 'Invalid order channel.' }, { status: 400 });
  }
  if (rawSort && !isOrderSort(rawSort)) {
    return Response.json({ error: 'Invalid order sort.' }, { status: 400 });
  }
  if ((dateFrom && !isDateOnly(dateFrom)) || (dateTo && !isDateOnly(dateTo))) {
    return Response.json({ error: 'Order dates must use YYYY-MM-DD.' }, { status: 400 });
  }

  const state = rawState && rawState !== 'ALL' && isSaleState(rawState) ? rawState : null;
  const channel = rawChannel === 'web' || rawChannel === 'pos' ? rawChannel : null;
  const sort = rawSort && isOrderSort(rawSort) ? rawSort : null;

  const result = await listOrdersForExport({
    query,
    state,
    channel,
    dateFrom,
    dateTo,
    sort,
    limit: 10_000,
  });

  if (!result.ok) {
    return Response.json({ error: 'Order records are not available.' }, { status: 503 });
  }

  const header = [
    'Transaction',
    'Placed at',
    'Sale state',
    'Payment status',
    'Fulfilment',
    'Channel',
    'Customer',
    'Email',
    'Phone',
    'Amount',
    'Currency',
    'Item lines',
  ];

  const lines = [header.map(csvCell).join(',')];
  for (const row of result.data) {
    lines.push(
      [
        row.txnid,
        row.createdAt,
        row.saleState,
        row.paymentStatus,
        row.fulfilmentStatus,
        row.channel,
        row.customerNameMasked,
        row.customerEmailMasked,
        row.customerPhoneMasked,
        (row.amountPaise / 100).toFixed(2),
        row.currency,
        row.itemLines,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.export',
    entity: 'order_export',
    status: 'ok',
    reason: 'order_csv_export',
    after: {
      filters: {
        query,
        state,
        channel,
        dateFrom,
        dateTo,
        sort,
      },
      rows: result.data.length,
      format: 'csv',
    },
    request,
  });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="gadzio-orders-${today}.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

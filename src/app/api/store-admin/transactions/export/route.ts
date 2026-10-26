import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { isRangeKey } from '@/lib/store-admin/analytics';
import {
  isTransactionChannel,
  listTransactionsForExport,
} from '@/lib/store-admin/transactions';

export const dynamic = 'force-dynamic';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Payment-level CSV export for the Overview → Transactions tab.
 *
 * The file carries no customer contact data — only the transaction reference,
 * channel, method and amount — so it can be shared with an accountant without a
 * reveal. The export and its filters are audited; row contents never are.
 */
export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawRange = url.searchParams.get('range');
  const rawChannel = url.searchParams.get('channel');
  const range = isRangeKey(rawRange) ? rawRange : '30d';
  const channel =
    rawChannel && isTransactionChannel(rawChannel) ? rawChannel : null;

  if (rawChannel && rawChannel !== 'all' && !channel) {
    return Response.json({ error: 'Invalid transaction channel.' }, { status: 400 });
  }

  const result = await listTransactionsForExport({ range, channel, limit: 10_000 });
  if (!result.ok) {
    return Response.json({ error: 'Transaction records are not available.' }, { status: 503 });
  }

  const header = [
    'Transaction',
    'Recorded at',
    'Channel',
    'Method',
    'Status',
    'Amount',
    'Currency',
    'Reference',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of result.data) {
    lines.push(
      [
        row.txnid,
        row.recordedAt,
        row.channel,
        row.method,
        row.status,
        (row.amountPaise / 100).toFixed(2),
        row.currency,
        row.reference,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'transaction.export',
    entity: 'transaction_export',
    status: 'ok',
    reason: 'transaction_csv_export',
    after: { filters: { range, channel }, rows: result.data.length, format: 'csv' },
    request,
  });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="gadzio-transactions-${today}.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

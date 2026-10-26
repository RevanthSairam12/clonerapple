import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { toCsv } from '@/lib/store-admin/catalog-csv';
import { isSubscriberStatus } from '@/lib/store-admin/subscribers';
import { listSubscriberEmails } from '@/lib/store-admin/subscribers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/store-admin/subscribers/export?status=subscribed
 *
 * Owner-only, because the CSV contains full email addresses. The action and
 * row count are audited; the addresses are never written to the audit row.
 */
export async function GET(request: Request) {
  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const requested = url.searchParams.get('status') ?? 'all';
  const status = isSubscriberStatus(requested) ? requested : 'all';

  const result = await listSubscriberEmails(status);
  if (!result.ok) {
    return NextResponse.json({ error: 'Subscribers are not available.' }, { status: 503 });
  }

  const rows = result.data;
  const csv = toCsv(
    ['email', 'source', 'subscribed_at', 'unsubscribed_at'],
    rows.map((row) => [row.email, row.source, row.subscribedAt, row.unsubscribedAt ?? '']),
  );

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'subscriber.export',
    entity: 'newsletter_subscriber',
    after: { rows: rows.length, status },
    reason: 'owner_full_email_export',
    request,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="subscribers-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

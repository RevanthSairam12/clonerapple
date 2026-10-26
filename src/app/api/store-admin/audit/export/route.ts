import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { exportAuditLog, parseAuditFilters } from '@/lib/store-admin/audit-log';
import { toCsv } from '@/lib/store-admin/catalog-csv';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'timestamp',
  'actor',
  'action',
  'entity',
  'entity_id',
  'status',
  'reason',
  'route',
  'before',
  'after',
  'ip_hash',
  'user_agent_hash',
];

function compact(value: unknown): string {
  if (value === null || value === undefined) return '';
  const json = JSON.stringify(value);
  return json.length > 2000 ? `${json.slice(0, 2000)}…` : json;
}

/** GET /api/store-admin/audit/export — the same rows as the screen, as CSV. */
export async function GET(request: Request) {
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = parseAuditFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await exportAuditLog(parsed.filters);
  if (!result.ok) {
    return NextResponse.json({ error: 'The audit log is not available.' }, { status: 503 });
  }

  const csv = toCsv(
    COLUMNS,
    result.data.rows.map((row) => [
      row.createdAt,
      row.actorEmail,
      row.action,
      row.entity,
      row.entityId,
      row.status,
      row.reason,
      row.route,
      compact(row.before),
      compact(row.after),
      row.ipHash ?? '',
      row.userAgentHash ?? '',
    ]),
  );

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'audit.export',
    entity: 'store_admin_audit',
    after: {
      rows: result.data.rows.length,
      truncated: result.data.truncated,
      from: parsed.filters.fromDay,
      to: parsed.filters.toDay,
    },
    reason: 'audit_export',
    request,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

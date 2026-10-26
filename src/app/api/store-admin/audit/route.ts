import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { listAuditFacets, listAuditLog, parseAuditFilters } from '@/lib/store-admin/audit-log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/store-admin/audit — paginated audit rows.
 *
 * Read-only for admins and owners. Viewers are refused: the log names staff
 * actions and, even masked, is not part of day-to-day read-only work.
 */
export async function GET(request: Request) {
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = parseAuditFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const [page, facets] = await Promise.all([
    listAuditLog(parsed.filters),
    listAuditFacets(),
  ]);

  if (!page.ok) {
    return NextResponse.json({ error: 'The audit log is not available.' }, { status: 503 });
  }

  return NextResponse.json(
    {
      page: page.data,
      filters: parsed.filters,
      facets: facets.ok ? facets.data : { actions: [], entities: [] },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

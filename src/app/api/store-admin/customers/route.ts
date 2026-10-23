import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { listCustomers } from '@/lib/store-admin/customers';

/**
 * Read-only customer list for the store admin.
 *
 * GET only. Emails and phones are masked by `listCustomers()`; no account or
 * session columns are selected.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';
  const parsedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);

  const result = await listCustomers({
    query,
    page: Number.isFinite(parsedPage) ? parsedPage : 1,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Customer records are not available.' },
      { status: 503 },
    );
  }

  return NextResponse.json(result.data);
}

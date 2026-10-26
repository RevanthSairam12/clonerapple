import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { parseCustomerFilters } from '@/lib/store-admin/customer-rules';
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
  const parsed = parseCustomerFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await listCustomers(parsed.filters);

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Customer records are not available.' },
      { status: 503 },
    );
  }

  return NextResponse.json(result.data);
}

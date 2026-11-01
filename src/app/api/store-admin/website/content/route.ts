import { NextResponse } from 'next/server';

import { getContentRaw } from '@/lib/content';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { listContentOverrides } from '@/lib/website/content-store';
import { COLLECTIONS } from '@/lib/website/collections';

export const dynamic = 'force-dynamic';

/**
 * GET /api/store-admin/website/content — every collection's current value plus
 * the saved-override metadata (which keys are edited, by whom, when).
 *
 * Reads are open to every store role; only the store owner may write.
 */
export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const overrides = await listContentOverrides();
  const values: Record<string, unknown> = {};
  for (const collection of COLLECTIONS) {
    values[collection.key] = await getContentRaw(collection.key);
  }

  return NextResponse.json(
    {
      values,
      overrides: overrides.ok ? overrides.data : [],
      // A database outage is reported rather than hidden: the editor then
      // disables saving instead of pretending an empty site is the truth.
      available: overrides.ok,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

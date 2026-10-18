import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { listCatalogOverview } from '@/lib/store-admin/catalog';

/**
 * Read-only catalogue list for the store admin.
 *
 * GET only: there is no create, price or stock write path. Price editing stays
 * locked until PayU reads prices from the database.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await listCatalogOverview();
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Catalogue is not available.' },
      { status: 503 },
    );
  }

  return NextResponse.json(result.data);
}

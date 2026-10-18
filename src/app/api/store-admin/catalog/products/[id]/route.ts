import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { getCatalogProduct } from '@/lib/store-admin/catalog';

/**
 * Read-only catalogue detail for the store admin.
 *
 * GET only. The price is returned for display; no write path exists.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await getCatalogProduct(id);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Catalogue is not available.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ product: result.data });
}

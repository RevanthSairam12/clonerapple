import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { getPosCatalog } from '@/lib/store-admin/pos';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await getPosCatalog();
  if (!result.ok) {
    return NextResponse.json({ error: 'Catalogue is not available.' }, { status: 503 });
  }
  return NextResponse.json({ products: result.products });
}

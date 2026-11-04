import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { CatalogStarterError, parseCatalogStarterRequest } from '@/lib/catalog/catalog-starter-rules';
import { previewCatalogStarterSetup, readCatalogStarterBody } from '@/lib/store-admin/catalog-starter-setup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const violation = assertSameOrigin(request);
  if (violation) return violation;
  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;
  try {
    const { selections } = parseCatalogStarterRequest(await readCatalogStarterBody(request));
    const preview = await previewCatalogStarterSetup(selections);
    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CatalogStarterError ? error.message : 'Catalogue starter preview is unavailable. Check metadata schema readiness before retrying.' },
      { status: error instanceof CatalogStarterError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

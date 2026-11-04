import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { CatalogStarterError, parseCatalogStarterRequest } from '@/lib/catalog/catalog-starter-rules';
import { applyCatalogStarterSetup, readCatalogStarterBody } from '@/lib/store-admin/catalog-starter-setup';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const violation = assertSameOrigin(request);
  if (violation) return violation;
  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;
  try {
    const { selections, fingerprint } = parseCatalogStarterRequest(await readCatalogStarterBody(request), true);
    const result = await applyCatalogStarterSetup(selections, fingerprint!, guard.session.adminId, request);
    // Cache failure cannot turn a committed, audited transaction into a claimed rollback.
    if (!result.noop) { try { revalidateCatalog(); } catch { /* fresh reads remain authoritative */ } }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CatalogStarterError ? error.message : 'Could not apply catalogue starter setup.' },
      { status: error instanceof CatalogStarterError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

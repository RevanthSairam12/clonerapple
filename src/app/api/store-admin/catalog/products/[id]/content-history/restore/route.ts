import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { ProductContentError, restoreProductContent } from '@/lib/store-admin/product-content';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(request);
  if (origin) return origin;
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'Select a content revision.' }, { status: 400 });
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => !['revisionId', 'expectedContentRevision', 'snapshot'].includes(key)) || typeof body.revisionId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.revisionId) ||
    (body.expectedContentRevision !== undefined && body.expectedContentRevision !== null && (typeof body.expectedContentRevision !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.expectedContentRevision))) ||
    (body.snapshot !== undefined && body.snapshot !== 'before' && body.snapshot !== 'after')) {
    return NextResponse.json({ error: 'Invalid content restore request.' }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const result = await restoreProductContent(id, body.revisionId, guard.session.adminId, {
      request, expectedRevision: body.expectedContentRevision as string | null | undefined, snapshot: body.snapshot as 'before' | 'after' | undefined,
    });
    // The transaction already committed: cache failure must not masquerade as rollback.
    try { revalidateCatalog(id); } catch { /* next read can refresh the committed content */ }
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ProductContentError ? error.message : 'Could not restore product content. No changes were committed.' },
      { status: error instanceof ProductContentError ? error.status : 503 });
  }
}

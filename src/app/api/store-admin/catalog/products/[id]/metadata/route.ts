import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { loadMetadataEditor, MetadataError, parseMetadataInput, updateProductMetadata } from '@/lib/store-admin/product-metadata';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try { return NextResponse.json(await loadMetadataEditor(id)); }
  catch (error) { return NextResponse.json({ error: error instanceof MetadataError ? error.message : 'Product metadata is not ready. Check the catalogue migration before retrying.' }, { status: error instanceof MetadataError ? 400 : 503 }); }
}

export async function PATCH(request: Request, context: Context) {
  const violation = assertSameOrigin(request);
  if (violation) return violation;
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  const { id } = await context.params;
  try {
    const metadata = parseMetadataInput(raw);
    const body = raw as Record<string, unknown>;
    const productPatch: { categoryId?: string; isActive?: boolean } = {};
    if ('categoryId' in body) {
      if (typeof body.categoryId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(body.categoryId)) throw new MetadataError('Select a valid category.');
      productPatch.categoryId = body.categoryId;
    }
    if ('isActive' in body) {
      if (typeof body.isActive !== 'boolean') throw new MetadataError('Publication must be true or false.');
      productPatch.isActive = body.isActive;
    }
    await updateProductMetadata(id, metadata, guard.session.adminId, request, productPatch);
    revalidateCatalog(id);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof MetadataError ? error.message : 'Could not save product metadata.' }, { status: error instanceof MetadataError ? 400 : 503 }); }
}

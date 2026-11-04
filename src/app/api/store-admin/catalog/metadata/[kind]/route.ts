import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { createMetadataReference, loadMetadataEditor, MetadataConflictError, saveMetadataReference } from '@/lib/store-admin/product-metadata';
import { MetadataError } from '@/lib/catalog/product-metadata-rules';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export const dynamic = 'force-dynamic';
const kinds = new Set(['types', 'brands', 'models', 'attributes']);
type Context = { params: Promise<{ kind: string }> };

export async function GET(_request: Request, context: Context) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;
  const { kind } = await context.params;
  if (!kinds.has(kind)) return NextResponse.json({ error: 'Unknown reference kind.' }, { status: 400 });
  try {
    requireServiceExport(loadMetadataEditor);
    return NextResponse.json(await loadMetadataEditor());
  } catch (error) {
    const validation = matchesErrorClass(error, MetadataError);
    return NextResponse.json({ error: validation ? error.message : 'Product metadata is not ready. Check the catalogue service before retrying.' }, { status: validation ? 400 : 503 });
  }
}

export async function PUT(request: Request, context: Context) {
  const violation = assertSameOrigin(request);
  if (violation) return violation;
  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;
  const { kind } = await context.params;
  if (!kinds.has(kind)) return NextResponse.json({ error: 'Unknown reference kind.' }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Send a reference object.' }, { status: 400 });
  try {
    requireServiceExport(saveMetadataReference);
    await saveMetadataReference(kind, body as Record<string, unknown>, guard.session.adminId, request);
    try { revalidateCatalog(); } catch { console.warn('[store-admin/catalog] reference saved; cache refresh failed'); }
    return NextResponse.json({ ok: true });
  } catch (error) { return referenceFailure(error); }
}

/** A stale dev module must not make the error handler throw a second error. */
function matchesErrorClass(error: unknown, candidate: unknown): error is Error {
  if (typeof candidate !== 'function') return false;
  try { return error instanceof candidate; }
  catch { return false; } // Non-constructable functions or incompatible Symbol.hasInstance.
}

function requireServiceExport(candidate: unknown): void {
  if (typeof candidate !== 'function') throw new Error('Metadata service export is unavailable.');
}

function referenceFailure(error: unknown) {
  const conflict = matchesErrorClass(error, MetadataConflictError);
  const validation = matchesErrorClass(error, MetadataError);
  return NextResponse.json({ error: conflict || validation ? error.message : 'Could not save product metadata references.' }, { status: conflict ? 409 : validation ? 400 : 503 });
}

export async function POST(request: Request, context: Context) {
  const violation = assertSameOrigin(request);
  if (violation) return violation;
  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;
  const { kind } = await context.params;
  if (kind !== 'brands' && kind !== 'models') return NextResponse.json({ error: 'Only device brands and models can be created here.' }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  try {
    requireServiceExport(createMetadataReference);
    const reference = await createMetadataReference(kind, body, guard.session.adminId, request);
    try { revalidateCatalog(); } catch { console.warn('[store-admin/catalog] reference saved; cache refresh failed'); }
    return NextResponse.json({ reference }, { status: 201 });
  } catch (error) { return referenceFailure(error); }
}

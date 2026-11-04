import { NextResponse } from 'next/server';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { ProductContentError, productContentHistory } from '@/lib/store-admin/product-content';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;
  try {
    const { id } = await context.params;
    return NextResponse.json(await productContentHistory(id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ProductContentError ? error.message : 'Could not load product content history.' },
      { status: error instanceof ProductContentError ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

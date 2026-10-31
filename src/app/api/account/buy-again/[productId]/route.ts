import { NextRequest, NextResponse } from 'next/server';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { getBuyAgainProduct } from '@/lib/account/orders';

export const dynamic = 'force-dynamic';

/**
 * Click-time re-check for a Buy again card: the current sale-aware price, the
 * current stock state, and proof the product is in this customer's own paid
 * order history. Owner-scoped through the session and the history join, so it
 * cannot be used to probe another customer's purchases.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const { productId } = await context.params;
  const product = await getBuyAgainProduct(auth.session.userId, productId);
  return product
    ? NextResponse.json({ product }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ error: 'That item is no longer available to reorder.' }, { status: 404 });
}
import { NextResponse } from 'next/server';

import { getFreshStorefrontRefs, getStorefrontRefs } from '@/lib/storefront/catalog';

/**
 * Public catalogue summary for client-side surfaces: site search, the bag
 * flyout and the checkout form's payable-line check. Read-only, no secrets —
 * it carries exactly what a category card renders.
 *
 * Never cached at the edge: the payload already has the sale switch applied,
 * so a shared cache would keep serving the pre-sale price after a sale starts
 * or ends. Ordinary summary reads retain catalogue caching; fresh=1 bypasses
 * it and refuses outage/static fallback for click-time purchase validation.
 */
export async function GET(request?: Request) {
  if (request && new URL(request.url).searchParams.get('fresh') === '1') {
    try {
      return NextResponse.json(await getFreshStorefrontRefs(), { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ error: 'Current catalogue pricing is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  const { products } = await getStorefrontRefs();

  return NextResponse.json(
    { products },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

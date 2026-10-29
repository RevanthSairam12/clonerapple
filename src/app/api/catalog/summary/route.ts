import { NextResponse } from 'next/server';

import { listStorefrontProductRefs } from '@/lib/catalog/storefront';

/**
 * Public catalogue summary for client-side surfaces: site search, the bag
 * flyout and the checkout form's payable-line check. Read-only, no secrets —
 * it carries exactly what a category card renders.
 *
 * Never cached at the edge: the payload already has the sale switch applied,
 * so a shared cache would keep serving the pre-sale price after a sale starts
 * or ends. The per-request React cache inside the read layer is the only
 * caching this route relies on.
 */
export async function GET() {
  const products = await listStorefrontProductRefs();

  return NextResponse.json(
    { products },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

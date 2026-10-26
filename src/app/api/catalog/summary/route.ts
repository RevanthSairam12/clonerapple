import { NextResponse } from 'next/server';

import { listStorefrontProductRefs } from '@/lib/catalog/storefront';

/**
 * Public catalogue summary for client-side surfaces: site search, the bag
 * flyout and the checkout form's payable-line check. Read-only, no secrets —
 * it carries exactly what a category card renders. Served with a short
 * s-maxage so the nav and search panels stay cheap but still pick up
 * back-office edits within a minute.
 */
export async function GET() {
  const products = await listStorefrontProductRefs();

  return NextResponse.json(
    { products },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}

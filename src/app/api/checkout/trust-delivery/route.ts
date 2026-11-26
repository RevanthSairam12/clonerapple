import { NextResponse } from 'next/server';

import { getPublicCheckoutTrustDelivery } from '@/lib/checkout/trust-delivery-server';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';

export const dynamic = 'force-dynamic';

/**
 * Public checkout trust review + delivery/dispatch announcement endpoint.
 *
 * Exposes only sanitized display fields (`trust`, `delivery`, `saleLive`) —
 * never review IDs, order IDs, customer emails, internal notes, or secrets.
 */
export async function GET() {
  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const payload = await getPublicCheckoutTrustDelivery();
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

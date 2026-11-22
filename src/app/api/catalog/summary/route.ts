import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { checkDistributedRateLimit } from '@/lib/platform/distributed-rate-limit';
import { getFreshStorefrontRefs, getStorefrontRefs } from '@/lib/storefront/catalog';

const FRESH_SUMMARY_IP_LIMIT = 20;
const FRESH_SUMMARY_WINDOW_MS = 60 * 1000;

/**
 * Public catalogue summary for client-side surfaces: site search, the bag
 * flyout and the checkout form's payable-line check. Read-only, no secrets —
 * it carries exactly what a category card renders.
 *
 * Never cached at the edge: the payload already has the sale switch applied,
 * so a shared cache would keep serving the pre-sale price after a sale starts
 * or ends. Ordinary summary reads retain catalogue caching; fresh=1 coalesces
 * concurrent reads behind a short micro-cache and distributed per-IP cap while
 * refusing outage/static fallback for click-time purchase validation.
 */
export async function GET(request?: Request) {
  if (request && new URL(request.url).searchParams.get('fresh') === '1') {
    const crossSite = assertSameOrigin(request);
    if (crossSite) return crossSite;

    const ip = clientIpFromRequest(request);
    if (ip) {
      const rate = await checkDistributedRateLimit({
        scope: 'catalog_summary_fresh_ip',
        key: ip,
        limit: FRESH_SUMMARY_IP_LIMIT,
        windowMs: FRESH_SUMMARY_WINDOW_MS,
      });
      if (!rate.allowed) {
        return NextResponse.json(
          { error: 'Too many fresh catalogue requests. Please try again shortly.' },
          {
            status: 429,
            headers: {
              'Cache-Control': 'no-store',
              'Retry-After': String(Math.max(1, rate.retryAfterSec)),
            },
          },
        );
      }
    }

    try {
      return NextResponse.json(await getFreshStorefrontRefs(), { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json(
        { error: 'Current catalogue pricing is unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
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

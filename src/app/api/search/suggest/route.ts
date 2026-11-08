import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { getStorefrontRefs } from '@/lib/storefront/catalog';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import {
  MAX_SEARCH_SUGGESTIONS,
  MIN_SUGGEST_QUERY_LENGTH,
  matchSearchSuggestions,
} from '@/lib/storefront/search-suggest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Typeahead search suggestions for the storefront header (`GET /api/search/suggest?q=...`).
 *
 * Security & performance guarantees:
 * - Same-origin checked and rate-limited per IP.
 * - Respects storefront maintenance mode.
 * - Uses the shared singleflight catalogue snapshot + live per-request sale state.
 * - Never cached across sale states (`Cache-Control: no-store`).
 * - Returns only public safe fields (`id`, `name`, `href`, `image`, `category`,
 *   `brand`, `pricePaise`, `priceDisplay`, `wasPriceDisplay`, `onSale`,
 *   `inStock`, `stockBlocked`): never cost, stock counts, or internal notes.
 */
export async function GET(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const ip = clientIpFromRequest(request);
  const limited = ip
    ? checkRateLimit(`search-suggest:${ip}`, {
        limit: 90,
        windowMs: 60_000,
      })
    : null;
  if (limited && !limited.allowed) {
    return NextResponse.json(
      { error: 'Too many search requests. Please wait a moment.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(limited.retryAfterSec),
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);

  if (q.length < MIN_SUGGEST_QUERY_LENGTH) {
    return NextResponse.json(
      { query: q, suggestions: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { products, saleLive } = await getStorefrontRefs();
  const suggestions = matchSearchSuggestions(products, q, saleLive, MAX_SEARCH_SUGGESTIONS);

  return NextResponse.json(
    {
      query: q,
      saleLive,
      suggestions,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

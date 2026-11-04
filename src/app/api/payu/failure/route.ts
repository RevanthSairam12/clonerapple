import { NextRequest } from 'next/server';

import { handlePayUCallback } from '@/lib/payu/callback-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `furl` — PayU sends the browser here after a failed payment.
 *
 * A missing `status` is treated as a failure for the decision only; the hash is
 * still verified against exactly what PayU sent.
 */
export async function POST(request: NextRequest) {
  return handlePayUCallback(request, { fallbackStatus: 'failure' });
}

export async function GET(request: NextRequest) {
  return handlePayUCallback(request, { fallbackStatus: 'failure' });
}

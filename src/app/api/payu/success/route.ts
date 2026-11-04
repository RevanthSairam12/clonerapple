import { NextRequest } from 'next/server';

import { handlePayUCallback } from '@/lib/payu/callback-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `surl` — PayU sends the browser here after a payment attempt.
 *
 * The handler is the same shared one used by `furl`, `curl` and the webhook;
 * it always answers with a 303 to a validated absolute URL.
 */
export async function POST(request: NextRequest) {
  return handlePayUCallback(request);
}

/** Some PayU flows return with a GET redirect instead of a form POST. */
export async function GET(request: NextRequest) {
  return handlePayUCallback(request);
}

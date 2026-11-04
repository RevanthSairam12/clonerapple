import { NextRequest } from 'next/server';

import { handlePayUCallback } from '@/lib/payu/callback-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `curl` — the customer closed or cancelled the PayU page.
 *
 * PayU normally sends `status=failure` with `unmappedstatus=userCancelled`;
 * both are supplied as fallbacks for flows that omit them. The fallbacks only
 * pick the result page: a verified capture still wins, so a customer who paid
 * and then reached this URL is shown the success page.
 */
export async function POST(request: NextRequest) {
  return handlePayUCallback(request, {
    fallbackStatus: 'failure',
    fallbackUnmapped: 'userCancelled',
  });
}

export async function GET(request: NextRequest) {
  return handlePayUCallback(request, {
    fallbackStatus: 'failure',
    fallbackUnmapped: 'userCancelled',
  });
}

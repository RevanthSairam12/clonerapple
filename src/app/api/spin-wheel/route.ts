import { NextRequest, NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { checkDistributedRateLimits } from '@/lib/platform/distributed-rate-limit';
import { getCustomerSpinState } from '@/lib/spin-wheel/store';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { getUserSession } from '@/lib/user-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SPIN_READ_IP_LIMIT = 60;
const SPIN_READ_USER_LIMIT = 40;
const SPIN_READ_WINDOW_MS = 60 * 1000;

export async function GET(request?: NextRequest) {
  if (request) {
    const crossSite = assertSameOrigin(request);
    if (crossSite) return crossSite;
  }

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const ip = request ? clientIpFromRequest(request) : '';
  const session = await getUserSession();

  const buckets = [
    ...(ip
      ? [{ scope: 'spin_wheel_read_ip', key: ip, limit: SPIN_READ_IP_LIMIT, windowMs: SPIN_READ_WINDOW_MS }]
      : []),
    ...(session?.userId
      ? [{ scope: 'spin_wheel_read_user', key: session.userId, limit: SPIN_READ_USER_LIMIT, windowMs: SPIN_READ_WINDOW_MS }]
      : []),
  ];

  if (buckets.length > 0) {
    const rate = await checkDistributedRateLimits(buckets);
    if (!rate.allowed) {
      return NextResponse.json(
        { available: false, error: 'Too many requests. Please wait a minute and try again.' },
        {
          status: 429,
          headers: { ...NO_STORE, 'Retry-After': String(Math.max(1, rate.retryAfterSec)) },
        },
      );
    }
  }

  const state = await getCustomerSpinState(session?.userId ?? null);

  return NextResponse.json(state, { headers: NO_STORE });
}

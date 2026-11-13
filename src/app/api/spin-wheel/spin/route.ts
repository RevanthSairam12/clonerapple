import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireAccountSessionApi } from '@/lib/account/auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { executeSpinDraw } from '@/lib/spin-wheel/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const ip = clientIpFromRequest(request);
  if (ip) {
    const ipRate = checkRateLimit(`spin-wheel-ip:${ip}`, {
      limit: 15,
      windowMs: 60 * 1000,
    });
    if (!ipRate.allowed) {
      return NextResponse.json(
        { ok: false, reason: 'busy', error: 'Too many spin requests. Please wait a minute and try again.' },
        { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipRate.retryAfterSec) } },
      );
    }
  }

  const userRate = checkRateLimit(`spin-wheel-user:${auth.session.userId}`, {
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!userRate.allowed) {
    return NextResponse.json(
      { ok: false, reason: 'busy', error: 'Too many spin requests. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(userRate.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  const termsAccepted = Boolean(
    body && typeof body === 'object' && (body as Record<string, unknown>).termsAccepted === true,
  );

  // Hash non-empty trusted proxy IP so raw IP addresses are never persisted.
  const ipHash = ip ? createHash('sha256').update(ip).digest('hex') : '';

  const outcome = await executeSpinDraw({
    userId: auth.session.userId,
    ipHash,
    termsAccepted,
  });

  if (outcome.ok) {
    return NextResponse.json(outcome, { status: 200, headers: NO_STORE });
  }

  const headers: Record<string, string> = { ...NO_STORE };
  if (outcome.retryAfterSec && outcome.retryAfterSec > 0) {
    headers['Retry-After'] = String(outcome.retryAfterSec);
  }

  let status = 400;
  if (outcome.reason === 'unauthorized') status = 401;
  else if (outcome.reason === 'account_too_new') status = 403;
  else if (
    outcome.reason === 'ip_limit'
    || outcome.reason === 'reward_cooldown'
    || outcome.reason === 'busy'
  ) {
    status = 429;
  } else if (outcome.reason === 'unavailable') status = 503;

  return NextResponse.json(outcome, { status, headers });
}


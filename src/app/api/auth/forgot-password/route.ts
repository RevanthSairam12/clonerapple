import { after, NextResponse } from 'next/server';

import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  requestPasswordReset,
} from '@/lib/auth/password-reset';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  let body: { email?: unknown } | null = null;
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    body = null;
  }

  const ip = clientIpFromRequest(request);
  const result = await requestPasswordReset({ email: body?.email, ip });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        headers: result.retryAfterSec
          ? { 'Retry-After': String(result.retryAfterSec), 'Cache-Control': 'no-store' }
          : { 'Cache-Control': 'no-store' },
      },
    );
  }

  try {
    after(async () => {
      await result.deferredWork().catch(() => {});
    });
  } catch {
    void result.deferredWork().catch(() => {});
  }

  return NextResponse.json(
    { ok: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}


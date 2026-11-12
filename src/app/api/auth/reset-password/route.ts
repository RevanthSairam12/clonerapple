import { NextResponse } from 'next/server';

import { resetCustomerPassword } from '@/lib/auth/password-reset';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  let body: {
    token?: unknown;
    password?: unknown;
    confirmPassword?: unknown;
  } | null = null;
  try {
    body = (await request.json()) as {
      token?: unknown;
      password?: unknown;
      confirmPassword?: unknown;
    };
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ip = clientIpFromRequest(request);
  const result = await resetCustomerPassword({
    token: body?.token,
    password: body?.password,
    confirmPassword: body?.confirmPassword,
    ip,
  });

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

  return NextResponse.json(
    { ok: true, redirectTo: result.redirectTo },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}


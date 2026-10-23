import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { signIn, userSessionCookie } from '@/lib/user-auth';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { normalizeEmail } from '@/lib/auth/validation';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const result = await signIn(email, password);
  if (!result.ok) {
    return NextResponse.json(
      // One message for every failure: wrong email, wrong password, malformed
      // address or over-length password are indistinguishable to the caller.
      { error: result.error },
      result.retryAfterSec
        ? { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
        : { status: 401 },
    );
  }

  const store = await cookies();
  store.set(userSessionCookie.name, result.token, userSessionCookie.options);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { login, sessionCookie } from '@/lib/admin/auth';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  let body: { email?: string; password?: string; totpCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim();
  const password = body.password ?? '';
  const totpCode = body.totpCode;
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (email.length > 254 || password.length > 200 || (totpCode && totpCode.length > 64)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 });
  }

  const result = await login(email, password, totpCode);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, codeRequired: result.codeRequired ?? false },
      result.retryAfterSec
        ? { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
        : { status: 401 },
    );
  }

  const store = await cookies();
  store.set(sessionCookie.name, result.token, sessionCookie.options);
  return NextResponse.json({ ok: true });
}

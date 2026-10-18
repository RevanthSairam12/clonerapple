import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { signIn, userSessionCookie } from '@/lib/user-auth';

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim();
  const password = body.password ?? '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (email.length > 254 || password.length > 200) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 });
  }

  const result = await signIn(email, password);
  if (!result.ok) {
    return NextResponse.json(
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

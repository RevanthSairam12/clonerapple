import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { signUp, userSessionCookie } from '@/lib/user-auth';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  validatePassword,
} from '@/lib/auth/validation';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  let body: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const firstName = normalizeName(body.firstName);
  const lastName = normalizeName(body.lastName);

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: 'Please enter a valid email address.' },
      { status: 400 },
    );
  }

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) {
    return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
  }

  const result = await signUp(email, password, firstName, lastName);
  if (!result.ok) {
    if (result.retryAfterSec) {
      return NextResponse.json(
        { error: result.error },
        {
          status: 429,
          headers: { 'Retry-After': String(result.retryAfterSec) },
        },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const store = await cookies();
  store.set(userSessionCookie.name, result.token, userSessionCookie.options);
  return NextResponse.json({ ok: true });
}

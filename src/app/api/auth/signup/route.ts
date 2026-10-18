import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { signUp, userSessionCookie } from '@/lib/user-auth';

export async function POST(request: Request) {
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

  const email = (body.email ?? '').trim();
  const password = body.password ?? '';
  const firstName = (body.firstName ?? '').trim();
  const lastName = (body.lastName ?? '').trim();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }
  if (email.length > 254 || password.length > 200) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters.' },
      { status: 400 },
    );
  }

  const result = await signUp(email, password, firstName, lastName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const store = await cookies();
  store.set(userSessionCookie.name, result.token, userSessionCookie.options);
  return NextResponse.json({ ok: true });
}

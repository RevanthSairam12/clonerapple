import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { userLogout, userSessionCookie } from '@/lib/user-auth';
import { assertSameOrigin } from '@/lib/admin/api-guard';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  await userLogout();
  const store = await cookies();
  store.delete(userSessionCookie.name);
  return NextResponse.json({ ok: true });
}

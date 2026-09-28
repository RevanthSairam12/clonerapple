import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { logout, sessionCookie } from '@/lib/admin/auth';

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  await logout();
  const store = await cookies();
  store.delete(sessionCookie.name);
  return NextResponse.json({ ok: true });
}

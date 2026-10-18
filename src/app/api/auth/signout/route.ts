import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { userLogout, userSessionCookie } from '@/lib/user-auth';

export async function POST() {
  await userLogout();
  const store = await cookies();
  store.delete(userSessionCookie.name);
  return NextResponse.json({ ok: true });
}

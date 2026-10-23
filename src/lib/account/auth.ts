import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getUserSession, type UserSession } from '@/lib/user-auth';

export async function requireAccountPageSession(returnTo: string): Promise<UserSession> {
  const session = await getUserSession();
  if (!session) redirect(`/auth?redirect=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function requireAccountSessionApi(): Promise<
  | { ok: true; session: UserSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getUserSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };
  }
  return { ok: true, session };
}

import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
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
  // Customer APIs are part of the storefront: while maintenance is on they
  // answer 503 and change nothing (addresses, profile, password, requests).
  const closed = await requireStorefrontOpen();
  if (closed) return { ok: false, response: closed };

  const session = await getUserSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };
  }
  return { ok: true, session };
}

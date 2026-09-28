import { NextResponse } from 'next/server';

import { getSession, type EditorSession } from './auth';

/**
 * Guard for /api/admin routes.
 *
 * - `requireEditor()` — session check; returns the session or a 401 response.
 * - `assertSameOrigin()` — CSRF defense. The admin cookie is SameSite=Lax,
 *   which already blocks cross-site POSTs from other origins, but Lax still
 *   allows top-level GET navigations, and older browsers treat Lax loosely.
 *   Checking Origin (falling back to Referer) closes the gap: a state-changing
 *   request whose Origin is not our own host is rejected with 403.
 */

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  // No Origin header (same-origin fetches sometimes omit it, e.g. curl or
  // same-host GET) — fall back to Referer.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer at all. Requests from a browser always carry one
  // of the two; a request with neither is non-browser (server-side tooling)
  // and cannot carry ambient cookie credentials in a CSRF attack.
  return true;
}

export function assertSameOrigin(request: Request): NextResponse | null {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  return null;
}

export async function requireEditor(): Promise<
  | { ok: true; email: string; userId: string; session: EditorSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true, email: session.email, userId: session.userId, session };
}

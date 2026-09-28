import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Edge-level gate for the admin panel.
 *
 * This is a fast pre-filter only, NOT the security boundary — the real
 * session check (against admin_sessions in Postgres) happens in the
 * (protected) layout and every /api/admin route. What this adds:
 *
 * - /admin pages without a session cookie redirect to /admin/login before any
 *   rendering work starts (the layout would redirect anyway; this is faster
 *   and hides the route's existence from unauthenticated crawlers).
 * - /api/admin mutations without a session cookie get an immediate 401,
 *   before rate limiting or DB work.
 * - Baseline security headers on every response.
 */

const SESSION_COOKIE = 'admin_session';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  let response: NextResponse | undefined;

  // Guard the admin UI. /admin/login is the entry point and stays public.
  if (pathname.startsWith('/admin') && pathname !== '/admin/login' && !hasSessionCookie) {
    const loginUrl = new URL('/admin/login', request.url);
    response = NextResponse.redirect(loginUrl);
  }

  // Guard mutating admin API calls — GETs (media serving) stay public.
  if (
    pathname.startsWith('/api/admin') &&
    request.method !== 'GET' &&
    request.method !== 'OPTIONS' &&
    !pathname.startsWith('/api/admin/auth/login') &&
    !hasSessionCookie
  ) {
    response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  response ??= NextResponse.next();

  // Baseline security headers for every response.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets; Next always still runs proxy for
    // _next/data routes even when excluded, keeping page data covered.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

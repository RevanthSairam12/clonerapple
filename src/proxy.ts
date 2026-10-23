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
const STORE_SESSION_COOKIE = 'store_admin_session';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const hasStoreSessionCookie = request.cookies.has(STORE_SESSION_COOKIE);

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

  // Guard the store admin UI. Login is the only public page in this segment.
  // Same fast-prefilter posture as /admin: the real check is in the protected
  // layout and in requireStoreRole() on every API route.
  if (
    pathname.startsWith('/store-admin') &&
    pathname !== '/store-admin/login' &&
    !hasStoreSessionCookie
  ) {
    const loginUrl = new URL('/store-admin/login', request.url);
    response = NextResponse.redirect(loginUrl);
  }

  // Guard mutating store-admin API calls. Login must stay reachable.
  if (
    pathname.startsWith('/api/store-admin') &&
    request.method !== 'GET' &&
    request.method !== 'OPTIONS' &&
    !pathname.startsWith('/api/store-admin/auth/login') &&
    !hasStoreSessionCookie
  ) {
    response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Baseline security headers for every response.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // PayU's hosted checkout is a multi-hop flow: the POST to /_payment is then
  // redirected across PayU's own hosts (payu.in, payubiz.in, payumoney.com).
  // form-action is re-checked on every hop, not just the URL the form names, so
  // the hosts are allowed as a family rather than as two literals — a literal
  // list blocked the redirect and the payment page never loaded.
  const payuHosts = 'https://*.payu.in https://payu.in https://*.payubiz.in https://*.payumoney.com';
  response.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' ${payuHosts}; form-action 'self' ${payuHosts}; frame-ancestors 'none';`
  );
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets; Next always still runs proxy for
    // _next/data routes even when excluded, keeping page data covered.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

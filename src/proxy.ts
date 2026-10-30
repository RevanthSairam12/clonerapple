import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  MAINTENANCE_RETRY_AFTER_SECONDS,
  getMaintenanceState,
  isBlockedPurchaseApi,
  isStorefrontPath,
  maintenanceMessage,
  shouldBlockPath,
  type MaintenanceState,
} from '@/lib/storefront/maintenance';
import { maintenanceView, renderMaintenanceDocument } from '@/lib/storefront/maintenance-view';

/**
 * Edge-level gate for the admin panel, and the maintenance gate for the
 * storefront.
 *
 * The admin checks are a fast pre-filter only, NOT the security boundary — the
 * real session check (against admin_sessions in Postgres) happens in the
 * (protected) layout and every /api/admin route. What this adds:
 *
 * - /admin pages without a session cookie redirect to /admin/login before any
 *   rendering work starts (the layout would redirect anyway; this is faster
 *   and hides the route's existence from unauthenticated crawlers).
 * - /api/admin mutations without a session cookie get an immediate 401,
 *   before rate limiting or DB work.
 *
 * The maintenance check answers 503 + Retry-After for customer pages and
 * purchase APIs while the owner has the storefront closed. It reads a decision
 * that is cached for a few seconds (see `src/lib/storefront/maintenance.ts`)
 * and fails open: an unreadable setting leaves the store up.
 *
 * Baseline security headers are applied to every response, including the
 * maintenance 503.
 */

const SESSION_COOKIE = 'admin_session';
const STORE_SESSION_COOKIE = 'store_admin_session';

/**
 * The 503 a blocked request receives.
 *
 * Customers get the maintenance page as HTML; an API caller gets the same
 * message as JSON so a fetch() does not try to parse a whole document. The
 * status and Retry-After are what stop a search engine from dropping the URL.
 */
function maintenanceResponse(pathname: string, state: MaintenanceState): NextResponse {
  const headers = new Headers({
    'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });

  if (pathname.startsWith('/api/')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new NextResponse(
      JSON.stringify({
        error: maintenanceMessage(state),
        code: 'maintenance',
        endsAt: state.endsAt,
      }),
      { status: 503, headers },
    );
  }

  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new NextResponse(renderMaintenanceDocument(maintenanceView(state)), {
    status: 503,
    headers,
  });
}

function applySecurityHeaders(response: NextResponse): NextResponse {
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Maintenance first: a closed store should not do any other work for a
  // customer request. Only paths that could conceivably be blocked trigger a
  // settings read — admin, callbacks and assets never do.
  if (isStorefrontPath(pathname) || isBlockedPurchaseApi(pathname)) {
    const state = await getMaintenanceState();
    if (shouldBlockPath(pathname, state.active)) {
      return applySecurityHeaders(maintenanceResponse(pathname, state));
    }
  }

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

  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    // Everything except static assets; Next always still runs proxy for
    // _next/data routes even when excluded, keeping page data covered.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

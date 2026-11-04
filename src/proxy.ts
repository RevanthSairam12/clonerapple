import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getStoreSessionForToken } from '@/lib/store-admin/auth';
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
 * Store Admin session gate and storefront maintenance gate. Legacy pages
 * redirect in next.config.ts; retired APIs answer 410 without a cookie gate.
 * The protected layout and requireStoreRole() remain the staff boundary.
 *
 * The maintenance check answers 503 + Retry-After for customer pages and
 * purchase APIs while the owner has the storefront closed. It reads a decision
 * that is cached for a few seconds (see `src/lib/storefront/maintenance.ts`)
 * and fails open: an unreadable setting leaves the store up.
 *
 * Baseline security headers are applied to every response, including the
 * maintenance 503.
 */

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

  const hasStoreSessionCookie = request.cookies.has(STORE_SESSION_COOKIE);
  let response = NextResponse.next();

  // Guard the store admin UI. Login is the only public page in this segment.
  // The real check is in the protected layout and in requireStoreRole() on
  // every API route.
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

  // Layouts may be reused during navigation. Recheck every staff page request
  // before rendering so neither reuse nor a forgotten page-level check bypasses the gate.
  if ((pathname === '/store-admin' || pathname.startsWith('/store-admin/')) && pathname !== '/store-admin/login') {
    const token = request.cookies.get(STORE_SESSION_COOKIE)?.value;
    const session = token ? await getStoreSessionForToken(token) : null;
    if (!session) {
      response = NextResponse.redirect(new URL('/store-admin/login?reason=account-unavailable', request.url));
    } else if (session.mustChangePassword && pathname !== '/store-admin/change-password') {
      response = NextResponse.redirect(new URL('/store-admin/change-password', request.url));
    }
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

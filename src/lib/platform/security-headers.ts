/**
 * Baseline security headers applied to every response by the proxy.
 *
 * The Content-Security-Policy is built here rather than inline so the
 * production/development difference is testable without starting Next.
 */

/**
 * PayU's hosted checkout is a multi-hop flow: the POST to /_payment is then
 * redirected across PayU's own hosts (payu.in, payubiz.in, payumoney.com).
 * form-action is re-checked on every hop, not just the URL the form names, so
 * the hosts are allowed as a family rather than as two literals — a literal
 * list blocked the redirect and the payment page never loaded.
 */
const PAYU_HOSTS = 'https://*.payu.in https://payu.in https://*.payubiz.in https://*.payumoney.com';

export function contentSecurityPolicy(env: Pick<NodeJS.ProcessEnv, 'NODE_ENV'> = process.env): string {
  // A per-request nonce cannot cover the statically prerendered pages in this
  // app (a nonce only exists at request time, and those documents are built
  // ahead of time), so script-src keeps 'unsafe-inline'. 'unsafe-eval' is a
  // development-only need (React refresh/HMR) and is dropped in production.
  const scriptSrc = env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${PAYU_HOSTS}`,
    `form-action 'self' ${PAYU_HOSTS}`,
    "frame-ancestors 'none'",
    // No plugin content, and no <base> rewriting of relative URLs.
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ') + ';';
}

export function applySecurityHeaders<T extends { headers: Headers }>(response: T): T {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  response.headers.set('Content-Security-Policy', contentSecurityPolicy());
  return response;
}

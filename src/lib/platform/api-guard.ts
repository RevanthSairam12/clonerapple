import { NextResponse } from 'next/server';

import { trustProxy } from './client-ip';

/**
 * Hardened CSRF / Same-Origin guard for Store Admin, Customer Account, Auth,
 * and Checkout API routes (SEC-010).
 *
 * Defenses layered together:
 * 1. Fetch Metadata (`Sec-Fetch-Site`): blocks `'cross-site'` requests on all
 *    methods and restricts browser state-changing methods to `'same-origin'`.
 * 2. Host normalization + gated `X-Forwarded-Host`: `X-Forwarded-Host` is only
 *    consulted when `TRUST_PROXY` is enabled (or outside production) so callers
 *    cannot spoof allowed target hosts directly against origin hosts.
 * 3. Strict `Origin` / `Referer` validation (rejects `Origin: null`, malformed
 *    URLs, non-HTTP(S) schemes, host mismatches, and HTTPS->HTTP downgrades).
 * 4. Cookie-authenticated mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`
 *    carrying a `Cookie` header) with BOTH `Origin` and `Referer` absent are
 *    rejected unless `Sec-Fetch-Site: same-origin` is explicitly present.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function runtimeEnv(env?: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env) return env;
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

function firstToken(value: string | null): string {
  return value?.split(',')[0]?.trim().toLowerCase() ?? '';
}

function candidateHosts(request: Request, env: Record<string, string | undefined>): Set<string> {
  const hosts = new Set<string>();
  try {
    const parsedHost = new URL(request.url).host.trim().toLowerCase();
    if (parsedHost) hosts.add(parsedHost);
  } catch {
    // Malformed request.url contributes no host.
  }

  const directHost = firstToken(request.headers.get('host'));
  if (directHost) hosts.add(directHost);

  const allowForwarded = trustProxy(env) || env.NODE_ENV !== 'production';
  if (allowForwarded) {
    const forwardedHost = firstToken(request.headers.get('x-forwarded-host'));
    if (forwardedHost) hosts.add(forwardedHost);
  }

  return hosts;
}

function requestExpectsHttps(request: Request, env: Record<string, string | undefined>): boolean {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch {
    // ignore malformed URL
  }
  const allowForwarded = trustProxy(env) || env.NODE_ENV !== 'production';
  return allowForwarded && firstToken(request.headers.get('x-forwarded-proto')) === 'https';
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.host) return null;
    return parsed;
  } catch {
    return null;
  }
}

function matchesExpectedOrigin(
  parsed: URL | null,
  hosts: Set<string>,
  requireHttps: boolean,
): boolean {
  if (!parsed) return false;
  if (requireHttps && parsed.protocol !== 'https:') return false;
  return hosts.has(parsed.host.trim().toLowerCase());
}

function sameOrigin(request: Request, env: Record<string, string | undefined>): boolean {
  const method = (request.method || 'GET').toUpperCase();
  const isSafe = SAFE_METHODS.has(method);
  const isMutating = MUTATING_METHODS.has(method);

  const secFetchSiteRaw = request.headers.get('sec-fetch-site');
  const secFetchSite = secFetchSiteRaw === null ? '' : secFetchSiteRaw.trim().toLowerCase();

  // 1. Fetch Metadata enforcement
  if (secFetchSite === 'cross-site') {
    return false;
  }
  if (isMutating && secFetchSite !== '' && secFetchSite !== 'same-origin') {
    return false;
  }

  const hosts = candidateHosts(request, env);
  const requireHttps = requestExpectsHttps(request, env);

  // 2. Origin check (present header even if empty or 'null' must be valid & same-origin)
  if (request.headers.has('origin')) {
    const origin = (request.headers.get('origin') ?? '').trim();
    if (!origin || origin.toLowerCase() === 'null') return false;
    return matchesExpectedOrigin(parseHttpUrl(origin), hosts, requireHttps);
  }

  // 3. Referer fallback
  if (request.headers.has('referer')) {
    const referer = (request.headers.get('referer') ?? '').trim();
    if (!referer) return false;
    return matchesExpectedOrigin(parseHttpUrl(referer), hosts, requireHttps);
  }

  // 4. Both Origin and Referer are absent
  if (isSafe) {
    return true;
  }

  // Cookie-authenticated state changes with no Origin/Referer must carry Sec-Fetch-Site: same-origin.
  const hasCookie = Boolean((request.headers.get('cookie') ?? '').trim());
  if (hasCookie) {
    return secFetchSite === 'same-origin';
  }

  return true;
}

export function assertSameOrigin(
  request: Request,
  env?: Record<string, string | undefined>,
): NextResponse | null {
  if (!sameOrigin(request, runtimeEnv(env))) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  return null;
}

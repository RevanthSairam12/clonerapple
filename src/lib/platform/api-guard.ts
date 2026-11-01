import { NextResponse } from 'next/server';

/**
 * Same-origin guard for every mutating admin API (Store Admin, and the legacy
 * panel until it is removed).
 *
 * The staff cookie is SameSite=Lax, which already blocks cross-site POSTs from
 * other origins, but Lax still allows top-level GET navigations, and older
 * browsers treat Lax loosely. Checking Origin (falling back to Referer) closes
 * the gap: a state-changing request whose Origin is not our own host is
 * rejected with 403.
 */

/**
 * Every host this request may legitimately have been addressed as.
 *
 * Behind a tunnel or any reverse proxy, the browser's `Origin` names the
 * public hostname while Next can build `request.url` from its own listen
 * address. Comparing against `request.url` alone therefore rejects every
 * same-origin request that arrives through the proxy — the browser sees
 * "Cross-origin request rejected." on ordinary pages. `Host` carries what the
 * browser actually requested (cloudflared and ngrok preserve it), and a proxy
 * that rewrites `Host` puts the original in `X-Forwarded-Host`.
 *
 * A cross-site request cannot exploit this: the browser sets `Origin` itself,
 * so an attacker's page still presents its own host, which matches none of
 * these.
 */
function candidateHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(request.url).host);
  } catch {
    // A malformed url simply contributes no candidate.
  }
  for (const header of ['host', 'x-forwarded-host']) {
    const value = request.headers.get(header)?.split(',')[0]?.trim();
    if (value) hosts.add(value);
  }
  return hosts;
}

function sameOrigin(request: Request): boolean {
  const hosts = candidateHosts(request);
  const hostOf = (value: string): string | null => {
    try {
      return new URL(value).host;
    } catch {
      return null;
    }
  };

  const origin = request.headers.get('origin');
  if (origin) {
    const host = hostOf(origin);
    return host !== null && hosts.has(host);
  }
  // No Origin header (same-origin fetches sometimes omit it, e.g. curl or
  // same-host GET) — fall back to Referer.
  const referer = request.headers.get('referer');
  if (referer) {
    const host = hostOf(referer);
    return host !== null && hosts.has(host);
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

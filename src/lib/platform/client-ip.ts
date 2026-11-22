import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { headers } from 'next/headers';

/**
 * Trusted client IP extraction (SEC-004).
 *
 * Security model:
 * - X-Forwarded-For and CF-Connecting-IP are caller-controlled unless set or
 *   authenticated by a trusted reverse proxy in front of Node.
 * - Without `TRUST_PROXY=1|true|yes|on`, forwarded headers are ignored and ''
 *   is returned so callers skip per-IP buckets rather than sharing one global
 *   bucket (or letting attackers rotate headers to bypass limits).
 * - Under Vercel (`TRUST_PROXY=1`), client-supplied X-Forwarded-For entries
 *   sit on the LEFT while Vercel appends/sets the true connecting IP on the
 *   RIGHT (`x-vercel-forwarded-for`, `x-real-ip`, or rightmost `x-forwarded-for`).
 *   Reading leftmost lets any caller bypass rate limits via `X-Forwarded-For: 1.2.3.4`.
 * - Behind Cloudflare -> Vercel, `CF-Connecting-IP` MUST NOT be trusted unless
 *   `TRUST_PROXY_CHAIN=cloudflare` (or `cloudflare-vercel`) AND the deployment
 *   authenticates Cloudflare requests using `CLOUDFLARE_ORIGIN_SECRET` against
 *   `X-CF-Origin-Secret` (otherwise direct hits to `*.vercel.app` can forge `CF-Connecting-IP`).
 */

const MAX_IP_TOKEN_LENGTH = 64;
const DEFAULT_TRUST_PROXY_HOPS = 1;
const MAX_TRUST_PROXY_HOPS = 5;

function runtimeEnv(
  env?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (env) return env;
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

export function trustProxy(env?: Record<string, string | undefined>): boolean {
  const value = (runtimeEnv(env).TRUST_PROXY ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function parseTrustProxyHops(env?: Record<string, string | undefined>): number {
  const raw = (runtimeEnv(env).TRUST_PROXY_HOPS ?? '').trim();
  if (!raw) return DEFAULT_TRUST_PROXY_HOPS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TRUST_PROXY_HOPS;
  return Math.min(MAX_TRUST_PROXY_HOPS, parsed);
}

function isCloudflareChainEnabled(env: Record<string, string | undefined>): boolean {
  const chain = (env.TRUST_PROXY_CHAIN ?? '').trim().toLowerCase();
  return chain === 'cloudflare' || chain === 'cloudflare-vercel';
}

function hasVerifiedCloudflareOrigin(
  h: Headers,
  env: Record<string, string | undefined>,
): boolean {
  const expected = (env.CLOUDFLARE_ORIGIN_SECRET ?? '').trim();
  if (!expected) return false;
  const provided = (h.get('x-cf-origin-secret') ?? '').trim();
  if (!provided) return false;

  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

/**
 * Normalize and validate a candidate IP address string. Returns '' for empty,
 * malformed, or oversized tokens. Strips optional port suffixes and `::ffff:`
 * IPv4-mapped prefixes and lowercases valid IPv6 addresses.
 */
export function normalizeClientIp(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  let candidate = raw.trim();
  if (!candidate || candidate.length > MAX_IP_TOKEN_LENGTH) return '';
  if (/[\s\u0000-\u001f\u007f]/.test(candidate)) return '';

  // Bracketed IPv6 with optional :port, e.g. `[2001:db8::1]:443`
  if (candidate.startsWith('[')) {
    const close = candidate.indexOf(']');
    if (close === -1) return '';
    const host = candidate.slice(1, close);
    const rest = candidate.slice(close + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return '';
    candidate = host;
  } else {
    // Unbracketed IPv4:port, e.g. `203.0.113.9:12345`
    const firstColon = candidate.indexOf(':');
    const lastColon = candidate.lastIndexOf(':');
    if (firstColon !== -1 && firstColon === lastColon) {
      const host = candidate.slice(0, firstColon);
      const port = candidate.slice(firstColon + 1);
      if (!/^\d{1,5}$/.test(port) || isIP(host) !== 4) return '';
      candidate = host;
    }
  }

  // Strip IPv4-mapped IPv6 prefix (`::ffff:203.0.113.9` -> `203.0.113.9`)
  if (/^::ffff:/i.test(candidate)) {
    const mapped = candidate.slice(7);
    if (isIP(mapped) === 4) {
      return mapped;
    }
  }

  const kind = isIP(candidate);
  if (kind === 4) return candidate;
  if (kind === 6) return candidate.toLowerCase();
  return '';
}

function rightmostForwardedIp(headerValue: string | null, hopsFromRight = 1): string {
  if (!headerValue) return '';
  const tokens = headerValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length < hopsFromRight) return '';
  return normalizeClientIp(tokens[tokens.length - hopsFromRight]);
}

/** The real client address, or '' when no trusted proxy is declared or valid IP exists. */
export function clientIpFromHeaders(
  h: Headers,
  env?: Record<string, string | undefined>,
): string {
  const resolved = runtimeEnv(env);
  if (!trustProxy(resolved)) return '';

  // 1. Authenticated Cloudflare -> origin edge only (never blind-trust CF-Connecting-IP).
  if (isCloudflareChainEnabled(resolved) && hasVerifiedCloudflareOrigin(h, resolved)) {
    const cfIp = normalizeClientIp(h.get('cf-connecting-ip'));
    if (cfIp) return cfIp;
  }

  // 2. Vercel edge-overwritten forwarding headers (when on Vercel).
  const vercelIp = rightmostForwardedIp(h.get('x-vercel-forwarded-for'), 1);
  if (vercelIp) return vercelIp;

  // 3. Proxy-overwritten single-value header.
  const realIp = normalizeClientIp(h.get('x-real-ip'));
  if (realIp) return realIp;

  // 4. Rightmost trusted hop from X-Forwarded-For (ignore caller-prepended left hops).
  const hops = parseTrustProxyHops(resolved);
  return rightmostForwardedIp(h.get('x-forwarded-for'), hops);
}

export function clientIpFromRequest(
  request: Request,
  env?: Record<string, string | undefined>,
): string {
  return clientIpFromHeaders(request.headers, env);
}

/** The current request's client address, or '' when no trusted proxy is declared. */
export async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

import { headers } from 'next/headers';

/**
 * X-Forwarded-For is client-controlled unless the request came through a proxy
 * that overwrites it. Trusting it unconditionally lets a caller put a fresh
 * address in every request and walk past a per-IP rate limit.
 *
 * TRUST_PROXY declares that this deployment sits behind such a proxy. Without
 * it the forwarded headers are ignored and callers get an empty string; every
 * caller must then skip its per-IP bucket rather than share one global bucket
 * (which would let one client lock everyone out). Per-account and per-email
 * limits are unaffected.
 */
export function trustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** The real client address, or '' when no trusted proxy is declared. */
export function clientIpFromHeaders(h: Headers, env: NodeJS.ProcessEnv = process.env): string {
  if (!trustProxy(env)) return '';
  return h.get('x-forwarded-for')?.split(',')[0]?.trim()
    || h.get('x-real-ip')?.trim()
    || '';
}

export function clientIpFromRequest(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  return clientIpFromHeaders(request.headers, env);
}

/** The current request's client address, or '' when no trusted proxy is declared. */
export async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

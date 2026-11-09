/**
 * Startup environment warnings.
 *
 * Pure and dependency-free on purpose: `src/instrumentation.ts` imports this
 * before the server serves a request, so nothing here may connect, await or
 * throw. Every message names a variable and never its value.
 *
 * The two variables:
 *
 * - `TRUST_PROXY` — "1", "true", "yes" or "on" declares that the process sits
 *   behind a reverse proxy that overwrites the forwarded client-address header.
 *   Without it the forwarded address is ignored and per-IP rate limits are
 *   skipped (per-agent and per-email limits still apply). Set it when a proxy
 *   does overwrite the header; leave it unset when clients reach the process
 *   directly, otherwise a caller could forge the address.
 *
 * The header name itself is deliberately not spelled here: the L-6 test asserts
 * that `client-ip.ts` is the only file in `src/` that names it.
 * - `MAIL_ALLOWED_HOSTS` — a comma-separated allow-list of SMTP host names.
 *   Unset means the configured `mail_host` is trusted. Set means an owner
 *   cannot repoint delivery at another host and receive the SMTP password.
 *
 * A warning is advisory only. Nothing in this module changes behaviour.
 */

/** The same acceptance set `trustProxy()` in `client-ip.ts` uses. */
function trustProxyDeclared(env: NodeJS.ProcessEnv): boolean {
  const value = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** True when `TRUST_PROXY` is set but holds a value nothing recognises. */
function trustProxyUnrecognised(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.TRUST_PROXY ?? '').trim();
  return raw !== '' && !trustProxyDeclared(env);
}

/**
 * Warnings for a server start. Order is stable so a log diff is readable.
 *
 * The mail warning fires on `MAIL_ALLOWED_HOSTS` alone because the mail driver
 * lives in the `store_settings` table and reading it here would mean a database
 * query before the server is ready to serve. The precise, driver-aware warning
 * lives in `mailConfigProblem()` (`src/lib/notifications/providers.ts`), which
 * already has the settings in hand.
 */
const TUNNEL_SUFFIXES = [
  '.trycloudflare.com',
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.io',
  '.ngrok.app',
  '.loca.lt',
  '.localtunnel.me',
  '.ts.net',
];

function isTunnelHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.+$/, '');
  return TUNNEL_SUFFIXES.some((s) => h === s.slice(1) || h.endsWith(s));
}

function appBaseUrlWarning(env: NodeJS.ProcessEnv): string | null {
  const payuMode = (env.PAYU_ENV ?? '').trim().toLowerCase();
  const isProdPayU = payuMode === 'live' || payuMode === 'production';
  const raw = (env.APP_BASE_URL ?? '').trim();

  if (!raw) {
    if (isProdPayU) {
      return 'APP_BASE_URL is not set while PAYU_ENV is in production mode. Set APP_BASE_URL to the store’s public HTTPS origin so PayU callbacks can return.';
    }
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'APP_BASE_URL is not a valid URL. Set APP_BASE_URL to the public HTTPS origin of this store.';
  }

  if (parsed.protocol !== 'https:') {
    return 'APP_BASE_URL does not use HTTPS. Production checkouts and PayU callbacks require a public HTTPS origin.';
  }

  if (isTunnelHost(parsed.hostname)) {
    return isProdPayU
      ? 'APP_BASE_URL points to a temporary tunnel host while PAYU_ENV is in production mode. Payments are refused until APP_BASE_URL uses a permanent HTTPS domain.'
      : 'APP_BASE_URL points to a temporary tunnel host. Replace it with a permanent HTTPS domain before enabling production payments.';
  }

  return null;
}

export function startupWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  const production = env.NODE_ENV === 'production';

  if (!production) return warnings;

  if (trustProxyUnrecognised(env)) {
    warnings.push(
      'TRUST_PROXY is set to a value this app does not recognise, so forwarded client addresses are ignored. Use 1, true, yes or on to trust a reverse proxy, or remove the variable.',
    );
  }

  if (!env.MAIL_ALLOWED_HOSTS?.trim()) {
    warnings.push(
      'MAIL_ALLOWED_HOSTS is not set. With the SMTP mail driver, an owner who edits mail_host can send the SMTP password to that host. Set it to the comma-separated list of allowed SMTP hosts.',
    );
  }

  const siteWarning = appBaseUrlWarning(env);
  if (siteWarning) {
    warnings.push(siteWarning);
  }

  return warnings;
}

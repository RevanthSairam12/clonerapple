/**
 * PayU Configuration Module
 *
 * Centralized, server-only configuration for PayU Hosted Checkout & Payment APIs.
 * Supports seamless switching between 'test' and 'live' environments via PAYU_ENV.
 *
 * SECURITY:
 * - This module must NEVER be imported into client components.
 * - PAYU_SALT and PAYU_KEY must never be leaked or returned to the browser.
 * - The public site address comes from `APP_BASE_URL` only. It is never taken
 *   from the request `Host`/`X-Forwarded-Host` header: a forged header would
 *   otherwise be able to point PayU's return POST, and the customer's browser,
 *   at an attacker-controlled host.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: PayU configuration and secrets must never be loaded in the browser environment.');
}

export type PayUEnvironment = 'test' | 'live';

/** Routes PayU is told to call back. All are built from the same validated base. */
export interface PayUCallbackUrls {
  surl: string;
  furl: string;
  curl: string;
  webhook: string;
}

export type AppBaseUrlFailureCode =
  | 'missing'
  | 'invalid'
  | 'credentials'
  | 'query'
  | 'path'
  | 'insecure'
  | 'tunnel_in_production';

export type AppBaseUrlResult =
  | {
      ok: true;
      baseUrl: string;
      isLocalhost: boolean;
      isTunnel: boolean;
      https: boolean;
    }
  | { ok: false; code: AppBaseUrlFailureCode; message: string };

export interface PayUConfig {
  key: string;
  salt: string;
  env: PayUEnvironment;
  paymentUrl: string;
  verifyPaymentUrl: string;
  /** Validated public origin, or '' when `APP_BASE_URL` is missing/invalid. */
  appBaseUrl: string;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const TUNNEL_HOST_SUFFIXES = [
  '.trycloudflare.com',
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.io',
  '.ngrok.app',
  '.loca.lt',
  '.localtunnel.me',
  '.ts.net',
] as const;

let warnedAboutLocalhost = false;

export function isLocalhostHostname(hostname: string): boolean {
  const normalised = hostname.trim().toLowerCase();
  return LOCAL_HOSTNAMES.has(normalised) || normalised.endsWith('.localhost');
}

export function isTunnelHostname(hostname: string): boolean {
  const normalised = hostname.trim().toLowerCase().replace(/\.+$/, '');
  if (!normalised) return false;
  return TUNNEL_HOST_SUFFIXES.some(
    (suffix) => normalised === suffix.slice(1) || normalised.endsWith(suffix),
  );
}

/** True when `PAYU_ENV` is set to `'live'` or `'production'`. */
export function isProductionPayUEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.PAYU_ENV || '').trim().toLowerCase();
  return raw === 'live' || raw === 'production';
}

/**
 * The one place the public site address is resolved.
 *
 * Callers must fail closed when this returns `ok: false`. Nothing else — not
 * `surl`, not `furl`, not `curl`, not the webhook URL, not a redirect — may
 * invent a base address.
 */
export function resolveAppBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): AppBaseUrlResult {
  const raw = (env.APP_BASE_URL || '').trim();

  if (!raw) {
    return {
      ok: false,
      code: 'missing',
      message:
        'APP_BASE_URL is not configured. Set it to the public HTTPS address of this store so PayU can return the customer here.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      code: 'invalid',
      message: 'APP_BASE_URL is not a valid absolute URL.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      code: 'invalid',
      message: 'APP_BASE_URL must use http or https.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: 'credentials',
      message: 'APP_BASE_URL must not contain a username or password.',
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      code: 'query',
      message: 'APP_BASE_URL must be a plain origin without a query string or fragment.',
    };
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return {
      ok: false,
      code: 'path',
      message: 'APP_BASE_URL must not include a path. Use the origin only, for example https://shop.example.com.',
    };
  }

  const isLocalhost = isLocalhostHostname(parsed.hostname);
  const isTunnel = isTunnelHostname(parsed.hostname);
  const https = parsed.protocol === 'https:';
  const prodPayU = isProductionPayUEnv(env);

  if (env.NODE_ENV === 'production' || prodPayU) {
    if (!https) {
      return {
        ok: false,
        code: 'insecure',
        message: 'APP_BASE_URL must be a public HTTPS address in production.',
      };
    }
    if (isLocalhost) {
      return {
        ok: false,
        code: 'insecure',
        message: 'APP_BASE_URL points at localhost, which PayU cannot reach. Configure the public HTTPS address.',
      };
    }
  } else if (isLocalhost && !warnedAboutLocalhost) {
    warnedAboutLocalhost = true;
    console.warn(
      '[payu/config] Localhost return URLs work only in a browser on this machine. PayU server-to-server webhooks need a reachable public HTTPS address.',
    );
  }

  if (prodPayU && isTunnel) {
    return {
      ok: false,
      code: 'tunnel_in_production',
      message:
        'APP_BASE_URL points at a temporary tunnel host, which is not permitted when PAYU_ENV is in production mode. Configure the permanent HTTPS domain.',
    };
  }

  return {
    ok: true,
    // `new URL().origin` drops any trailing slash and normalises the host.
    baseUrl: parsed.origin,
    isLocalhost,
    isTunnel,
    https,
  };
}

/** Convenience wrapper returning the validated origin, or null. */
export function getAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const result = resolveAppBaseUrl(env);
  return result.ok ? result.baseUrl : null;
}

/** The four callback addresses, all built on one validated origin. */
export function getPayUCallbackUrls(baseUrl: string): PayUCallbackUrls {
  const origin = baseUrl.replace(/\/+$/, '');
  return {
    surl: `${origin}/api/payu/success`,
    furl: `${origin}/api/payu/failure`,
    curl: `${origin}/api/payu/cancel`,
    webhook: `${origin}/api/payu/webhook`,
  };
}

/**
 * Absolute redirect target for a PayU return handler.
 *
 * `NextResponse.redirect` rejects relative URLs, so the browser is sent to the
 * validated origin. Returns null when the base is unusable, which callers turn
 * into a safe plain-text response instead of an invalid Location header.
 */
export function buildPayURedirectUrl(
  pathAndQuery: string,
  env: NodeJS.ProcessEnv = process.env,
): URL | null {
  const base = getAppBaseUrl(env);
  if (!base) return null;
  // Strip a leading slash set so the path is always relative to the origin.
  const path = pathAndQuery.replace(/^\/+/, '');
  try {
    return new URL(`/${path}`, base);
  } catch {
    return null;
  }
}

/**
 * Returns the active PayU configuration.
 * Validates presence of mandatory environment variables and computes proper endpoints.
 */
export function getPayUConfig(env: NodeJS.ProcessEnv = process.env): PayUConfig {
  const mode: PayUEnvironment = isProductionPayUEnv(env) ? 'live' : 'test';

  const key = env.PAYU_KEY?.trim() || '';
  const salt = env.PAYU_SALT?.trim() || '';
  const rawBaseUrl = env.PAYU_BASE_URL?.trim();

  // Hosted checkout URL
  let paymentUrl: string;
  if (rawBaseUrl) {
    const cleanBase = rawBaseUrl.replace(/\/+$/, '');
    paymentUrl = cleanBase.endsWith('/_payment') ? cleanBase : `${cleanBase}/_payment`;
  } else {
    paymentUrl = mode === 'live'
      ? 'https://secure.payu.in/_payment'
      : 'https://test.payu.in/_payment';
  }

  // Server-to-server Verify Payment API endpoint
  const verifyPaymentUrl = mode === 'live'
    ? 'https://info.payu.in/merchant/postservice.php?form=2'
    : 'https://test.payu.in/merchant/postservice.php?form=2';

  return {
    key,
    salt,
    env: mode,
    paymentUrl,
    verifyPaymentUrl,
    appBaseUrl: getAppBaseUrl(env) ?? '',
  };
}

export interface PayUConfigurationProblem {
  code: 'missing_key' | 'missing_salt' | AppBaseUrlFailureCode;
  /** Safe to show to a customer or an admin: no secrets, no values. */
  message: string;
  /** Whether the storefront should show the generic "payment unavailable" copy. */
  adminAction: string;
}

/** Non-throwing validation used by routes that must fail closed with a message. */
export function checkPayUConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; key: string; salt: string; appBaseUrl: string } | { ok: false; problem: PayUConfigurationProblem } {
  const key = (env.PAYU_KEY || '').trim();
  const salt = (env.PAYU_SALT || '').trim();

  if (!key) {
    return {
      ok: false,
      problem: {
        code: 'missing_key',
        message: 'Online payment is not configured yet.',
        adminAction: 'Set PAYU_KEY in the environment.',
      },
    };
  }
  if (!salt) {
    return {
      ok: false,
      problem: {
        code: 'missing_salt',
        message: 'Online payment is not configured yet.',
        adminAction: 'Set PAYU_SALT in the environment.',
      },
    };
  }

  const base = resolveAppBaseUrl(env);
  if (!base.ok) {
    return {
      ok: false,
      problem: {
        code: base.code,
        message: 'Online payment is not configured yet.',
        adminAction: `${base.message} Set APP_BASE_URL to the public HTTPS address of this store.`,
      },
    };
  }

  return { ok: true, key, salt, appBaseUrl: base.baseUrl };
}

/** Existing-payment verification does not depend on the browser return origin. */
export function assertPayUCredentialsConfigured(
  config: PayUConfig = getPayUConfig(),
): void {
  if (!config.key) {
    throw new Error('PayU configuration error: PAYU_KEY environment variable is missing.');
  }
  if (!config.salt) {
    throw new Error('PayU configuration error: PAYU_SALT environment variable is missing.');
  }
}

/** New checkouts require credentials AND an explicit validated return origin. */
export function assertPayUConfigured(
  config: PayUConfig = getPayUConfig(),
): asserts config is PayUConfig & { key: string; salt: string; appBaseUrl: string } {
  assertPayUCredentialsConfigured(config);
  if (!config.appBaseUrl) {
    const base = resolveAppBaseUrl();
    throw new Error(
      `PayU configuration error: ${base.ok
        ? 'APP_BASE_URL must be set to the public site address.'
        : base.message}`,
    );
  }
}

/**
 * HMAC secret for short-lived return links. Returns null when unset so callers
 * fail closed rather than fall back to an unkeyed value.
 */
export function getPayUReturnSecret(): string | null {
  const secret = (process.env.PAYU_RETURN_SECRET || '').trim();
  return secret.length >= 32 ? secret : null;
}

export type SiteAddressCheckCode =
  | 'ok'
  | 'tunnel_warning'
  | 'unreachable'
  | AppBaseUrlFailureCode;

export interface SiteAddressHealthResult {
  ok: boolean;
  configured: boolean;
  valid: boolean;
  https: boolean;
  isTunnel: boolean;
  isLocalhost: boolean;
  reachable: boolean;
  statusCode: number | null;
  productionReady: boolean;
  code: SiteAddressCheckCode;
  message: string;
}

/**
 * Owner-only diagnostic check for `APP_BASE_URL`.
 *
 * Inspects protocol (`https:`), whether the host is a tunnel (`*.trycloudflare.com`,
 * `*.ngrok-free.app`, etc.) or localhost, whether `resolveAppBaseUrl(env)`
 * accepts it for the active `PAYU_ENV`, and probes `${origin}/` with a bounded
 * HTTP request to report live reachability. Never echoes raw URLs with
 * credentials or secrets.
 */
export async function checkSiteAddressHealth(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<SiteAddressHealthResult> {
  const raw = (env.APP_BASE_URL || '').trim();
  if (!raw) {
    return {
      ok: false,
      configured: false,
      valid: false,
      https: false,
      isTunnel: false,
      isLocalhost: false,
      reachable: false,
      statusCode: null,
      productionReady: false,
      code: 'missing',
      message:
        'APP_BASE_URL is not configured. Set it to the public HTTPS address of this store.',
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }

  const https = parsed?.protocol === 'https:';
  const isTunnel = parsed ? isTunnelHostname(parsed.hostname) : false;
  const isLocalhost = parsed ? isLocalhostHostname(parsed.hostname) : false;
  const resolved = resolveAppBaseUrl(env);

  if (!resolved.ok) {
    return {
      ok: false,
      configured: true,
      valid: false,
      https,
      isTunnel,
      isLocalhost,
      reachable: false,
      statusCode: null,
      productionReady: false,
      code: resolved.code,
      message: resolved.message,
    };
  }

  let reachable = false;
  let statusCode: number | null = null;
  try {
    const res = await fetcher(`${resolved.baseUrl}/`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    // 2xx or 3xx confirms the HTTP listener at APP_BASE_URL is reachable.
    // 401/403 on a Vercel preview indicates Deployment Protection is blocking callbacks.
    reachable = res.status >= 200 && res.status < 400;
    await res.body?.cancel().catch(() => {});
  } catch {
    reachable = false;
    statusCode = null;
  }

  if (!reachable) {
    const protectionNote =
      statusCode === 401 || statusCode === 403
        ? ` (HTTP ${statusCode} — check whether Vercel Deployment Protection or a firewall is blocking unauthenticated requests)`
        : statusCode !== null
          ? ` (HTTP ${statusCode})`
          : '';
    return {
      ok: false,
      configured: true,
      valid: true,
      https,
      isTunnel,
      isLocalhost,
      reachable: false,
      statusCode,
      productionReady: false,
      code: 'unreachable',
      message: `APP_BASE_URL could not be reached${protectionNote}. PayU browser returns and webhooks will fail until the address answers publicly.`,
    };
  }

  if (isTunnel) {
    return {
      ok: true,
      configured: true,
      valid: true,
      https,
      isTunnel: true,
      isLocalhost,
      reachable: true,
      statusCode,
      productionReady: false,
      code: 'tunnel_warning',
      message:
        'APP_BASE_URL is reachable over HTTPS through a temporary tunnel host. Suitable for test-mode callbacks only; replace with a permanent HTTPS domain before enabling production payments.',
    };
  }

  const productionReady = https && !isLocalhost && !isTunnel && reachable;
  return {
    ok: true,
    configured: true,
    valid: true,
    https,
    isTunnel: false,
    isLocalhost,
    reachable: true,
    statusCode,
    productionReady,
    code: 'ok',
    message: https
      ? 'APP_BASE_URL is a reachable public HTTPS origin.'
      : 'APP_BASE_URL is reachable over HTTP (local development only; HTTPS is required in production).',
  };
}

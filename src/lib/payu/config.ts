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
  | 'insecure';

export type AppBaseUrlResult =
  | { ok: true; baseUrl: string; isLocalhost: boolean }
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

let warnedAboutLocalhost = false;

export function isLocalhostHostname(hostname: string): boolean {
  const normalised = hostname.trim().toLowerCase();
  return LOCAL_HOSTNAMES.has(normalised) || normalised.endsWith('.localhost');
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

  if (env.NODE_ENV === 'production') {
    if (parsed.protocol !== 'https:') {
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

  return {
    ok: true,
    // `new URL().origin` drops any trailing slash and normalises the host.
    baseUrl: parsed.origin,
    isLocalhost,
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
export function getPayUConfig(): PayUConfig {
  const env: PayUEnvironment = process.env.PAYU_ENV === 'live' ? 'live' : 'test';

  const key = process.env.PAYU_KEY?.trim() || '';
  const salt = process.env.PAYU_SALT?.trim() || '';
  const rawBaseUrl = process.env.PAYU_BASE_URL?.trim();

  // Hosted checkout URL
  let paymentUrl: string;
  if (rawBaseUrl) {
    const cleanBase = rawBaseUrl.replace(/\/+$/, '');
    paymentUrl = cleanBase.endsWith('/_payment') ? cleanBase : `${cleanBase}/_payment`;
  } else {
    paymentUrl = env === 'live'
      ? 'https://secure.payu.in/_payment'
      : 'https://test.payu.in/_payment';
  }

  // Server-to-server Verify Payment API endpoint
  const verifyPaymentUrl = env === 'live'
    ? 'https://info.payu.in/merchant/postservice.php?form=2'
    : 'https://test.payu.in/merchant/postservice.php?form=2';

  return {
    key,
    salt,
    env,
    paymentUrl,
    verifyPaymentUrl,
    appBaseUrl: getAppBaseUrl() ?? '',
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

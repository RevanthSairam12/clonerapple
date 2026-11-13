import { isLocalhostHostname, isTunnelHostname } from './site-address-rules';

export type AppEnvMode = 'production' | 'staging';

export type ProductionEnvIssueCode =
  | 'invalid_app_env'
  | 'payu_env_mismatch'
  | 'payu_base_url_mismatch'
  | 'payu_credentials_missing'
  | 'payu_return_secret_invalid'
  | 'trust_proxy_required'
  | 'app_base_url_invalid'
  | 'cron_secret_invalid'
  | 'mail_allowed_hosts_missing'
  | 'database_url_invalid';

export interface ProductionEnvIssue {
  code: ProductionEnvIssueCode;
  envVar: string;
  message: string;
}

export interface ProductionEnvCheckResult {
  ok: boolean;
  appEnv: AppEnvMode | null;
  onVercel: boolean;
  mailOn: boolean;
  issues: ProductionEnvIssue[];
}

export interface ProductionEnvCheckOptions {
  /** Whether mail delivery is enabled (`store_settings.mail_status === 'on'`). */
  mailOn?: boolean;
}

const MIN_SECRET_LENGTH = 32;
const PAYU_LIVE_HOST = 'secure.payu.in';
const PAYU_TEST_HOST = 'test.payu.in';

export function isVercelDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  const rawVercel = (env.VERCEL ?? '').trim().toLowerCase();
  if (rawVercel !== '' && rawVercel !== '0' && rawVercel !== 'false') {
    return true;
  }
  return Boolean((env.VERCEL_ENV ?? '').trim());
}

/**
 * True when full production/staging safety enforcement must run at request time:
 * - whenever `APP_ENV` is set,
 * - whenever deployed on Vercel (`VERCEL` / `VERCEL_ENV`), or
 * - whenever `NODE_ENV === 'production'` with live/production `PAYU_ENV`.
 */
export function shouldEnforceProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if ((env.APP_ENV ?? '').trim().length > 0) return true;
  if (isVercelDeployment(env)) return true;
  const rawPayuEnv = (env.PAYU_ENV ?? '').trim().toLowerCase();
  return env.NODE_ENV === 'production' && (rawPayuEnv === 'live' || rawPayuEnv === 'production');
}

function parsePayuPaymentHost(raw: string): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/' && parsed.pathname !== '/_payment') {
    return null;
  }
  return parsed.hostname.trim().toLowerCase();
}

/**
 * Validates deployment safety rules for production and staging without ever
 * leaking secret values, connection strings, or URLs in error messages — only
 * variable names, expected rules, and lengths are emitted.
 */
export function checkProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionEnvCheckOptions = {},
): ProductionEnvCheckResult {
  const issues: ProductionEnvIssue[] = [];
  const rawAppEnv = (env.APP_ENV ?? '').trim();
  const normalizedAppEnv = rawAppEnv.toLowerCase();
  const appEnv: AppEnvMode | null =
    normalizedAppEnv === 'production' || normalizedAppEnv === 'staging'
      ? normalizedAppEnv
      : null;

  if (!appEnv) {
    issues.push({
      code: 'invalid_app_env',
      envVar: 'APP_ENV',
      message:
        rawAppEnv.length === 0
          ? 'APP_ENV is missing (length 0). Set APP_ENV to "production" or "staging".'
          : `APP_ENV is invalid (length ${rawAppEnv.length}). Set APP_ENV to "production" or "staging".`,
    });
  }

  const rawPayuEnv = (env.PAYU_ENV ?? '').trim();
  const normalizedPayuEnv = rawPayuEnv.toLowerCase();
  const rawPayuBaseUrl = (env.PAYU_BASE_URL ?? '').trim();
  const payuHost = parsePayuPaymentHost(rawPayuBaseUrl);

  if (appEnv === 'production') {
    if (normalizedPayuEnv !== 'live') {
      issues.push({
        code: 'payu_env_mismatch',
        envVar: 'PAYU_ENV',
        message: `APP_ENV=production requires PAYU_ENV=live (PAYU_ENV length ${rawPayuEnv.length}).`,
      });
    }
    if (payuHost !== PAYU_LIVE_HOST) {
      issues.push({
        code: 'payu_base_url_mismatch',
        envVar: 'PAYU_BASE_URL',
        message: `APP_ENV=production requires PAYU_BASE_URL to use the live PayU URL (PAYU_BASE_URL length ${rawPayuBaseUrl.length}).`,
      });
    }
  } else if (appEnv === 'staging') {
    if (normalizedPayuEnv !== 'test') {
      issues.push({
        code: 'payu_env_mismatch',
        envVar: 'PAYU_ENV',
        message: `APP_ENV=staging forbids live PayU and requires PAYU_ENV=test (PAYU_ENV length ${rawPayuEnv.length}).`,
      });
    }
    if (payuHost !== PAYU_TEST_HOST) {
      issues.push({
        code: 'payu_base_url_mismatch',
        envVar: 'PAYU_BASE_URL',
        message: `APP_ENV=staging requires PAYU_BASE_URL to use the test PayU URL (PAYU_BASE_URL length ${rawPayuBaseUrl.length}).`,
      });
    }
  }

  const payuKey = (env.PAYU_KEY ?? '').trim();
  if (!payuKey) {
    issues.push({
      code: 'payu_credentials_missing',
      envVar: 'PAYU_KEY',
      message: 'PAYU_KEY is missing (length 0).',
    });
  }

  const payuSalt = (env.PAYU_SALT ?? '').trim();
  if (!payuSalt) {
    issues.push({
      code: 'payu_credentials_missing',
      envVar: 'PAYU_SALT',
      message: 'PAYU_SALT is missing (length 0).',
    });
  }

  const returnSecret = (env.PAYU_RETURN_SECRET ?? '').trim();
  if (returnSecret.length < MIN_SECRET_LENGTH) {
    issues.push({
      code: 'payu_return_secret_invalid',
      envVar: 'PAYU_RETURN_SECRET',
      message: `PAYU_RETURN_SECRET must be present and at least ${MIN_SECRET_LENGTH} characters (length ${returnSecret.length}).`,
    });
  }

  const onVercel = isVercelDeployment(env);
  if (onVercel) {
    const trustProxy = (env.TRUST_PROXY ?? '').trim();
    if (trustProxy !== '1') {
      issues.push({
        code: 'trust_proxy_required',
        envVar: 'TRUST_PROXY',
        message: `TRUST_PROXY must be set to "1" on Vercel deployments (TRUST_PROXY length ${trustProxy.length}).`,
      });
    }
  }

  const rawAppBaseUrl = (env.APP_BASE_URL ?? '').trim();
  if (!rawAppBaseUrl) {
    issues.push({
      code: 'app_base_url_invalid',
      envVar: 'APP_BASE_URL',
      message: 'APP_BASE_URL is missing (length 0). It must be an HTTPS public origin.',
    });
  } else {
    let parsedBase: URL | null = null;
    try {
      parsedBase = new URL(rawAppBaseUrl);
    } catch {
      parsedBase = null;
    }

    if (
      !parsedBase ||
      parsedBase.username ||
      parsedBase.password ||
      parsedBase.search ||
      parsedBase.hash ||
      (parsedBase.pathname !== '' && parsedBase.pathname !== '/')
    ) {
      issues.push({
        code: 'app_base_url_invalid',
        envVar: 'APP_BASE_URL',
        message: `APP_BASE_URL must be a valid origin-only HTTPS URL (length ${rawAppBaseUrl.length}).`,
      });
    } else if (parsedBase.protocol !== 'https:') {
      issues.push({
        code: 'app_base_url_invalid',
        envVar: 'APP_BASE_URL',
        message: `APP_BASE_URL must use HTTPS (length ${rawAppBaseUrl.length}).`,
      });
    } else if (isLocalhostHostname(parsedBase.hostname)) {
      issues.push({
        code: 'app_base_url_invalid',
        envVar: 'APP_BASE_URL',
        message: `APP_BASE_URL must not point to localhost (length ${rawAppBaseUrl.length}).`,
      });
    } else if (isTunnelHostname(parsedBase.hostname)) {
      issues.push({
        code: 'app_base_url_invalid',
        envVar: 'APP_BASE_URL',
        message: `APP_BASE_URL must not point to a temporary tunnel host (length ${rawAppBaseUrl.length}).`,
      });
    }
  }

  const cronSecret = (env.CRON_SECRET ?? '').trim();
  if (cronSecret.length < MIN_SECRET_LENGTH) {
    issues.push({
      code: 'cron_secret_invalid',
      envVar: 'CRON_SECRET',
      message: `CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters (length ${cronSecret.length}).`,
    });
  }

  const mailOn = options.mailOn === true;
  if (mailOn) {
    const rawMailHosts = env.MAIL_ALLOWED_HOSTS ?? '';
    const hosts = rawMailHosts
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (hosts.length === 0) {
      issues.push({
        code: 'mail_allowed_hosts_missing',
        envVar: 'MAIL_ALLOWED_HOSTS',
        message: `MAIL_ALLOWED_HOSTS must be set when mail is enabled (MAIL_ALLOWED_HOSTS length ${rawMailHosts.trim().length}).`,
      });
    }
  }

  const rawDatabaseUrl = (env.DATABASE_URL ?? '').trim();
  if (!rawDatabaseUrl) {
    issues.push({
      code: 'database_url_invalid',
      envVar: 'DATABASE_URL',
      message: 'DATABASE_URL is missing (length 0). It must use pooler port 6543.',
    });
  } else {
    let parsedDb: URL | null = null;
    try {
      parsedDb = new URL(rawDatabaseUrl);
    } catch {
      parsedDb = null;
    }
    if (
      !parsedDb ||
      (parsedDb.protocol !== 'postgresql:' && parsedDb.protocol !== 'postgres:')
    ) {
      issues.push({
        code: 'database_url_invalid',
        envVar: 'DATABASE_URL',
        message: `DATABASE_URL is not a valid PostgreSQL URL (length ${rawDatabaseUrl.length}).`,
      });
    } else if (parsedDb.port !== '6543') {
      issues.push({
        code: 'database_url_invalid',
        envVar: 'DATABASE_URL',
        message: `DATABASE_URL must use pooler port 6543 (length ${rawDatabaseUrl.length}, port length ${parsedDb.port.length}).`,
      });
    }
  }

  // Note: DATABASE_MIGRATION_URL is intentionally NOT required at runtime.

  return {
    ok: issues.length === 0,
    appEnv,
    onVercel,
    mailOn,
    issues,
  };
}


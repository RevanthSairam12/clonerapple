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
 *   behind a reverse proxy that overwrites `X-Forwarded-For`. Without it the
 *   forwarded address is ignored and per-IP rate limits are skipped (per-agent
 *   and per-email limits still apply). Set it when a proxy does overwrite the
 *   header; leave it unset when clients reach the process directly, otherwise a
 *   caller could forge the address.
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

  return warnings;
}

import { timingSafeEqual } from 'node:crypto';

/**
 * Authorisation for scheduled PayU reconciliation.
 *
 * Reconciliation now releases stock held by stale unpaid orders, so an open
 * endpoint is not acceptable. When `CRON_SECRET` is missing the endpoint fails
 * closed in production (503) and stays callable in development, where the
 * scheduler is usually run by hand.
 *
 * SEC-006: Query-parameter secrets (`?secret=...`) are explicitly rejected
 * because URLs leak into reverse-proxy logs, browser history, Referer headers,
 * and scheduler dashboards. Secrets must be sent via `Authorization: Bearer`
 * or `X-Cron-Secret` headers only.
 */

export type CronAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authorizeCronRequest(input: {
  expectedSecret: string | null | undefined;
  authorization: string | null | undefined;
  cronSecretHeader?: string | null | undefined;
  hasQuerySecret?: boolean;
  /** Deprecated legacy input: presence of any value causes explicit 401 rejection. */
  querySecret?: string | null | undefined;
  isProduction: boolean;
  jobName?: string;
}): CronAuthorization {
  if (input.hasQuerySecret || (input.querySecret ?? '').trim() !== '') {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized: Cron secret must not be supplied in URL query parameters.',
    };
  }

  const job = input.jobName?.trim() || 'Reconciliation';
  const expected = (input.expectedSecret ?? '').trim();

  if (!expected) {
    if (input.isProduction) {
      return {
        ok: false,
        status: 503,
        error: `${job} is disabled until CRON_SECRET is configured.`,
      };
    }
    return { ok: true };
  }

  const bearerToken = (input.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const dedicatedHeaderToken = (input.cronSecretHeader ?? '').trim();
  const token = bearerToken || dedicatedHeaderToken;

  if (!token || !safeEqual(token, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid cron secret' };
  }
  return { ok: true };
}

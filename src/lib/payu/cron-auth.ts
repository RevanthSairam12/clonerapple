import { timingSafeEqual } from 'node:crypto';

/**
 * Authorisation for scheduled PayU reconciliation.
 *
 * Reconciliation now releases stock held by stale unpaid orders, so an open
 * endpoint is not acceptable. When `CRON_SECRET` is missing the endpoint fails
 * closed in production (503) and stays callable in development, where the
 * scheduler is usually run by hand. The secret is accepted as
 * `Authorization: Bearer <secret>` or `?secret=<secret>`.
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
  querySecret: string | null | undefined;
  isProduction: boolean;
  jobName?: string;
}): CronAuthorization {
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

  const headerToken = (input.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const token = headerToken || (input.querySecret ?? '').trim();

  if (!token || !safeEqual(token, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid cron secret' };
  }
  return { ok: true };
}

/**
 * Transaction timeout guards for checkout, POS, coupon and reconcile paths.
 *
 * `SET LOCAL` scopes the timeout to the current transaction. When a pile-up
 * causes a lock wait or a slow statement, the transaction aborts with a known
 * error code, the customer sees a friendly 503 with `Retry-After`, and no
 * partial order is created.
 *
 * Error codes:
 * - `55P03` — lock_not_available (`lock_timeout` expired)
 * - `57014` — query_canceled (`statement_timeout` expired)
 */

import type postgres from 'postgres';

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Set `lock_timeout` (5 s) and `statement_timeout` (15 s) on a transaction handle.
 *
 * Call at the very start of a `sql.begin(async (tx) => { … })` callback.
 * The `SET LOCAL` makes the values transaction-scoped: they vanish on
 * commit or rollback and never leak to other sessions in the pool.
 */
export async function setTransactionTimeouts(
  tx: postgres.TransactionSql,
  options: {
    lockTimeoutMs?: number;
    statementTimeoutMs?: number;
  } = {},
): Promise<void> {
  const lock = Math.max(1, Math.trunc(options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS));
  const stmt = Math.max(1, Math.trunc(options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS));
  await tx`select set_config('lock_timeout', ${`${lock}ms`}, true), set_config('statement_timeout', ${`${stmt}ms`}, true)`;
}

/**
 * True when `error` was raised by a `lock_timeout` or `statement_timeout`.
 *
 * Postgres error codes:
 * - `55P03`: lock_not_available
 * - `57014`: query_canceled (includes statement_timeout)
 */
export function isTransactionTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: string }).code;
  return code === '55P03' || code === '57014';
}

/** Customer-facing friendly message for a timeout (503 with Retry-After). */
export const BUSY_MESSAGE = 'The store is busy right now. Please try again in a moment.';

/** Retry-After header value in seconds. */
export const BUSY_RETRY_AFTER = '5';

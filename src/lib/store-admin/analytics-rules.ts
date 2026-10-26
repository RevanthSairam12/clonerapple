/**
 * Pure rules shared by the Store Desk overview figures.
 *
 * Kept separate from `analytics.ts` so they can be tested without a database
 * connection. The predicates here are the ones the dashboard copy promises:
 * only a captured (PAID) order is revenue, and an order still waiting on the
 * customer or the gateway is not.
 */

/** The single order status that counts as captured money. */
export const REVENUE_STATUS = 'PAID' as const;

/**
 * An order in one of these states has no captured money yet: it was created,
 * the customer has not finished paying, or the gateway has not confirmed the
 * outcome (PROCESSING). None of them is revenue.
 */
export const PENDING_TRANSACTION_STATUSES = ['CREATED', 'PENDING', 'PROCESSING'] as const;

export function isRevenueStatus(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === REVENUE_STATUS;
}

export interface StatusCountRow {
  status: string;
  count: number;
}

/**
 * Sum the status buckets that are still waiting. Used for the Transactions
 * tab's "Pending" tile so an unverified (PROCESSING) payment is visible there
 * instead of silently disappearing between "Failed" and "Captured".
 */
export function countPendingTransactions(rows: readonly StatusCountRow[]): number {
  const pending = new Set<string>(PENDING_TRANSACTION_STATUSES);
  return rows.reduce((sum, row) => {
    if (!pending.has(String(row.status ?? '').trim().toUpperCase())) return sum;
    return sum + Math.max(0, Math.trunc(Number(row.count) || 0));
  }, 0);
}

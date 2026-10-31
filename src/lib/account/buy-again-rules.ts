/**
 * Pure rules for the Buy again row. No database, no React — the query hands
 * rows in, these decide which products survive.
 */

import { stockBlocked } from '@/lib/storefront/availability-rules';

export const BUY_AGAIN_LIMIT = 8;

export interface BuyAgainCandidateRow {
  product_id?: unknown;
  last_ordered_at?: unknown;
}

/**
 * Product ids in the order the customer last bought them.
 *
 * The SQL already groups and orders; this re-checks the contract so a joined
 * row can never produce a duplicate card, a blank id, or an unbounded list.
 */
export function selectBuyAgainProductIds(
  rows: readonly BuyAgainCandidateRow[],
  limit: number = BUY_AGAIN_LIMIT,
): string[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : BUY_AGAIN_LIMIT;
  if (cap === 0) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const id = typeof row.product_id === 'string' ? row.product_id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= cap) break;
  }
  return ids;
}

/**
 * The storefront stock rule, applied to a past purchase: normal mode hides a
 * sold-out item, sale mode never does (nothing says "not available" during a
 * sale).
 */
export function isBuyAgainVisible(product: { inStock: boolean }, saleLive: boolean): boolean {
  return !stockBlocked(product.inStock, saleLive);
}
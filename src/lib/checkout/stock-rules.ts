/**
 * Pure stock-claim rules for online checkout.
 *
 * A claim is planned from the same rows the database locks, so the decision
 * that a cart fits is made in one place and tested without a database. Only
 * tracked stock rows are claimed; a product without a stock row is untracked,
 * which is the same rule the storefront and POS already use.
 *
 * Release arithmetic is by movement ledger, not by a stored flag: the amount
 * still outstanding for an order is the claimed quantity minus what has
 * already been released. That makes duplicate callbacks harmless.
 */

export interface StockIdentity {
  productId: string;
  variantId?: string | null;
}

/** Collision-safe identity; labels and SKUs are never stock keys. */
export function stockKey(line: StockIdentity): string {
  return JSON.stringify([line.productId, line.variantId || null]);
}

export interface StockRowSnapshot {
  product_id: string;
  variant_id?: string | null;
  on_hand: number;
  reserved: number;
  track_inventory: boolean;
}

export interface StockRequestLine {
  productId: string;
  variantId?: string | null;
  variantLabel?: string | null;
  /** Explicit commerce variants require a configured row even if untracked. */
  requiresStockRow?: boolean;
  quantity: number;
  productName?: string;
}

export interface StockClaimPlan {
  productId: string;
  variantId?: string | null;
  variantLabel?: string | null;
  quantity: number;
  productName?: string;
}

export type StockCheck =
  | { ok: true; claims: StockClaimPlan[]; untracked: string[] }
  | { ok: false; error: string };

function wholeQuantity(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed >= 1 ? parsed : null;
}

function availableOf(row: StockRowSnapshot): number {
  const onHand = Number(row.on_hand);
  const reserved = Number(row.reserved);
  const safeOnHand = Number.isFinite(onHand) ? onHand : 0;
  const safeReserved = Number.isFinite(reserved) ? reserved : 0;
  return Math.max(0, Math.trunc(safeOnHand - safeReserved));
}

function soldOutMessage(line: StockClaimPlan): string {
  const name = line.productName?.trim() || 'This item';
  return `Out of stock: ${name}. Remove it from your bag to continue.`;
}

function shortMessage(line: StockClaimPlan, available: number): string {
  const name = line.productName?.trim() || 'This item';
  return `Only ${available} left of ${name}. Reduce the quantity or remove it from your bag.`;
}

/**
 * Decide whether the cart can be claimed. Quantities are aggregated per
 * product first, so two lines of the same product cannot each pass the check
 * against one remaining unit.
 */
export function planStockClaim(
  lines: readonly StockRequestLine[],
  rows: readonly StockRowSnapshot[],
): StockCheck {
  const byProduct = new Map<string, StockClaimPlan>();

  for (const line of lines) {
    const productId = String(line.productId ?? '').trim();
    if (!productId) return { ok: false, error: 'Your bag contains an item that is no longer available.' };
    const quantity = wholeQuantity(line.quantity);
    if (quantity === null) return { ok: false, error: 'Your bag contains an invalid quantity. Please review it.' };
    const key = stockKey(line);
    const existing = byProduct.get(key);
    if (existing) {
      existing.quantity += quantity;
      if (!existing.variantLabel && line.variantLabel) {
        existing.variantLabel = line.variantLabel;
      }
    } else {
      byProduct.set(key, {
        productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
        quantity,
        productName: line.productName,
      });
    }
  }

  const stockByProduct = new Map<string, StockRowSnapshot>();
  for (const row of rows) stockByProduct.set(stockKey({ productId: String(row.product_id), variantId: row.variant_id }), row);

  const claims: StockClaimPlan[] = [];
  const untracked: string[] = [];

  for (const plan of byProduct.values()) {
    const row = stockByProduct.get(stockKey(plan));
    if (!row && (plan.variantId || lines.some(line => stockKey(line) === stockKey(plan) && line.requiresStockRow))) {
      return { ok: false, error: 'Variant stock setup is incomplete. Please choose another option.' };
    }
    if (!row || !row.track_inventory) {
      untracked.push(plan.productId);
      continue;
    }
    const available = availableOf(row);
    if (available <= 0) return { ok: false, error: soldOutMessage(plan) };
    if (plan.quantity > available) return { ok: false, error: shortMessage(plan, available) };
    claims.push(plan);
  }

  return { ok: true, claims, untracked };
}

/**
 * Quantity a claimed order can still give back: claims that were written as
 * `sale` movements minus releases already written. Never negative.
 */
export function outstandingClaimQuantity(claimedQuantity: unknown, releasedQuantity: unknown): number {
  const claimed = Number(claimedQuantity);
  const released = Number(releasedQuantity);
  const safeClaimed = Number.isFinite(claimed) ? Math.max(0, Math.trunc(claimed)) : 0;
  const safeReleased = Number.isFinite(released) ? Math.max(0, Math.trunc(released)) : 0;
  return Math.max(0, safeClaimed - safeReleased);
}

/**
 * Units a return or void may put back on the shelf for one product.
 *
 * The ledger is the only source of truth. Orders created before Phase 2 (and
 * untracked products at any time) have no `sale` movement, so `claimed` is 0
 * and nothing is restored — a legacy order can never invent stock. Requests
 * are also capped so partial returns and repeated receives cannot exceed what
 * the order actually took.
 */
export function restoreableQuantity(
  requestedQuantity: unknown,
  claimedQuantity: unknown,
  restoredQuantity: unknown,
): number {
  const requested = Number(requestedQuantity);
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.trunc(requested)) : 0;
  return Math.min(safeRequested, outstandingClaimQuantity(claimedQuantity, restoredQuantity));
}

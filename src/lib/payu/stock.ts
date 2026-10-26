import type postgres from 'postgres';

import {
  outstandingClaimQuantity,
  restoreableQuantity,
  type StockClaimPlan,
  type StockRowSnapshot,
} from '@/lib/checkout/stock-rules';

/**
 * Transactional stock claim and release for online orders.
 *
 * Claims happen inside the same transaction that writes the order row, after
 * the tracked rows are locked `for update` and re-checked. Two buyers of the
 * last unit therefore serialise on the same stock row: the second guarded
 * `update ... where on_hand - reserved >= qty` matches nothing and its whole
 * transaction rolls back — no order row, no second claim.
 *
 * Releases are driven by the append-only ledger. The outstanding quantity is
 * `sale` movements minus `release` movements for that order and product, so a
 * duplicate PayU callback or a second reconcile pass releases nothing.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Stock claims must run on the server only.');
}

type Tx = postgres.TransactionSql;

export class InsufficientStockError extends Error {
  readonly code = 'insufficient_stock';

  constructor(message: string) {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

/** Lock every tracked row for the given base product ids. */
export async function lockStockRows(tx: Tx, productIds: readonly string[]): Promise<StockRowSnapshot[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return [];
  return await tx<StockRowSnapshot[]>`
    select product_id, on_hand, reserved, track_inventory
    from stock
    where variant_id is null and product_id = any(${ids}::text[])
    for update
  `;
}

/**
 * Apply an already-validated claim plan. The guarded update is the
 * authoritative check; a miss means another transaction took the units, and
 * the caller's transaction must roll back.
 */
export async function claimPlannedStock(
  tx: Tx,
  orderId: string,
  claims: readonly StockClaimPlan[],
): Promise<void> {
  for (const claim of claims) {
    const updated = await tx<Array<{ product_id: string }>>`
      update stock
      set on_hand = on_hand - ${claim.quantity}, updated_at = now()
      where product_id = ${claim.productId}
        and variant_id is null
        and track_inventory
        and on_hand - reserved >= ${claim.quantity}
      returning product_id
    `;
    if (updated.length === 0) {
      const name = claim.productName?.trim() || 'This item';
      throw new InsufficientStockError(
        `${name} is out of stock. Remove it from your bag to continue.`,
      );
    }
    await tx`
      insert into stock_movements (product_id, delta, reason, order_id)
      values (${claim.productId}, ${-claim.quantity}, 'sale', ${orderId})
    `;
  }
}

/**
 * Give back whatever this order still holds. Returns true when at least one
 * tracked line moved, so callers know to invalidate the storefront cache.
 */
export async function releaseClaimedStock(tx: Tx, orderId: string): Promise<boolean> {
  const lines = await tx<Array<{ product_id: string }>>`
    select distinct product_id
    from order_items
    where order_id = ${orderId}
  `;

  let released = false;

  for (const line of lines) {
    const productId = String(line.product_id);
    const movementRows = await tx<Array<{ claimed: number | string; released: number | string }>>`
      select
        coalesce(sum(case when reason = 'sale' then -delta else 0 end), 0)::int as claimed,
        coalesce(sum(case when reason = 'release' then delta else 0 end), 0)::int as released
      from stock_movements
      where order_id = ${orderId} and product_id = ${productId}
    `;
    const outstanding = outstandingClaimQuantity(
      movementRows[0]?.claimed ?? 0,
      movementRows[0]?.released ?? 0,
    );
    if (outstanding <= 0) continue;

    const updated = await tx<Array<{ product_id: string }>>`
      update stock
      set on_hand = on_hand + ${outstanding}, updated_at = now()
      where product_id = ${productId} and variant_id is null
      returning product_id
    `;
    if (updated.length === 0) continue;

    await tx`
      insert into stock_movements (product_id, delta, reason, order_id)
      values (${productId}, ${outstanding}, 'release', ${orderId})
    `;
    released = true;
  }

  return released;
}

export interface SoldStockLine {
  productId: string;
  quantity: number;
}

/**
 * Put returned or voided units back on the shelf, capped by the sale ledger.
 *
 * A paid order created before Phase 2 has no `sale` movement, so it restores
 * nothing: legacy returns and voids can never invent stock. Partial returns
 * are capped at `sale` minus earlier `return`/`release` movements, so the same
 * units cannot be restocked twice. Untracked products still get a movement row
 * (their sale wrote one) but never move `on_hand`.
 */
export async function restoreSoldStock(
  tx: Tx,
  orderId: string,
  lines: readonly SoldStockLine[],
  options: { createdBy?: string | null } = {},
): Promise<Array<{ productId: string; quantity: number }>> {
  const requested = new Map<string, number>();
  for (const line of lines) {
    const productId = String(line.productId ?? '').trim();
    const quantity = Number(line.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
    requested.set(productId, (requested.get(productId) ?? 0) + Math.trunc(quantity));
  }

  const restored: Array<{ productId: string; quantity: number }> = [];

  for (const [productId, quantity] of requested) {
    const movementRows = await tx<Array<{ claimed: number | string; restored: number | string }>>`
      select
        coalesce(sum(case when reason = 'sale' then -delta else 0 end), 0)::int as claimed,
        coalesce(sum(case when reason in ('return', 'release') then delta else 0 end), 0)::int as restored
      from stock_movements
      where order_id = ${orderId} and product_id = ${productId}
    `;
    const allowed = restoreableQuantity(
      quantity,
      movementRows[0]?.claimed ?? 0,
      movementRows[0]?.restored ?? 0,
    );
    if (allowed <= 0) continue;

    const stockRows = await tx<Array<{ id: string; track_inventory: boolean }>>`
      select id, track_inventory from stock
      where product_id = ${productId} and variant_id is null
      for update
    `;
    const stockRow = stockRows[0];
    if (stockRow && Boolean(stockRow.track_inventory)) {
      await tx`
        update stock
        set on_hand = on_hand + ${allowed},
            updated_at = now(),
            updated_by = ${options.createdBy ?? null}
        where id = ${stockRow.id}
      `;
    }

    await tx`
      insert into stock_movements (product_id, variant_id, delta, reason, order_id, created_by)
      values (${productId}, null, ${allowed}, 'return', ${orderId}, ${options.createdBy ?? null})
    `;
    restored.push({ productId, quantity: allowed });
  }

  return restored;
}

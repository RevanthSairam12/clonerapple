import type postgres from 'postgres';

/**
 * One-time, idempotent release of waiting-list holds.
 *
 * The waiting list has been removed from the product. The `waiting_list_entries`
 * and `stock_reservations` tables stay in place (migrations are additive), but a
 * HELD reservation left behind would keep its units out of availability for
 * ever, because no worker allocates or expires invitations any more. This
 * routine returns every held unit to the shelf in a single transaction:
 *
 * - `stock.reserved` falls by the held quantity (floored at zero);
 * - the reservation becomes CANCELLED;
 * - the invitation it belonged to becomes CANCELLED.
 *
 * It is safe to run repeatedly: only `status = 'HELD'` rows are touched, so a
 * second run reports zero and moves nothing.
 */

export interface WaitlistHoldReleaseSummary {
  /** HELD reservations released by this run. */
  holdsReleased: number;
  /** Units returned to availability (the sum of their quantities). */
  unitsReleased: number;
  /** Distinct product ids whose counters moved. */
  products: string[];
}

export async function releaseWaitingListHoldsUsing(
  sql: postgres.Sql,
): Promise<WaitlistHoldReleaseSummary> {
  return await sql.begin(async (tx) => {
    const holds = await tx<Array<{
      id: string;
      product_id: string;
      quantity: number | string;
      waiting_list_entry_id: string | null;
    }>>`
      select id, product_id, quantity, waiting_list_entry_id
      from stock_reservations
      where status = 'HELD'
      order by id
      for update
    `;

    const products = new Set<string>();
    let unitsReleased = 0;

    for (const hold of holds) {
      const productId = String(hold.product_id);
      const quantity = Math.max(0, Math.trunc(Number(hold.quantity) || 0));

      if (quantity > 0) {
        await tx`
          update stock
          set reserved = greatest(0, reserved - ${quantity}), updated_at = now()
          where product_id = ${productId} and variant_id is null
        `;
        unitsReleased += quantity;
      }
      products.add(productId);

      await tx`
        update stock_reservations
        set status = 'CANCELLED', updated_at = now()
        where id = ${String(hold.id)} and status = 'HELD'
      `;

      if (hold.waiting_list_entry_id) {
        await tx`
          update waiting_list_entries
          set status = 'CANCELLED', updated_at = now()
          where id = ${String(hold.waiting_list_entry_id)} and status = 'INVITED'
        `;
      }
    }

    return {
      holdsReleased: holds.length,
      unitsReleased,
      products: [...products].sort(),
    };
  });
}

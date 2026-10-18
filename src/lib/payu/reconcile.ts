import { findStaleOrders, transitionOrderStatus } from './orders';
import { verifyPaymentWithPayU } from './verify';
import { logPayUEvent } from './process-response';

export interface ReconcileSummary {
  processed: number;
  markedPaid: number;
  markedFailed: number;
  markedCancelled: number;
  unchanged: number;
  errors: Array<{ txnid: string; error: string }>;
}

/**
 * Reconciles orders stuck in 'CREATED' or 'PENDING' older than staleMinutes.
 * Uses PayU's Verify Payment API as the authoritative server-to-server source.
 */
export async function reconcilePendingOrders(staleMinutes: number = 15): Promise<ReconcileSummary> {
  const staleOrders = await findStaleOrders(staleMinutes, 50);
  const summary: ReconcileSummary = {
    processed: staleOrders.length,
    markedPaid: 0,
    markedFailed: 0,
    markedCancelled: 0,
    unchanged: 0,
    errors: [],
  };

  if (staleOrders.length === 0) {
    return summary;
  }

  console.log(`[PayU Reconciliation] Found ${staleOrders.length} stale order(s) older than ${staleMinutes}m.`);

  for (const order of staleOrders) {
    try {
      const verification = await verifyPaymentWithPayU(order.txnid, order.amount);

      if (verification.verified) {
        // Payment was captured on PayU!
        const res = await transitionOrderStatus({
          txnid: order.txnid,
          targetStatus: 'PAID',
          mihpayid: verification.mihpayid,
          mode: verification.mode,
          rawResponse: verification.raw,
        });

        if (res.firstTimePaid) {
          logPayUEvent('RECONCILED: MARKED PAID & FULFILLED', {
            txnid: order.txnid,
            status: 'PAID',
            mihpayid: verification.mihpayid || undefined,
          });
        }
        summary.markedPaid++;
      } else if (verification.status === 'NOT_FOUND') {
        // Customer never completed payment on hosted checkout page
        const ageHours = (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60);
        // If older than 2 hours and not found, expire as CANCELLED
        if (ageHours >= 2) {
          await transitionOrderStatus({
            txnid: order.txnid,
            targetStatus: 'CANCELLED',
            rawResponse: { reason: 'Abandoned checkout expired after 2 hours' },
          });
          logPayUEvent('RECONCILED: EXPIRED ABANDONED ORDER', { txnid: order.txnid, status: 'CANCELLED' });
          summary.markedCancelled++;
        } else {
          summary.unchanged++;
        }
      } else if (verification.unmappedstatus === 'usercancelled') {
        await transitionOrderStatus({
          txnid: order.txnid,
          targetStatus: 'CANCELLED',
          rawResponse: verification.raw,
        });
        summary.markedCancelled++;
      } else if (verification.status === 'failure') {
        await transitionOrderStatus({
          txnid: order.txnid,
          targetStatus: 'FAILED',
          rawResponse: verification.raw,
        });
        summary.markedFailed++;
      } else {
        summary.unchanged++;
      }
    } catch (err: unknown) {
      const msg = (err as Error).message;
      summary.errors.push({ txnid: order.txnid, error: msg });
      console.error(`[PayU Reconciliation] Error processing order ${order.txnid}:`, msg);
    }
  }

  return summary;
}

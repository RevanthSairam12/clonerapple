import { readCheckoutSettings } from '@/lib/checkout/settings';
import { queueFulfilmentEvents, queueOrderEvent } from '@/lib/notifications/order-context';
import {
  autoCancelReason,
  isAutoCancelDue,
  parseAutoCancelHours,
} from '@/lib/orders/auto-cancel-rules';
import { writeAudit } from '@/lib/store-admin/audit';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

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
 *
 * `auto_cancel_unpaid_hours` from Store Admin → Orders decides when an unpaid
 * order is expired. Zero keeps the previous two-hour abandoned-checkout rule.
 * PayU is always checked first, so a captured payment is never cancelled here.
 * Cancelling releases the claimed stock once, and the automatic cancellation
 * writes an audit row.
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

  const settingsResult = await readCheckoutSettings();
  const autoCancelHours = settingsResult.ok
    ? parseAutoCancelHours(settingsResult.settings.auto_cancel_unpaid_hours)
    : 0;

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
          // Same dedupe keys as the callback path: exactly one message even
          // when both paths see the same payment.
          queueOrderEvent('payment_received', res.order, { orderStatus: 'PAID' });
          queueFulfilmentEvents(res.order, res.fulfilmentSteps);
          summary.markedPaid++;
        } else {
          summary.unchanged++;
        }
      } else if (verification.status === 'NOT_FOUND') {
        // Customer never completed payment on the hosted checkout page.
        if (!isAutoCancelDue(order.createdAt, new Date(), autoCancelHours)) {
          summary.unchanged++;
          continue;
        }

        const reason = autoCancelReason(autoCancelHours);
        const res = await transitionOrderStatus({
          txnid: order.txnid,
          targetStatus: 'CANCELLED',
          rawResponse: { reason },
          cancelReason: reason,
        });

        if (!res.transitioned) {
          summary.unchanged++;
          continue;
        }

        summary.markedCancelled++;
        if (res.stockReleased) revalidateCatalog();
        queueOrderEvent('cancelled', res.order, { orderStatus: 'CANCELLED' });
        logPayUEvent('RECONCILED: EXPIRED UNPAID ORDER', {
          txnid: order.txnid,
          status: 'CANCELLED',
        });

        await writeAudit({
          action: 'order.auto_cancel',
          entity: 'order',
          entityId: res.order.id,
          status: 'ok',
          reason: autoCancelHours > 0 ? `unpaid_after_${autoCancelHours}h` : 'abandoned_after_2h',
          after: {
            txnid: order.txnid,
            previousStatus: res.previousStatus,
            status: res.order.status,
            stockReleased: res.stockReleased,
          },
          route: '/api/payu/reconcile',
        });
      } else if (verification.unmappedstatus === 'usercancelled') {
        const res = await transitionOrderStatus({
          txnid: order.txnid,
          targetStatus: 'CANCELLED',
          rawResponse: verification.raw,
          cancelReason: 'Payment cancelled by the customer',
        });
        if (res.transitioned) {
          summary.markedCancelled++;
          if (res.stockReleased) revalidateCatalog();
          queueOrderEvent('cancelled', res.order, { orderStatus: 'CANCELLED' });
        } else {
          summary.unchanged++;
        }
      } else if (verification.status === 'failure') {
        const res = await transitionOrderStatus({
          txnid: order.txnid,
          targetStatus: 'FAILED',
          rawResponse: verification.raw,
        });
        if (res.transitioned) {
          summary.markedFailed++;
          if (res.stockReleased) revalidateCatalog();
        } else {
          summary.unchanged++;
        }
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

import type postgres from 'postgres';

import { getSql } from '@/lib/admin/db';
import {
  addMinutes,
  classifyVerification,
  MAX_CONSECUTIVE_RECONCILE_FAILURES,
  nextReconcileAt,
  parseReservationPolicy,
  recordReconcileAttempt,
  unresolvedWindowClosed,
  type PaymentOutcome,
  type ReservationPolicy,
} from '@/lib/checkout/reservation-rules';
import { readCheckoutSettings } from '@/lib/checkout/settings';
import { queueFulfilmentEvents, queueOrderEvent } from '@/lib/notifications/order-context';
import {
  autoCancelReason,
  isAutoCancelDue,
  parseAutoCancelHours,
} from '@/lib/orders/auto-cancel-rules';
import { writeAudit } from '@/lib/store-admin/audit';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

import {
  claimDueOrders,
  flagPaymentForReview,
  recordReconcileResult,
  releaseOrderReservation,
  transitionOrderStatusUsing,
  type Order,
} from './orders';
import { listPendingRefundObligations } from './refund-obligations';
import { verifyPaymentWithPayU } from './verify';
import { logPayUEvent } from './process-response';

export const UNRESOLVED_PAYMENT_REVIEW_REASON =
  'The payment outcome could not be verified within the safe recovery window. The stock claim was released; check the gateway before fulfilling or refunding.';

export interface ReconcileSummary {
  /** Orders claimed from the durable queue in this tick. */
  processed: number;
  markedPaid: number;
  markedFailed: number;
  markedCancelled: number;
  /** Ambiguous outcomes that now wait for verification. */
  markedProcessing: number;
  /** Reservations whose stock went back on the shelf this tick. */
  released: number;
  /** Orders flagged for operational review. */
  flagged: number;
  unchanged: number;
  errors: Array<{ txnid: string; error: string }>;
  pendingRefundObligations: number;
}

export type PaymentVerifier = typeof verifyPaymentWithPayU;

export interface ReconcileOptions {
  /** Legacy rows with no reservation expire after this many minutes. */
  staleMinutes?: number;
  limit?: number;
  /** Injected in tests so no network call is made. */
  verifier?: PaymentVerifier;
  /** Fixed clock for tests; the coded default is the database's now(). */
  now?: Date;
  /**
   * Connection the worker runs on. Defaults to the application pool; an
   * integration test passes a connection pinned to a throwaway schema.
   */
  sql?: postgres.Sql;
  /**
   * Set false in a throwaway-schema test: notifications, audit rows and cache
   * invalidation target the real application pool and are not part of the SQL
   * under test.
   */
  sideEffects?: boolean;
}

function emptySummary(): ReconcileSummary {
  return {
    processed: 0,
    markedPaid: 0,
    markedFailed: 0,
    markedCancelled: 0,
    markedProcessing: 0,
    released: 0,
    flagged: 0,
    unchanged: 0,
    errors: [],
    pendingRefundObligations: 0,
  };
}

async function readPolicy(): Promise<{ policy: ReservationPolicy; autoCancelHours: number }> {
  const settingsResult = await readCheckoutSettings();
  if (!settingsResult.ok) {
    return { policy: parseReservationPolicy({}), autoCancelHours: 0 };
  }
  return {
    policy: parseReservationPolicy(settingsResult.settings),
    autoCancelHours: parseAutoCancelHours(settingsResult.settings.auto_cancel_unpaid_hours),
  };
}

function nextBackoff(order: Order, now: Date): Date {
  return nextReconcileAt(order.reconcileAttempts, now);
}

/**
 * Resolve orders whose reservation or verification is due.
 *
 * The queue is durable: rows are claimed with `FOR UPDATE SKIP LOCKED` and a
 * moving lease, so a restart, a crash or a second application instance cannot
 * lose or duplicate a check. The gateway, not the browser, decides the
 * outcome; an unreachable or ambiguous answer keeps the order in PROCESSING
 * and retains its stock until the configured recovery window closes.
 */
export async function reconcilePendingOrders(
  optionsOrStaleMinutes: ReconcileOptions | number = {},
): Promise<ReconcileSummary> {
  const options: ReconcileOptions =
    typeof optionsOrStaleMinutes === 'number'
      ? { staleMinutes: optionsOrStaleMinutes }
      : optionsOrStaleMinutes;

  const { policy, autoCancelHours } = await readPolicy();
  const verifier = options.verifier ?? verifyPaymentWithPayU;
  const now = options.now ?? new Date();
  const sql = options.sql ?? getSql();
  const summary = emptySummary();

  // No DATABASE_URL: the same silent no-op `claimDueOrders` gives.
  if (!sql) return summary;

  let dueOrders: Order[] = [];
  try {
    dueOrders = await claimDueOrders(
      {
        limit: options.limit,
        leaseSeconds: 180,
        legacyStaleMinutes: options.staleMinutes ?? 15,
      },
      sql,
    );
  } catch (error: unknown) {
    summary.errors.push({ txnid: '', error: (error as Error).message });
    console.error('[PayU Reconciliation] could not claim due orders:', (error as Error).message);
    return summary;
  }

  summary.processed = dueOrders.length;
  if (dueOrders.length > 0) {
    console.log(`[PayU Reconciliation] checking ${dueOrders.length} due order(s).`);
  }

  for (const order of dueOrders) {
    try {
      await reconcileOrderUsing(sql, order, {
        policy,
        autoCancelHours,
        verifier,
        now,
        summary,
        sideEffects: options.sideEffects,
      });
    } catch (err: unknown) {
      const message = (err as Error).message;
      summary.errors.push({ txnid: order.txnid, error: message });
      summary.unchanged += 1;
      console.error(`[PayU Reconciliation] Error processing order ${order.txnid}:`, message);
      await recordReconcileResult(
        {
          txnid: order.txnid,
          nextAt: nextBackoff(order, now),
          consecutiveFailures: Math.min(
            MAX_CONSECUTIVE_RECONCILE_FAILURES,
            order.consecutiveReconcileFailures + 1,
          ),
          error: message,
        },
        sql,
      ).catch(() => {});
    }
  }

  summary.pendingRefundObligations = (await listPendingRefundObligations(500)).length;
  return summary;
}

export interface ReconcileContext {
  policy: ReservationPolicy;
  autoCancelHours: number;
  verifier: PaymentVerifier;
  now: Date;
  summary: ReconcileSummary;
  /** Set false in a throwaway-schema test (see ReconcileOptions). */
  sideEffects?: boolean;
}

/**
 * Resolve one claimed order on a caller-owned connection.
 *
 * Exported so an integration test can run the real decision tree against a
 * throwaway schema — verified success, verified failure and its grace, an
 * ambiguous payment and its review flag, a late capture with and without stock
 * — without a network call or the application pool. `reconcilePendingOrders`
 * is the production entry point and calls this for each row it leases.
 */
export async function reconcileOrderUsing(
  sql: postgres.Sql,
  order: Order,
  context: ReconcileContext,
): Promise<void> {
  const { policy, autoCancelHours, verifier, now, summary } = context;
  const sideEffects = context.sideEffects !== false;

  const verification = await verifier(order.txnid, order.amount);
  const outcome: PaymentOutcome = classifyVerification(verification);
  const attempt = recordReconcileAttempt(order.consecutiveReconcileFailures, outcome);

  if (outcome === 'paid') {
    const res = await transitionOrderStatusUsing(sql, {
      txnid: order.txnid,
      targetStatus: 'PAID',
      mihpayid: verification.mihpayid,
      mode: verification.mode,
      rawResponse: verification.raw,
      policy,
    });

    if (res.stockReclaimed && sideEffects) {
      revalidateCatalog();
    }

    if (res.firstTimePaid) {
      logPayUEvent('RECONCILED: MARKED PAID & FULFILLED', {
        txnid: order.txnid,
        status: 'PAID',
        mihpayid: verification.mihpayid || undefined,
      });
      if (sideEffects) {
        queueOrderEvent('payment_received', res.order, { orderStatus: 'PAID' });
        queueFulfilmentEvents(res.order, res.fulfilmentSteps);

        if (res.refundObligationCreated) {
          queueOrderEvent('refund_pending', res.order, {
            orderStatus: 'PAID',
            refundPaise: res.refundObligationAmountPaise,
          });
          queueOrderEvent('payment_review', res.order, {
            orderStatus: 'PAID',
            refundPaise: res.refundObligationAmountPaise,
          });
        } else if (res.paymentReviewRequired || res.couponReviewRequired) {
          queueOrderEvent('payment_review', res.order, { orderStatus: 'PAID' });
        }
      }

      if (res.paymentReviewRequired && sideEffects) {
        // The callback path writes this audit; the worker path must too.
        await writeAudit({
          action: 'payment.late_capture_review',
          entity: 'order',
          entityId: res.order.txnid,
          status: 'flagged',
          reason: 'stock_unavailable_for_reclaim',
          after: {
            previousStatus: res.previousStatus,
            status: res.order.status,
            stockReclaimed: false,
          },
          route: '/api/payu/reconcile',
        });
      }

      if (res.couponReviewRequired && sideEffects) {
        await writeAudit({
          action: 'coupon.late_restore_review',
          entity: 'order',
          entityId: res.order.txnid,
          status: 'flagged',
          reason: 'coupon_limit_unavailable_for_restore',
          after: {
            previousStatus: res.previousStatus,
            status: res.order.status,
            couponCode: res.order.couponCode,
          },
          route: '/api/payu/reconcile',
        });
      }
      summary.markedPaid += 1;
    } else {
      summary.unchanged += 1;
    }

    await recordReconcileResult(
      {
        txnid: order.txnid,
        nextAt: null,
        consecutiveFailures: 0,
      },
      sql,
    );
    return;
  }

  // A definitively failed or cancelled order may still hold its units for the
  // failure grace window. Once that window has ended, return the claim. This
  // runs after the paid branch, so a verified capture always wins first, and
  // it does not depend on the gateway answering again — a verification outage
  // must not pin stock to an order that already failed.
  if (order.status === 'FAILED' || order.status === 'CANCELLED') {
    if (order.reservationState === 'ACTIVE') {
      if (
        order.reservationExpiresAt
        && order.reservationExpiresAt.getTime() <= now.getTime()
      ) {
        const release = await releaseOrderReservation(
          {
            txnid: order.txnid,
            state: 'RELEASED',
            reason: 'payment failed; the grace window has ended',
            cancelOrder: false,
          },
          sql,
        );
        if (release.stockReleased) {
          summary.released += 1;
          if (sideEffects) revalidateCatalog();
        } else {
          summary.unchanged += 1;
        }
      } else {
        // Not due yet: wake up exactly at the grace deadline.
        await recordReconcileResult(
          {
            txnid: order.txnid,
            nextAt: order.reservationExpiresAt,
            consecutiveFailures: 0,
          },
          sql,
        );
        summary.unchanged += 1;
        return;
      }
    } else {
      summary.unchanged += 1;
    }

    await recordReconcileResult(
      {
        txnid: order.txnid,
        nextAt: null,
        consecutiveFailures: 0,
      },
      sql,
    );
    return;
  }

  if (outcome === 'failed') {
    const res = await transitionOrderStatusUsing(sql, {
      txnid: order.txnid,
      targetStatus: 'FAILED',
      rawResponse: verification.raw,
      policy,
    });
    if (res.transitioned) {
      summary.markedFailed += 1;
      if (res.stockReleased && sideEffects) revalidateCatalog();
      if (sideEffects) {
        queueOrderEvent('payment_failed', res.order, { orderStatus: 'FAILED' });
      }
    } else {
      summary.unchanged += 1;
    }
    // The transition schedules the grace release (or null for a legacy row).
    await recordReconcileResult(
      {
        txnid: order.txnid,
        nextAt: res.transitioned ? res.order.nextReconcileAt : null,
        consecutiveFailures: 0,
      },
      sql,
    );
    return;
  }

  const isProcessing = order.status === 'PROCESSING';
  const recoveryWindowClosed = unresolvedWindowClosed(order.processingDeadline, now);

  if (outcome === 'abandoned') {
    // No gateway record. For a flash-sale row this is the abandoned checkout
    // case: cancel and return the claim. For a legacy row the owner's
    // auto-cancel setting still decides.
    if (order.reservationState === 'ACTIVE') {
      const release = await releaseOrderReservation(
        {
          txnid: order.txnid,
          state: 'EXPIRED',
          reason: 'The checkout window closed before payment was confirmed.',
          cancelOrder: true,
        },
        sql,
      );
      summary.released += release.stockReleased ? 1 : 0;
      if (release.statusChanged && release.order) {
        summary.markedCancelled += 1;
        if (sideEffects) {
          revalidateCatalog();
          queueOrderEvent('reservation_expired', release.order, {
            orderStatus: 'CANCELLED',
          });
        }
      } else if (!release.order) {
        summary.unchanged += 1;
      }
      await recordReconcileResult(
        {
          txnid: order.txnid,
          nextAt: null,
          consecutiveFailures: 0,
        },
        sql,
      );
      return;
    }

    if (!isAutoCancelDue(order.createdAt, now, autoCancelHours)) {
      summary.unchanged += 1;
      await recordReconcileResult(
        {
          txnid: order.txnid,
          nextAt: addMinutes(now, 10),
          consecutiveFailures: 0,
        },
        sql,
      );
      return;
    }

    const reason = autoCancelReason(autoCancelHours);
    const res = await transitionOrderStatusUsing(sql, {
      txnid: order.txnid,
      targetStatus: 'CANCELLED',
      rawResponse: { reason },
      cancelReason: reason,
      policy,
    });
    if (!res.transitioned) {
      summary.unchanged += 1;
      await recordReconcileResult(
        { txnid: order.txnid, nextAt: null, consecutiveFailures: 0 },
        sql,
      );
      return;
    }

    summary.markedCancelled += 1;
    if (res.stockReleased && sideEffects) revalidateCatalog();
    logPayUEvent('RECONCILED: EXPIRED UNPAID ORDER', {
      txnid: order.txnid,
      status: 'CANCELLED',
    });

    if (sideEffects) {
      queueOrderEvent('cancelled', res.order, { orderStatus: 'CANCELLED' });
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
    }
    await recordReconcileResult(
      { txnid: order.txnid, nextAt: null, consecutiveFailures: 0 },
      sql,
    );
    return;
  }

  // An unresolved or pending outcome. The safe recovery window is bounded: it
  // may hold the claim, then release and flag rather than keep stock forever.
  if (isProcessing && recoveryWindowClosed) {
    const release = await releaseOrderReservation(
      {
        txnid: order.txnid,
        state: 'EXPIRED',
        reason: UNRESOLVED_PAYMENT_REVIEW_REASON,
        cancelOrder: false,
      },
      sql,
    );
    summary.released += release.stockReleased ? 1 : 0;

    await flagPaymentForReview(
      {
        txnid: order.txnid,
        reason: UNRESOLVED_PAYMENT_REVIEW_REASON,
      },
      sql,
    );
    summary.flagged += 1;

    if (release.order && sideEffects) {
      queueOrderEvent('payment_review', release.order, { orderStatus: release.order.status });
    }

    // Keep checking after the release: a late capture still transitions to
    // PAID and follows the reclaim/refund-obligation path.
    await recordReconcileResult(
      {
        txnid: order.txnid,
        nextAt: addMinutes(now, Math.max(10, policy.unresolvedMinutes)),
        consecutiveFailures: attempt.failures,
        error: verification.error,
      },
      sql,
    );
    return;
  }

  if (!isProcessing) {
    const res = await transitionOrderStatusUsing(sql, {
      txnid: order.txnid,
      targetStatus: 'PROCESSING',
      rawResponse: verification.raw,
      policy,
    });
    if (res.transitioned) {
      summary.markedProcessing += 1;
      if (sideEffects) {
        queueOrderEvent('payment_processing', res.order, { orderStatus: 'PROCESSING' });
      }
    } else {
      summary.unchanged += 1;
    }
  } else {
    summary.unchanged += 1;
  }

  if (attempt.failures > 0 && attempt.failures >= MAX_CONSECUTIVE_RECONCILE_FAILURES) {
    await flagPaymentForReview(
      {
        txnid: order.txnid,
        reason: 'Repeated gateway verification failures. Check the PayU dashboard for this transaction.',
      },
      sql,
    );
    summary.flagged += 1;
  }

  await recordReconcileResult(
    {
      txnid: order.txnid,
      nextAt: nextBackoff(order, now),
      consecutiveFailures: attempt.failures,
      error: verification.error,
    },
    sql,
  );
}

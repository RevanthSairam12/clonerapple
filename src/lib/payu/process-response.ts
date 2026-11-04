/**
 * The single authoritative processor for a PayU payment notification.
 *
 * Every path that learns something about a payment — the browser return
 * (`surl`/`furl`/`curl`), the PayU webhook, the reconciler and a staff
 * "Verify with PayU" — ends here, so the same rules decide the order status:
 *
 *   1. the reverse hash proves PayU sent the values;
 *   2. the server-to-server verify API confirms the capture;
 *   3. the transaction id, amount (in integer paise), currency and product info
 *      match the order we created;
 *   4. the gateway payment id has not already been used by another order;
 *   5. one atomic, idempotent transition moves the order.
 *
 * Nothing here trusts the browser. A hash-correct callback that fails any
 * check never marks the order paid: it is flagged for review, audited and
 * answered with a safe status page.
 */

import type postgres from 'postgres';

import {
  decideCallbackOutcome,
  parseReservationPolicy,
  type ReservationPolicy,
} from '@/lib/checkout/reservation-rules';
import { readCheckoutConfigurationUsing, readCheckoutSettings } from '@/lib/checkout/settings';
import { queueFulfilmentEvents, queueOrderEvent } from '@/lib/notifications/order-context';
import { writeAudit } from '@/lib/store-admin/audit';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

import { buildPayURedirectUrl, getPayUConfig } from './config';
import { verifyResponseHash } from './hash';
import {
  DuplicateGatewayPaymentError,
  GatewayIdentityConflictError,
  findOrderByMihpayid,
  flagPaymentForReview,
  getOrderByTxnid,
  transitionOrderStatus,
  type Order,
  type OrderStatus,
} from './orders';
import {
  formatPayUStatus,
  recordPaymentEvent,
  type PaymentEventOutcome,
  type PaymentEventSource,
} from './payment-events';
import { appendReturnToken } from './return-link';
import {
  checkPaymentIntegrity,
  checkVerificationIntegrity,
  safePaymentSummary,
  verifyPaymentWithPayU,
  type VerificationResult,
} from './verify';

export interface PayUResponseData {
  key?: string;
  txnid?: string;
  amount?: string;
  productinfo?: string;
  firstname?: string;
  email?: string;
  status?: string;
  unmappedstatus?: string;
  hash?: string;
  mihpayid?: string;
  mode?: string;
  currency?: string;
  additionalCharges?: string | null;
  error?: string;
  error_Message?: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  [key: string]: unknown;
}

export interface ProcessResult {
  /** True only when the notification was authentic and fully processed. */
  ok: boolean;
  /** True when an authentic notification was refused by a safety check. */
  rejected: boolean;
  /** True when the same request should be retried by the sender. */
  retryable: boolean;
  status: OrderStatus;
  txnid: string;
  order: Order | null;
  /** Absolute URL on the validated site base; null when the base is unusable. */
  redirectUrl: string | null;
  reason?: string;
}

export type CallbackSource = Exclude<PaymentEventSource, 'admin' | 'customer'>;

/** Injected in tests so the processor runs without a network call. */
export type PaymentVerifier = typeof verifyPaymentWithPayU;

export interface CallbackOptions {
  /**
   * Status used for the decision when PayU sends none. `curl` is normally a
   * `status=failure` + `unmappedstatus=userCancelled` callback, but some
   * flows omit both; this must never change the values the hash is checked
   * against, so it is applied after verification and only when empty.
   */
  fallbackStatus?: string;
  fallbackUnmapped?: string;
  /**
   * Connection the processor reads and writes through. Production omits it and
   * uses the application pool; an integration test pins a throwaway schema so
   * the real SQL — row lock, unique index, append-only timeline — is what runs.
   */
  sql?: postgres.Sql;
  /** Replacement for the server-to-server verify call (tests, simulator). */
  verifier?: PaymentVerifier;
  /** Reservation policy override; defaults to the store's checkout settings. */
  policy?: ReservationPolicy;
  /**
   * Set false in a throwaway-schema test: notifications, audit rows and cache
   * invalidation address process-global services rather than the schema under
   * test. The order, ledger and timeline rows are always written.
   */
  sideEffects?: boolean;
}

function sideEffectsOn(options: CallbackOptions): boolean {
  return options.sideEffects !== false;
}

/** Redacts PII from logging output. */
export function logPayUEvent(
  action: string,
  data: { txnid?: string; status?: string; mihpayid?: string; error?: string },
) {
  console.log(
    `[PayU ${action}] txnid=${data.txnid || 'N/A'} status=${data.status || 'N/A'} mihpayid=${
      data.mihpayid || 'N/A'
    }${data.error ? ` error=${data.error}` : ''}`,
  );
}

function rejection(
  order: Order | null,
  txnid: string,
  reason: string,
  options: { retryable?: boolean; page?: 'status' | 'failed' } = {},
): ProcessResult {
  const page = order && options.page !== 'failed'
    ? `/order/status?txnid=${encodeURIComponent(txnid)}`
    : `/order/failed?txnid=${encodeURIComponent(txnid)}&error=${encodeURIComponent(reason)}`;
  return {
    ok: false,
    rejected: true,
    retryable: options.retryable === true,
    status: order?.status ?? 'FAILED',
    txnid,
    order,
    redirectUrl: buildPayURedirectUrl(page)?.toString() ?? null,
    reason,
  };
}

function pageForStatus(status: OrderStatus, txnid: string): string {
  const encoded = encodeURIComponent(txnid);
  switch (status) {
    case 'PAID':
      return `/order/success?txnid=${encoded}`;
    case 'CANCELLED':
      return `/order/cancelled?txnid=${encoded}`;
    case 'PROCESSING':
      // The customer may have been debited. This page never starts a charge.
      return `/order/processing?txnid=${encoded}`;
    case 'PENDING':
    case 'CREATED':
      return `/order/status?txnid=${encoded}`;
    default:
      return `/order/failed?txnid=${encoded}`;
  }
}

/** A rejection that must be recorded on the order, the audit log and the timeline. */
export async function recordRejection(
  order: Order,
  txnid: string,
  source: PaymentEventSource,
  payuStatus: string,
  code: string,
  detail: string,
  options: CallbackOptions,
): Promise<void> {
  logPayUEvent('SECURITY ALERT: Callback Rejected', { txnid, error: `${code}: ${detail}` });

  await flagPaymentForReview({
    txnid,
    reason: `Payment notification rejected (${code}). The order was not marked paid. Check the gateway before fulfilling or refunding.`,
  }, options.sql).catch(() => false);

  if (sideEffectsOn(options)) await writeAudit({
    action: 'payment.callback_rejected',
    entity: 'order',
    entityId: txnid,
    status: 'flagged',
    reason: code,
    after: {
      source,
      payuStatus,
      orderStatus: order.status,
      detail,
    },
    route: source === 'reconcile' ? '/api/payu/reconcile'
      : source === 'webhook' ? '/api/payu/webhook' : '/api/payu/return',
  }).catch(() => null);

  await recordPaymentEvent({
    orderId: order.id,
    txnid,
    source,
    payuStatus,
    outcome: 'rejected',
    reason: code,
    sql: options.sql,
  });
}

/**
 * Everything that must happen after a transition, whichever path produced it.
 *
 * The dedupe key for a notification is the order plus the event, so a duplicate
 * callback and a concurrent reconcile tick cannot create a second message.
 */
type StatusTransition = Awaited<ReturnType<typeof transitionOrderStatus>>;

function applyTransitionEffects(transition: StatusTransition, targetStatus: OrderStatus): void {
  if (transition.firstTimePaid) {
    queueOrderEvent('payment_received', transition.order, { orderStatus: 'PAID' });
    queueFulfilmentEvents(transition.order, transition.fulfilmentSteps);

    if (transition.refundObligationCreated) {
      queueOrderEvent('refund_pending', transition.order, {
        orderStatus: 'PAID',
        refundPaise: transition.refundObligationAmountPaise,
      });
      queueOrderEvent('payment_review', transition.order, {
        orderStatus: 'PAID',
        refundPaise: transition.refundObligationAmountPaise,
      });
    } else if (transition.paymentReviewRequired || transition.couponReviewRequired) {
      queueOrderEvent('payment_review', transition.order, { orderStatus: 'PAID' });
    }
  } else if (transition.transitioned && targetStatus === 'PROCESSING') {
    queueOrderEvent('payment_processing', transition.order, { orderStatus: 'PROCESSING' });
  } else if (transition.transitioned && targetStatus === 'CANCELLED') {
    queueOrderEvent('cancelled', transition.order, { orderStatus: 'CANCELLED' });
  } else if (transition.transitioned && targetStatus === 'FAILED') {
    queueOrderEvent('payment_failed', transition.order, { orderStatus: 'FAILED' });
  }

  // A failed or cancelled callback returns a claimed unit to the shelf; a late
  // PAID callback that re-claims released units takes them off it again.
  if (transition.stockReleased || transition.stockReclaimed) revalidateCatalog();
}

/** The order status an event outcome belongs to, for the shared timeline. */
function effectStatus(status: OrderStatus): PaymentEventOutcome {
  switch (status) {
    case 'PAID':
      return 'paid';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'PENDING':
      return 'pending';
    default:
      return 'processing';
  }
}

/**
 * Authoritative processor for PayU returns, webhook notifications, the
 * reconciler and staff verification.
 */
export async function processPayUCallback(
  data: PayUResponseData,
  source: CallbackSource,
  options: CallbackOptions = {},
): Promise<ProcessResult> {
  const config = getPayUConfig();
  const txnid = (data.txnid || '').trim();
  const receivedHash = (data.hash || '').trim();
  const receivedKey = (data.key || '').trim();
  // The hash is checked over exactly what PayU sent, so an empty `status` stays
  // empty here. The fallback below only affects our own decision.
  const rawStatus = (data.status || '').trim();
  const status = rawStatus.toLowerCase();
  const unmapped = (data.unmappedstatus || '').trim().toLowerCase();
  const mihpayid = data.mihpayid ? String(data.mihpayid).trim() : null;
  const mode = data.mode ? String(data.mode).trim() : null;
  const safeStatus = safePaymentSummary(data);
  const payuStatus = formatPayUStatus(safeStatus.status, safeStatus.unmappedstatus);

  logPayUEvent(`Callback Received (${source})`, {
    txnid,
    status: payuStatus,
    mihpayid: mihpayid || undefined,
  });

  // 1. Mandatory fields. A payload without a txnid cannot be tied to an order;
  //    a payload without a hash cannot be trusted at all.
  if (!txnid || !receivedHash) {
    logPayUEvent('Tamper Warning', { txnid, error: 'Missing txnid or hash' });
    return {
      ok: false,
      rejected: true,
      retryable: !txnid,
      status: 'FAILED',
      txnid,
      order: null,
      redirectUrl: buildPayURedirectUrl('/order/failed?error=invalid_response')?.toString() ?? null,
      reason: 'Missing mandatory fields in PayU response.',
    };
  }

  // 2. Load the order. An unknown reference is answered safely, never with a
  //    stack trace or a redirect to an unvalidated host.
  const order = await getOrderByTxnid(txnid, options.sql).catch(() => null);
  if (!order) {
    logPayUEvent('Order Not Found', { txnid, error: 'Unknown txnid in database' });
    return {
      ok: false,
      rejected: true,
      retryable: false,
      status: 'FAILED',
      txnid,
      order: null,
      redirectUrl: buildPayURedirectUrl(
        `/order/failed?txnid=${encodeURIComponent(txnid)}&error=order_not_found`,
      )?.toString() ?? null,
      reason: `Order with txnid '${txnid}' does not exist.`,
    };
  }

  // 3. Cryptographic reverse-hash verification.
  const isValidHash = verifyResponseHash(receivedHash, {
    key: receivedKey || config.key,
    txnid,
    amount: (data.amount || '') as string,
    productinfo: data.productinfo || '',
    firstname: data.firstname || '',
    email: data.email || '',
    status: data.status || '',
    additionalCharges: data.additionalCharges,
    udf1: data.udf1,
    udf2: data.udf2,
    udf3: data.udf3,
    udf4: data.udf4,
    udf5: data.udf5,
    salt: config.salt,
  });

  if (!isValidHash) {
    await recordRejection(order, txnid, source, payuStatus, 'tampered_hash', 'Reverse hash mismatch.', options);
    return rejection(order, txnid, 'tampered_hash');
  }

  // 4. Merchant key must be ours.
  if (receivedKey !== config.key) {
    await recordRejection(order, txnid, source, payuStatus, 'merchant_mismatch', 'Merchant key mismatch.', options);
    return rejection(order, txnid, 'merchant_mismatch');
  }

  // 5. Trusted server-to-server confirmation. Every callback is checked, not
  //    just a "success" one: a stale failure must not beat a later capture,
  //    and an unreachable verify endpoint must never become a definitive
  //    failure. A network error leaves the claim held and the order in
  //    processing until the reconciler resolves it.
  const verification = await (options.verifier ?? verifyPaymentWithPayU)(txnid, order.amount).catch(
    () => null,
  );
  if (!verification || !verification.verified) {
    const safeStatus = safePaymentSummary(verification ? {
      status: verification.status, unmappedstatus: verification.unmappedstatus,
    } : null);
    logPayUEvent('Verify Payment API Did Not Confirm', {
      txnid,
      status: verification ? formatPayUStatus(safeStatus.status, safeStatus.unmappedstatus) : 'NO_RESULT',
      error: verification?.error ? 'Gateway verification did not confirm capture.' : undefined,
    });
  }

  // 6. Amount, currency and product info against our own order.
  const isSuccessClaim = status === 'success';
  const mismatch = checkPaymentIntegrity(order, data, isSuccessClaim)
    ?? checkVerificationIntegrity(order, verification)
    ?? (mihpayid && verification?.mihpayid && mihpayid !== verification.mihpayid
      ? { code: 'gateway_identity_mismatch', detail: 'Callback and gateway payment identities disagree.' }
      : null);
  if (mismatch) {
    await recordRejection(order, txnid, source, payuStatus, mismatch.code, mismatch.detail, options);
    return rejection(order, txnid, mismatch.code);
  }

  return settleOrder({
    order,
    source,
    data,
    verification,
    payuStatus,
    status,
    unmapped,
    mihpayid,
    mode,
    options,
  });
}

interface SettleInput {
  order: Order;
  source: PaymentEventSource;
  data: PayUResponseData;
  verification: VerificationResult | null;
  payuStatus: string;
  /** PayU's own status, lowercased. */
  status: string;
  /** PayU's own unmapped status, lowercased. */
  unmapped: string;
  mihpayid: string | null;
  mode: string | null;
  options: CallbackOptions;
}

/**
 * Steps 7 and 8 of the processor, shared by every path that already knows the
 * gateway's answer: the browser/webhook callback and a staff "Verify with PayU".
 * Keeping one copy is what makes the four entry points agree.
 */
async function settleOrder(input: SettleInput): Promise<ProcessResult> {
  const { order, source, verification, payuStatus, status, unmapped, options } = input;
  const txnid = order.txnid;

  // 7. One gateway payment attaches to one order. A replay of a capture that
  //    already belongs to a different order is refused before any write.
  const effectiveMihpayid = input.mihpayid || verification?.mihpayid || null;
  if (effectiveMihpayid) {
    const owner = await findOrderByMihpayid(effectiveMihpayid, options.sql);
    if (owner && owner.txnid !== txnid) {
      await recordRejection(
        order,
        txnid,
        source,
        payuStatus,
        'duplicate_gateway_payment',
        'The gateway payment id is already attached to another order.',
        options,
      );
      return rejection(order, txnid, 'duplicate_gateway_payment');
    }
  }

  const decision = decideCallbackOutcome({
    status: status || (options.fallbackStatus || '').toLowerCase(),
    unmappedstatus: unmapped || (options.fallbackUnmapped || '').toLowerCase(),
    verification,
    verificationError: verification?.error,
  });
  const targetStatus = decision.target as OrderStatus;

  let policy = options.policy;
  if (!policy) {
    const settingsResult = options.sql
      ? await readCheckoutConfigurationUsing(options.sql)
      : await readCheckoutSettings();
    policy = parseReservationPolicy(settingsResult.ok ? settingsResult.settings : {});
  }

  // 8. Atomic & idempotent status transition. A race between two callbacks is
  //    serialised by the row lock; a race on the mihpayid unique index is
  //    caught and answered as a duplicate, never as a crash.
  let transition;
  try {
    transition = await transitionOrderStatus({
      txnid,
      targetStatus,
      mihpayid: effectiveMihpayid,
      mode: input.mode || verification?.mode || null,
      rawResponse: safePaymentSummary(input.data),
      policy,
      preserveReservationWindow: source === 'customer',
    }, options.sql, { sideEffects: options.sideEffects });
  } catch (error: unknown) {
    if (error instanceof GatewayIdentityConflictError) {
      await recordRejection(order, txnid, source, payuStatus, 'gateway_identity_mismatch',
        'Gateway payment identity conflicts with the locked order.', options);
      return rejection(order, txnid, 'gateway_identity_mismatch');
    }
    if (error instanceof DuplicateGatewayPaymentError) {
      await recordRejection(
        order,
        txnid,
        source,
        payuStatus,
        'duplicate_gateway_payment',
        'The gateway payment id is already attached to another order.',
        options,
      );
      return rejection(order, txnid, 'duplicate_gateway_payment');
    }
    throw error;
  }

  if (transition.firstTimePaid) {
    logPayUEvent('FULFILLMENT TRIGGERED', {
      txnid,
      status: 'PAID',
      mihpayid: effectiveMihpayid || undefined,
    });
  }
  if (sideEffectsOn(options)) applyTransitionEffects(transition, targetStatus);

  // The customer's page must show what the order actually is. A duplicate,
  // stale or lower-priority callback is a no-op in the transition, so its
  // requested target can sit behind the stored status (a late failure callback
  // for a PAID order, for example); redirecting by the target would show a
  // failure page for a paid order.
  const effectiveStatus = transition.order.status;

  const eventOutcome: PaymentEventOutcome = transition.transitioned || transition.firstTimePaid
    ? effectStatus(effectiveStatus)
    : 'unchanged';

  await recordPaymentEvent({
    orderId: transition.order.id,
    txnid,
    source,
    payuStatus,
    outcome: eventOutcome,
    reason: transition.transitioned
      ? decision.reason
      : `No change; order is ${effectiveStatus}.`,
    sql: options.sql,
  });

  const path = pageForStatus(effectiveStatus, txnid);
  // Only the browser return carries a signed link: the webhook and the worker
  // send a response to a server, not a person.
  const withToken = source === 'redirect' ? appendReturnToken(path, txnid) : path;

  return {
    ok: true,
    rejected: false,
    retryable: false,
    status: effectiveStatus,
    txnid,
    order: transition.order,
    redirectUrl: buildPayURedirectUrl(withToken)?.toString() ?? null,
    reason: decision.reason,
  };
}

/**
 * A staff-initiated "Verify with PayU".
 *
 * There is no callback payload, so there is no reverse hash to check; the
 * server-to-server verification is the only evidence, and it is exactly the
 * same evidence a callback needs. The same amount, duplicate-payment and
 * transition rules then apply, and the outcome is written to the payment
 * timeline with `source = 'admin'`.
 *
 * It never marks an order paid on a mismatch: it flags the order for review
 * through the same `recordRejection` path as a bad callback.
 */
export async function verifyOrderWithPayU(
  txnid: string,
  options: CallbackOptions = {},
): Promise<ProcessResult> {
  return verifyExistingOrderWithPayU(txnid, 'admin', options);
}

/** Trusted gateway check shared by staff and authenticated customer recovery. */
export async function verifyExistingOrderWithPayU(
  txnid: string,
  source: 'admin' | 'customer',
  options: CallbackOptions = {},
): Promise<ProcessResult> {
  const key = (txnid || '').trim();
  if (!key) {
    return {
      ok: false,
      rejected: true,
      retryable: false,
      status: 'FAILED',
      txnid: '',
      order: null,
      redirectUrl: null,
      reason: 'Which order?',
    };
  }

  const order = await getOrderByTxnid(key, options.sql).catch(() => null);
  if (!order) {
    return {
      ok: false,
      rejected: false,
      retryable: false,
      status: 'FAILED',
      txnid: key,
      order: null,
      redirectUrl: null,
      reason: 'Order not found.',
    };
  }

  // A final state cannot be rewritten by a staff click, and an authentic
  // capture is the only thing that may move the order. Reading the gateway is
  // still useful for a PAID order (it proves the capture), so this only
  // refuses to re-open a settled order that the gateway does not confirm.
  const verification = await (options.verifier ?? verifyPaymentWithPayU)(key, order.amount).catch(() => null);
  const safeStatus = safePaymentSummary(verification ? { status: verification.status, unmappedstatus: verification.unmappedstatus } : null);
  const payuStatus = formatPayUStatus(safeStatus.status, safeStatus.unmappedstatus);
  const status = String(verification?.status ?? '').trim().toLowerCase();
  const unmapped = String(verification?.unmappedstatus ?? '').trim().toLowerCase();
  const data: PayUResponseData = {
    txnid: key,
    amount: verification?.amount ?? undefined,
    currency: order.currency,
    status: verification?.status,
    mihpayid: verification?.mihpayid ?? undefined,
    mode: verification?.mode ?? undefined,
  };

  const mismatch = checkVerificationIntegrity(order, verification);
  if (mismatch) {
    await recordRejection(order, key, source, payuStatus, mismatch.code, mismatch.detail, options);
    return rejection(order, key, mismatch.code);
  }

  const result = await settleOrder({
    order,
    source,
    data,
    verification,
    payuStatus,
    status,
    unmapped,
    mihpayid: verification?.mihpayid ?? null,
    mode: verification?.mode ?? null,
    options,
  });
  const verificationUnavailable = !verification
    || ['UNKNOWN', 'NETWORK_ERROR'].includes(String(verification.status).toUpperCase());
  return { ...result, retryable: result.status !== 'PAID' && verificationUnavailable };
}

/**
 * Run a callback and turn it into the one HTTP answer every return route sends:
 * a 303 to an absolute URL on the validated base.
 *
 * When `APP_BASE_URL` is missing the payment is still processed, but there is
 * no safe address to send the browser to, so a plain, safe page is returned
 * instead of a broken redirect. The message names the configuration gap so an
 * operator can fix it; it never contains a secret or gateway response.
 */
export async function respondToPayUCallback(
  data: PayUResponseData,
  source: CallbackSource,
): Promise<{ result: ProcessResult; location: URL | null }> {
  const result = await processPayUCallback(data, source);
  const location = result.redirectUrl ? new URL(result.redirectUrl) : null;
  return { result, location };
}

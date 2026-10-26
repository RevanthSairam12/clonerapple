import {
  decideCallbackOutcome,
  parseReservationPolicy,
} from '@/lib/checkout/reservation-rules';
import { readCheckoutSettings } from '@/lib/checkout/settings';
import { queueFulfilmentEvents, queueOrderEvent } from '@/lib/notifications/order-context';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

import { getPayUConfig } from './config';
import { verifyResponseHash } from './hash';
import { getOrderByTxnid, transitionOrderStatus, Order, OrderStatus } from './orders';
import { verifyPaymentWithPayU } from './verify';

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
  ok: boolean;
  status: OrderStatus;
  txnid: string;
  order: Order | null;
  redirectUrl: string;
  reason?: string;
}

/**
 * Redacts PII from logging output.
 */
export function logPayUEvent(action: string, data: { txnid?: string; status?: string; mihpayid?: string; error?: string }) {
  console.log(`[PayU ${action}] txnid=${data.txnid || 'N/A'} status=${data.status || 'N/A'} mihpayid=${data.mihpayid || 'N/A'}${data.error ? ` error=${data.error}` : ''}`);
}

/**
 * Authoritative processor for PayU returns (surl/furl/curl) and Webhook notifications.
 */
export async function processPayUCallback(data: PayUResponseData, source: 'return' | 'webhook'): Promise<ProcessResult> {
  const config = getPayUConfig();
  const txnid = (data.txnid || '').trim();
  const receivedHash = (data.hash || '').trim();
  const receivedAmountStr = (data.amount || '').trim();
  const receivedKey = (data.key || '').trim();
  const status = (data.status || '').toLowerCase().trim();
  const unmapped = (data.unmappedstatus || '').toLowerCase().trim();
  const mihpayid = data.mihpayid ? String(data.mihpayid).trim() : null;
  const mode = data.mode ? String(data.mode).trim() : null;

  logPayUEvent(`Callback Received (${source})`, {
    txnid,
    status: `${status}/${unmapped}`,
    mihpayid: mihpayid || undefined,
  });

  // 1. Validate mandatory fields
  if (!txnid || !receivedHash) {
    logPayUEvent('Tamper Warning', { txnid, error: 'Missing txnid or hash' });
    return {
      ok: false,
      status: 'FAILED',
      txnid,
      order: null,
      redirectUrl: '/order/failed?error=invalid_response',
      reason: 'Missing mandatory fields in PayU response.',
    };
  }

  // 2. Load Order from DB first
  const order = await getOrderByTxnid(txnid);
  if (!order) {
    logPayUEvent('Order Not Found', { txnid, error: 'Unknown txnid in database' });
    return {
      ok: false,
      status: 'FAILED',
      txnid,
      order: null,
      redirectUrl: '/order/failed?error=order_not_found',
      reason: `Order with txnid '${txnid}' does not exist.`,
    };
  }

  // 3. Cryptographic reverse-hash verification
  const isValidHash = verifyResponseHash(receivedHash, {
    key: receivedKey || config.key,
    txnid,
    amount: receivedAmountStr,
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
    logPayUEvent('SECURITY ALERT: Reverse Hash Mismatch', { txnid, error: 'Cryptographic reverse hash verification failed' });
    return {
      ok: false,
      status: order.status,
      txnid,
      order,
      redirectUrl: `/order/failed?txnid=${encodeURIComponent(txnid)}&error=tampered_hash`,
      reason: 'Reverse hash signature verification failed. Potential tampering.',
    };
  }

  // 4. Validate Key and Amount against stored Order
  if (receivedKey !== config.key) {
    logPayUEvent('SECURITY ALERT: Merchant Key Mismatch', { txnid, error: `Key '${receivedKey}' does not match server key` });
    return {
      ok: false,
      status: order.status,
      txnid,
      order,
      redirectUrl: `/order/failed?txnid=${encodeURIComponent(txnid)}&error=merchant_mismatch`,
      reason: 'Merchant key mismatch.',
    };
  }

  const orderAmountStr = order.amount.toFixed(2);
  const parsedReceivedAmt = parseFloat(receivedAmountStr || '0').toFixed(2);
  if (orderAmountStr !== parsedReceivedAmt) {
    logPayUEvent('SECURITY ALERT: Amount Mismatch', {
      txnid,
      error: `Expected amount ${orderAmountStr}, received ${parsedReceivedAmt}`,
    });
    return {
      ok: false,
      status: order.status,
      txnid,
      order,
      redirectUrl: `/order/failed?txnid=${encodeURIComponent(txnid)}&error=amount_mismatch`,
      reason: `Amount mismatch: expected ${orderAmountStr}, received ${parsedReceivedAmt}.`,
    };
  }

  // 5. Trusted server-to-server confirmation. Every callback is checked, not
  //    just a "success" one: a stale failure must not beat a later capture,
  //    and an unreachable verify endpoint must never become a definitive
  //    failure. A network error leaves the claim held and the order in
  //    processing until the reconciler resolves it.
  const verification = await verifyPaymentWithPayU(txnid, order.amount);
  if (!verification.verified) {
    logPayUEvent('Verify Payment API Did Not Confirm', {
      txnid,
      status: `${verification.status}/${verification.unmappedstatus}`,
      error: verification.error,
    });
  }

  const decision = decideCallbackOutcome({
    status,
    unmappedstatus: unmapped,
    verification,
    verificationError: verification.error,
  });
  const targetStatus = decision.target as OrderStatus;

  const settingsResult = await readCheckoutSettings();
  const policy = parseReservationPolicy(
    settingsResult.ok ? settingsResult.settings : {},
  );

  // 6. Atomic & idempotent status transition
  const transition = await transitionOrderStatus({
    txnid,
    targetStatus,
    mihpayid: mihpayid || verification.mihpayid,
    mode: mode || verification.mode,
    rawResponse: data,
    policy,
  });

  if (transition.firstTimePaid) {
    logPayUEvent('FULFILLMENT TRIGGERED', { txnid, status: 'PAID', mihpayid: mihpayid || undefined });
    // The dedupe key is the order and event, so duplicate callbacks and a
    // concurrent reconcile run cannot create a second message.
    queueOrderEvent('payment_received', transition.order, { orderStatus: 'PAID' });
    queueFulfilmentEvents(transition.order, transition.fulfilmentSteps);

    if (transition.refundObligationCreated) {
      // The money was captured but the units are gone. The obligation row is
      // the durable record; these messages tell the customer and staff what
      // happens next without ever claiming the refund is complete.
      queueOrderEvent('refund_pending', transition.order, {
        orderStatus: 'PAID',
        refundPaise: transition.refundObligationAmountPaise,
      });
      queueOrderEvent('payment_review', transition.order, {
        orderStatus: 'PAID',
        refundPaise: transition.refundObligationAmountPaise,
      });
    } else if (transition.paymentReviewRequired) {
      queueOrderEvent('payment_review', transition.order, { orderStatus: 'PAID' });
    }
  } else if (transition.transitioned && targetStatus === 'PROCESSING') {
    // Repeat PROCESSING decisions are no-ops above, so this is sent once per
    // order; the dedupe key protects concurrent callback/reconcile races too.
    queueOrderEvent('payment_processing', transition.order, { orderStatus: 'PROCESSING' });
  } else if (transition.transitioned && targetStatus === 'CANCELLED') {
    queueOrderEvent('cancelled', transition.order, { orderStatus: 'CANCELLED' });
  } else if (transition.transitioned && targetStatus === 'FAILED') {
    queueOrderEvent('payment_failed', transition.order, { orderStatus: 'FAILED' });
  }

  // A failed or cancelled callback returns a claimed unit to the shelf; a late
  // PAID callback that re-claims released units takes them off it again.
  if (transition.stockReleased || transition.stockReclaimed) revalidateCatalog();

  // The customer's page must show what the order actually is. A duplicate,
  // stale or lower-priority callback is a no-op in the transition, so its
  // requested target can sit behind the stored status (a late failure callback
  // for a PAID order, for example); redirecting by the target would show a
  // failure page for a paid order.
  const effectiveStatus = transition.order.status;

  let redirectUrl: string;
  if (effectiveStatus === 'PAID') {
    redirectUrl = `/order/success?txnid=${encodeURIComponent(txnid)}`;
  } else if (effectiveStatus === 'CANCELLED') {
    redirectUrl = `/order/cancelled?txnid=${encodeURIComponent(txnid)}`;
  } else if (effectiveStatus === 'PROCESSING') {
    // The customer may have been debited. This page never starts a charge and
    // tells them not to pay again while the transaction is checked.
    redirectUrl = `/order/processing?txnid=${encodeURIComponent(txnid)}`;
  } else if (effectiveStatus === 'PENDING' || effectiveStatus === 'CREATED') {
    // There is no /order/pending route; /order/status is the page that renders
    // an unanswered payment and its timeline.
    redirectUrl = `/order/status?txnid=${encodeURIComponent(txnid)}`;
  } else {
    redirectUrl = `/order/failed?txnid=${encodeURIComponent(txnid)}`;
  }

  return {
    ok: true,
    status: effectiveStatus,
    txnid,
    order: transition.order,
    redirectUrl,
    reason: decision.reason,
  };
}

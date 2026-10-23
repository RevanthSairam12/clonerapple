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

  // 5. Determine target status
  let targetStatus: OrderStatus;
  if (status === 'success' && unmapped === 'captured') {
    // 6. Server-to-server confirmation via Verify Payment API
    const verification = await verifyPaymentWithPayU(txnid, order.amount);
    if (!verification.verified) {
      logPayUEvent('Verify Payment API Failed', {
        txnid,
        error: verification.error || 'Server-to-server verification did not confirm captured payment',
      });
      // Do not mark PAID if PayU server verification fails
      return {
        ok: false,
        status: order.status,
        txnid,
        order,
        redirectUrl: `/order/failed?txnid=${encodeURIComponent(txnid)}&error=verification_failed`,
        reason: 'Server-to-server verification failed.',
      };
    }
    targetStatus = 'PAID';
  } else if (status === 'pending') {
    targetStatus = 'PENDING';
  } else if (unmapped === 'usercancelled') {
    targetStatus = 'CANCELLED';
  } else {
    targetStatus = 'FAILED';
  }

  // 7. Atomic & idempotent status transition
  const transition = await transitionOrderStatus({
    txnid,
    targetStatus,
    mihpayid,
    mode,
    rawResponse: data,
  });

  if (transition.firstTimePaid) {
    logPayUEvent('FULFILLMENT TRIGGERED', { txnid, status: 'PAID', mihpayid: mihpayid || undefined });
    // Trigger one-time order fulfillment (emails, inventory decrement, access grant)
  }

  // Determine redirect URL
  let redirectUrl: string;
  if (targetStatus === 'PAID') {
    redirectUrl = `/order/success?txnid=${encodeURIComponent(txnid)}`;
  } else if (targetStatus === 'CANCELLED') {
    redirectUrl = `/order/cancelled?txnid=${encodeURIComponent(txnid)}`;
  } else if (targetStatus === 'PENDING') {
    // There is no /order/pending route; /order/status is the page that renders
    // a pending payment and its timeline.
    redirectUrl = `/order/status?txnid=${encodeURIComponent(txnid)}`;
  } else {
    redirectUrl = `/order/failed?txnid=${encodeURIComponent(txnid)}`;
  }

  return {
    ok: targetStatus === 'PAID' || targetStatus === 'PENDING',
    status: targetStatus,
    txnid,
    order: transition.order,
    redirectUrl,
  };
}

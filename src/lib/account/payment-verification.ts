import { getOrderByTxnid } from '@/lib/payu/orders';
import { verifyExistingOrderWithPayU } from '@/lib/payu/process-response';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { writeAudit } from '@/lib/store-admin/audit';

const dependencies = { getOrderByTxnid, verifyExistingOrderWithPayU, checkRateLimit, writeAudit };

/** Authentication and origin are checked by the route; ownership precedes PayU. */
export async function checkCustomerPayment(
  userId: string,
  txnid: string,
  request: Request,
  deps: typeof dependencies = dependencies,
): Promise<{ status: number; body: Record<string, unknown>; retryAfter?: number }> {
  const key = txnid.trim();
  if (!key || key.length > 100) return { status: 404, body: { error: 'Order not found.' } };

  const order = await deps.getOrderByTxnid(key);
  if (!order || order.userId !== userId) {
    return { status: 404, body: { error: 'Order not found.' } };
  }
  // Do not contact the gateway or emit notifications again for a settled order.
  if (order.status === 'PAID') return { status: 200, body: { ok: true, status: 'PAID', retryable: false } };

  for (const [bucket, limit, windowMs] of [
    [`customer-payment-check:${userId}`, 10, 60_000],
    [`customer-payment-order:${userId}:${key}`, 1, 15_000],
  ] as const) {
    const result = deps.checkRateLimit(bucket, { limit, windowMs });
    if (!result.allowed) return {
      status: 429,
      body: { error: 'Please wait a moment before checking this payment again.' },
      retryAfter: result.retryAfterSec,
    };
  }

  const result = await deps.verifyExistingOrderWithPayU(key, 'customer');
  await deps.writeAudit({
    action: 'payment.customer_verify', entity: 'order', entityId: key,
    status: result.rejected ? 'flagged' : result.retryable ? 'unavailable' : 'ok',
    reason: result.rejected ? 'verification_rejected' : result.retryable ? 'verification_unavailable' : 'gateway_checked',
    // Never put customer identities or gateway text in the staff audit.
    after: { orderStatus: result.status, source: 'customer' }, request,
  });
  if (!result.order) return { status: 503, body: { error: 'Payment status is temporarily unavailable. Please try again shortly.' } };
  if (result.rejected) return { status: 409, body: { error: 'This payment needs review. Do not pay again; contact the store.', status: result.status } };
  if (result.retryable) return { status: 503, body: { error: 'We could not confirm your payment yet. Please try again shortly. Do not pay again.', status: result.status, retryable: true } };
  return { status: 200, body: { ok: true, status: result.status, retryable: false } };
}

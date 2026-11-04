import type { DocumentState } from './document-policy';

export type OrderResultKind = 'success' | 'verifying' | 'failed' | 'cancelled' | 'refund';
export interface OrderResultState {
  kind: OrderResultKind;
  title: string;
  message: string;
  amountLabel: string;
  canRetry: boolean;
  canCheck: boolean;
  confirmedActiveOrder: boolean;
}

/** The URL is deliberately not an input: only persisted, authorized facts decide the copy. */
export function customerOrderResult(
  state: DocumentState,
  paymentReviewRequired: boolean,
  reservationState: string,
): OrderResultState {
  const base = { canRetry: false, canCheck: false, confirmedActiveOrder: false };
  if (paymentReviewRequired || state.paymentStatus === 'PROCESSING') {
    return { ...base, kind: 'verifying', title: 'We are checking your payment',
      message: 'Payment is not confirmed yet. If your bank shows a debit, do not pay again while this transaction is being checked.',
      amountLabel: 'Order amount', canCheck: true };
  }
  if (state.refundStatus !== 'NONE' || state.refundedPaise > 0 || state.pendingRefundPaise > 0) {
    const message = state.pendingRefundPaise > 0
      ? 'A refund has been initiated. It is not confirmed as completed yet.'
      : state.refundedPaise > 0
        ? (state.refundedPaise >= state.capturedPaise ? 'Your payment has been refunded.' : 'Part of your payment has been refunded.')
        : 'The refund has not completed. View your order summary for the latest update.';
    return { ...base, kind: 'refund', title: state.label, message, amountLabel: 'Order amount' };
  }
  if (state.orderStatus === 'CANCELLED' && state.capturedPaise > 0) {
    return { ...base, kind: 'cancelled', title: 'Order cancelled',
      message: state.refundDuePaise > 0
        ? 'Payment was received, but this order is cancelled. A refund is due and has not been initiated yet. Do not pay again for this order.'
        : 'Payment was received, but this order is cancelled. Check your order summary for refund updates; do not pay again for this order.',
      amountLabel: 'Amount received' };
  }
  const settled = state.paymentSettled === true && state.paymentStatus === 'PAID' && state.totalPaise > 0
    && state.capturedPaise >= state.totalPaise;
  const activeOrder = ['PENDING', 'ACCEPTED', 'PROCESSING', 'SCHEDULED', 'ON_THE_WAY', 'DELIVERED'].includes(state.orderStatus);
  if (settled && state.label === 'Paid' && activeOrder && state.orderStatus !== 'CANCELLED' && state.refundDuePaise === 0) {
    return { ...base, kind: 'success', title: 'Order successful',
      message: 'Your payment is confirmed. View your order summary for the latest updates.',
      amountLabel: 'Amount paid', confirmedActiveOrder: true };
  }
  // A recorded capture or an unconfirmed PAID row must never offer repayment.
  if (state.capturedPaise === 0 && (state.paymentStatus === 'FAILED' || state.paymentStatus === 'CANCELLED')) {
    const cancelled = state.paymentStatus === 'CANCELLED';
    const expired = cancelled && reservationState === 'EXPIRED';
    return { ...base, kind: cancelled ? 'cancelled' : 'failed',
      title: expired ? 'Your reservation expired' : cancelled ? 'Checkout was cancelled' : 'Payment could not be completed',
      message: 'No successful payment is confirmed for this checkout. If your bank shows a debit, contact us before paying again. Otherwise, you can start a new checkout.',
      amountLabel: 'Attempted amount', canRetry: true };
  }
  return { ...base, kind: 'verifying', title: 'Payment not confirmed',
    message: 'We do not have a confirmed payment for this order yet. If your bank shows a debit, do not pay again. Check the status before starting another checkout.',
    amountLabel: 'Order amount', canCheck: true };
}

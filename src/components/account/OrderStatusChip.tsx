import {
  accountOrderStatusLabel,
  type AccountOrderStatus,
} from '@/lib/account/order-live';
import {
  derivePaymentAndOrderStatus,
  type CanonicalOrderStatus,
  type CanonicalPaymentStatus,
} from '@/lib/orders/document-policy';

const TONE: Record<AccountOrderStatus, string> = {
  PENDING: 'bg-[#f5f5f7] text-[#1d1d1f]',
  ACCEPTED: 'bg-[#e8f3ff] text-[#0066cc]',
  PROCESSING: 'bg-[#e8f3ff] text-[#0066cc]',
  SCHEDULED: 'bg-[#e8f3ff] text-[#0066cc]',
  ON_THE_WAY: 'bg-[#fff4e5] text-[#8a5300]',
  DELIVERED: 'bg-[#ecfdf3] text-[#067647]',
  CANCELED: 'bg-red-50 text-[#b42318]',
  PAYMENT_FAILED: 'bg-red-50 text-[#b42318]',
  REFUNDED: 'bg-[#f5f5f7] text-[#6e6e73]',
};

const PAYMENT_TONE: Record<CanonicalPaymentStatus, string> = {
  PENDING: 'bg-[#fff4e5] text-[#8a5300]',
  VERIFYING: 'bg-[#e8f3ff] text-[#0066cc]',
  PAID: 'bg-[#ecfdf3] text-[#067647]',
  FAILED: 'bg-red-50 text-[#b42318]',
  CANCELLED: 'bg-red-50 text-[#b42318]',
  REFUND_INITIATED: 'bg-[#fff4e5] text-[#8a5300]',
  PARTIALLY_REFUNDED: 'bg-[#f5f5f7] text-[#333336]',
  REFUNDED: 'bg-[#f5f5f7] text-[#333336]',
};

const ORDER_TONE: Record<CanonicalOrderStatus, string> = {
  AWAITING_PAYMENT: 'bg-[#f5f5f7] text-[#1d1d1f]',
  CONFIRMED: 'bg-[#e8f3ff] text-[#0066cc]',
  PACKED: 'bg-[#e8f3ff] text-[#0066cc]',
  SHIPPED: 'bg-[#fff4e5] text-[#8a5300]',
  DELIVERED: 'bg-[#ecfdf3] text-[#067647]',
  CANCELLED: 'bg-red-50 text-[#b42318]',
  RETURNED: 'bg-[#f5f5f7] text-[#333336]',
};

/**
 * The one customer-safe status chip. The label always comes from the shared
 * vocabulary in `order-live.ts`, never from a raw database token.
 */
export function OrderStatusChip({ status }: { status: AccountOrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${TONE[status]}`}>
      {accountOrderStatusLabel(status)}
    </span>
  );
}

/**
 * Renders separate Payment status and Order status chips from the single
 * shared status glossary.
 */
export function PaymentAndOrderStatusChips({
  paymentStatus,
  orderProgress,
  refundCount,
}: {
  paymentStatus: string;
  orderProgress?: string;
  refundCount?: number;
}) {
  const derived = derivePaymentAndOrderStatus({
    paymentStatus,
    fulfilmentStatus: orderProgress,
    refundCount,
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${PAYMENT_TONE[derived.paymentStatusKey]}`}
        data-status-domain="payment"
      >
        Payment: {derived.paymentStatusLabel}
      </span>
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${ORDER_TONE[derived.orderStatusKey]}`}
        data-status-domain="order"
      >
        Order: {derived.orderStatusLabel}
      </span>
    </span>
  );
}
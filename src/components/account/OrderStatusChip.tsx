import {
  accountOrderStatusLabel,
  type AccountOrderStatus,
} from '@/lib/account/order-live';

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
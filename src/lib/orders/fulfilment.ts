import { FULFILMENT_STEPS } from '@/lib/store-admin/order-rules';

export interface FulfilmentHistory {
  domain?: unknown;
  toStatus?: unknown;
  to_status?: unknown;
}

/** A prepared label/tracking number is not evidence that a parcel was collected. */
export function hasShipmentStarted(status: unknown, history: readonly FulfilmentHistory[] = []): boolean {
  const collected = (value: unknown) => value === 'ON_THE_WAY' || value === 'DELIVERED';
  return collected(status) || history.some((entry) =>
    entry.domain === 'fulfilment' && collected(entry.toStatus ?? entry.to_status));
}

/** Fulfilment only: never use these labels for a payment PROCESSING state. */
export function fulfilmentLabel(status: unknown, method?: unknown): string {
  switch (status) {
    case 'PENDING': return 'Pending';
    case 'ACCEPTED': return 'Accepted';
    case 'PROCESSING': return 'Preparing';
    case 'ON_THE_WAY': return method === 'self' ? 'Dispatched / Out for delivery' : 'Pickup done / In transit';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELED': return 'Canceled';
    default: return 'Awaiting fulfilment update';
  }
}

export { FULFILMENT_STEPS };

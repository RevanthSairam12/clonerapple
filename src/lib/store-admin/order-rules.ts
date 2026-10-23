/** Pure order rules for database-free tests and UI labels. */

export type FulfilmentStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELED';

export type SaleState =
  | 'REFUNDED'
  | 'PAYMENT_FAILED'
  | 'CANCELED'
  | 'DELIVERED'
  | 'ON_THE_WAY'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'ACCEPTED'
  | 'PENDING';

export const FULFILMENT_TRANSITIONS: Readonly<Record<FulfilmentStatus, readonly FulfilmentStatus[]>> = {
  PENDING: ['ACCEPTED', 'CANCELED'],
  ACCEPTED: ['PROCESSING', 'CANCELED'],
  PROCESSING: ['ON_THE_WAY', 'CANCELED'],
  ON_THE_WAY: ['DELIVERED', 'CANCELED'],
  DELIVERED: [],
  CANCELED: [],
};

export function canTransitionFulfilment(from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  return FULFILMENT_TRANSITIONS[from].includes(to);
}

export function mapSaleState(input: {
  paymentStatus?: unknown;
  fulfilmentStatus?: unknown;
  scheduledFor?: unknown;
  refundCount?: unknown;
}): SaleState {
  const paymentStatus = String(input.paymentStatus ?? '').toUpperCase();
  const fulfilmentStatus = String(input.fulfilmentStatus ?? '').toUpperCase();
  if (Number(input.refundCount ?? 0) > 0) return 'REFUNDED';
  if (paymentStatus === 'FAILED') return 'PAYMENT_FAILED';
  if (paymentStatus === 'CANCELLED' || fulfilmentStatus === 'CANCELED') return 'CANCELED';
  if (fulfilmentStatus === 'DELIVERED') return 'DELIVERED';
  if (fulfilmentStatus === 'ON_THE_WAY') return 'ON_THE_WAY';
  if (fulfilmentStatus === 'PROCESSING') return 'PROCESSING';
  if (input.scheduledFor && (fulfilmentStatus === 'PENDING' || fulfilmentStatus === 'ACCEPTED')) return 'SCHEDULED';
  if (fulfilmentStatus === 'ACCEPTED') return 'ACCEPTED';
  return 'PENDING';
}

export function validateTrackingUrl(value: string | null | undefined): string | null {
  const candidate = (value ?? '').trim();
  if (!candidate || candidate.length > 2048) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

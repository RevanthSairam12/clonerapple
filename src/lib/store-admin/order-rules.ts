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

/** Forward milestones; cancellation is a separate terminal action. */
export const FULFILMENT_STEPS: readonly FulfilmentStatus[] = [
  'PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED',
];

export function canTransitionFulfilment(from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  return FULFILMENT_TRANSITIONS[from].includes(to);
}

export function mapSaleState(input: {
  paymentStatus?: unknown;
  fulfilmentStatus?: unknown;
  scheduledFor?: unknown;
  refundCount?: unknown;
  refunded?: boolean;
}): SaleState {
  const paymentStatus = String(input.paymentStatus ?? '').toUpperCase();
  const fulfilmentStatus = String(input.fulfilmentStatus ?? '').toUpperCase();
  if (input.refunded || Number(input.refundCount ?? 0) > 0) return 'REFUNDED';
  // An unconfirmed payment is its own state: it is not "awaiting payment"
  // (PENDING) and must never look like a captured sale.
  if (paymentStatus === 'PROCESSING') return 'PROCESSING';
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

export type OrderTestFilter = 'all' | 'live' | 'test';

export function parseOrderTestFilter(value: unknown): OrderTestFilter {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'live' || normalized === 'test') return normalized;
  return 'all';
}

export function validateTestOrderReason(
  value: unknown,
): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 3) {
    return { ok: false, error: 'Give a reason of at least 3 characters.' };
  }
  if (reason.length > 200) {
    return { ok: false, error: 'Reason must be 200 characters or fewer.' };
  }
  return { ok: true, reason };
}

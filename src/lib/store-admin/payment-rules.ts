/** Pure rules for manual (offline) payments: database-free and shared with
 * the POS till UI and the order detail page. */

export const MANUAL_METHODS = ['cash', 'upi', 'bank_transfer', 'cod', 'other'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];

function isManualMethod(value: unknown): value is ManualMethod {
  return (
    typeof value === 'string' && (MANUAL_METHODS as readonly string[]).includes(value)
  );
}

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A store admin (not the owner) may mark at most Rs 50,000 paid per entry. */
export const ADMIN_MAX_MARK_PAID_PAISE = 50_000 * 100;

export const METHOD_LABELS: Record<ManualMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cod: 'Cash on delivery',
  other: 'Other',
};

/** Every method an `order_payments` row can carry, including POS card machine. */
export type AnyPaymentMethod = ManualMethod | 'card_machine';

export const ANY_METHOD_LABELS: Record<AnyPaymentMethod, string> = {
  ...METHOD_LABELS,
  card_machine: 'Card machine',
};

export type PaymentValidation =
  | { ok: true; amountPaise: number; providerRef: string | null; notes: string }
  | { ok: false; code: 'invalid-input' | 'limit-exceeded' | 'ref-required'; error: string };

/** Validate a manual payment entry before it reaches the database. */
export function validateManualPayment(input: {
  method: unknown;
  amountPaise: unknown;
  providerRef: unknown;
  notes: unknown;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
}): PaymentValidation {
  if (!isManualMethod(input.method)) {
    return { ok: false, code: 'invalid-input', error: 'Unsupported payment method.' };
  }
  const amountPaise = Math.trunc(Number(input.amountPaise));
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return { ok: false, code: 'invalid-input', error: 'Amount must be a positive number of paise.' };
  }
  if (input.role !== 'store_owner' && amountPaise > ADMIN_MAX_MARK_PAID_PAISE) {
    return {
      ok: false,
      code: 'limit-exceeded',
      error: 'Admins can mark at most Rs 50,000 per entry. Ask the owner for larger amounts.',
    };
  }
  const providerRef =
    typeof input.providerRef === 'string' ? input.providerRef.trim() : null;
  if ((input.method === 'upi' || input.method === 'bank_transfer') && !providerRef) {
    return {
      ok: false,
      code: 'ref-required',
      error: 'UPI and bank transfer entries need a transaction reference.',
    };
  }
  const notes =
    typeof input.notes === 'string' ? input.notes.trim().slice(0, 300) : '';
  return { ok: true, amountPaise, providerRef, notes };
}

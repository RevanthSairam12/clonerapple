/** Pure POS rules: totals, receipt numbers, shift maths and void rules. */

export type PosPaymentMethod = 'cash' | 'upi' | 'card_machine';

export const POS_METHODS: readonly PosPaymentMethod[] = ['cash', 'upi', 'card_machine'];

export function isPosMethod(value: unknown): value is PosPaymentMethod {
  return typeof value === 'string' && (POS_METHODS as readonly string[]).includes(value);
}

export interface PosCartLine {
  id: string;
  quantity: number;
}

/** Quantity rule for a POS cart line: a whole number between 1 and 50. */
export function isValidPosQuantity(value: unknown): value is number {
  const qty = Number(value);
  return Number.isInteger(qty) && qty >= 1 && qty <= 50;
}

/** POS methods that must carry an external reference to reconcile against. */
export const POS_REFERENCE_METHODS: readonly PosPaymentMethod[] = ['upi', 'card_machine'];

export function posMethodNeedsReference(method: PosPaymentMethod): boolean {
  return POS_REFERENCE_METHODS.includes(method);
}

export type PosReferenceCheck =
  | { ok: true; reference: string | null }
  | { ok: false; error: string };

/**
 * Cash needs no reference. A UPI sale needs its transaction reference and a
 * card sale its approval reference — without one the payment cannot be
 * reconciled against the bank or card statement.
 */
export function validatePosReference(method: unknown, value: unknown): PosReferenceCheck {
  if (!isPosMethod(method)) {
    return { ok: false, error: 'Choose cash, UPI or card machine.' };
  }
  const reference = typeof value === 'string' ? value.trim() : '';
  if (reference.length > 64) {
    return { ok: false, error: 'The reference must be 64 characters or fewer.' };
  }
  if (!posMethodNeedsReference(method)) {
    return { ok: true, reference: null };
  }
  if (!reference) {
    return {
      ok: false,
      error:
        method === 'upi'
          ? 'A UPI sale needs its transaction reference.'
          : 'A card sale needs its approval reference.',
    };
  }
  return { ok: true, reference };
}

/** A cart must have at least one line and no duplicate product ids. */
export function validatePosCart(lines: unknown): { ok: true; lines: PosCartLine[] } | { ok: false; error: string } {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: 'The sale needs at least one item.' };
  }
  if (lines.length > 50) {
    return { ok: false, error: 'A sale cannot have more than 50 lines.' };
  }
  const seen = new Set<string>();
  const clean: PosCartLine[] = [];
  for (const line of lines) {
    const record = (line ?? {}) as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) return { ok: false, error: 'Every line needs a product id.' };
    if (seen.has(id)) {
      return { ok: false, error: `Duplicate line for ${id}. Merge the quantities instead.` };
    }
    if (!isValidPosQuantity(record.quantity)) {
      return { ok: false, error: `Invalid quantity for ${id}.` };
    }
    seen.add(id);
    clean.push({ id, quantity: Math.floor(Number(record.quantity)) });
  }
  return { ok: true, lines: clean };
}

/* --------------------------------------------------- receipt numbers */

export const RECEIPT_PREFIX = 'RCP-';

/** Zero-padded public receipt number: 7 → "RCP-0000007". */
export function formatReceiptNo(sequence: number): string {
  const safe = Math.max(1, Math.trunc(sequence));
  return `${RECEIPT_PREFIX}${String(safe).padStart(7, '0')}`;
}

export function isReceiptNo(value: unknown): value is string {
  return typeof value === 'string' && /^RCP-\d{7,}$/.test(value);
}

/* --------------------------------------------------------- shift maths */

/**
 * Expected cash in the drawer at close: opening float plus cash sales minus
 * cash refunds recorded against the shift. Pure integer paise. A negative
 * result is clamped to zero — the drawer cannot hold a negative amount.
 */
export function expectedCashPaise(
  openingFloatPaise: number,
  cashSalesPaise: number,
  cashRefundsPaise: number,
): number {
  const total =
    Math.trunc(openingFloatPaise) +
    Math.trunc(cashSalesPaise) -
    Math.trunc(cashRefundsPaise);
  return Math.max(0, total);
}

export function cashVariancePaise(countedPaise: number, expectedPaise: number): number {
  return Math.trunc(countedPaise) - Math.trunc(expectedPaise);
}

export function isNonNegativePaise(value: unknown): value is number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && Number.isInteger(amount);
}

/* ----------------------------------------------------------- void rules */

export type VoidCheck = { ok: true } | { ok: false; error: string };

/**
 * A POS sale can be voided only by the owner, only while its shift is still
 * open, and only before any fulfilment work started. The receipt number is
 * never reused — a void leaves a numbered gap on purpose.
 */
export function canVoidPosSale(input: {
  role: 'store_owner' | 'store_admin' | 'store_viewer';
  channel: string;
  shiftStatus: 'OPEN' | 'CLOSED' | null;
  orderStatus: string;
  fulfilmentStatus: string;
  hasReason: boolean;
}): VoidCheck {
  if (input.role !== 'store_owner') {
    return { ok: false, error: 'Only the store owner can void a sale.' };
  }
  if (input.channel !== 'pos') {
    return { ok: false, error: 'Only point-of-sale orders can be voided here.' };
  }
  if (!input.hasReason) {
    return { ok: false, error: 'A void reason is required.' };
  }
  if (input.orderStatus === 'CANCELLED') {
    return { ok: false, error: 'This sale is already void.' };
  }
  if (input.shiftStatus !== 'OPEN') {
    return { ok: false, error: 'The shift for this sale is closed; void it through a refund instead.' };
  }
  if (input.fulfilmentStatus !== 'DELIVERED') {
    return { ok: false, error: 'This order has already entered fulfilment; cancel it from the order page.' };
  }
  return { ok: true };
}

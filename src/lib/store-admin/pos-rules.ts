/** Pure POS rules: prices, totals, receipt numbers, shift maths and void rules. */

import { MAX_PRICE_PAISE, formatRupees } from './money';
import { formatPaise } from './amount';

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

/* ------------------------------------------------------- entered price */

/** Only these roles may type the price charged at the till. */
export function canEnterPosPrice(role: unknown): boolean {
  return role === 'store_admin' || role === 'store_owner';
}

export type PosPriceParse =
  | { ok: true; paise: number | null }
  | { ok: false; error: string };

/**
 * Read a line price sent by the till. The browser sends integer paise; an
 * absent value means "not entered yet" and blocks the sale, while zero is a
 * valid price that the caller must confirm as a free item.
 */
export function parsePosUnitPrice(value: unknown): PosPriceParse {
  if (value === undefined || value === null || value === '') {
    return { ok: true, paise: null };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return {
      ok: false,
      error: 'Enter the selling price as a whole number of paise (for example 49950).',
    };
  }
  if (value < 0) {
    return { ok: false, error: 'The selling price cannot be negative.' };
  }
  if (value > MAX_PRICE_PAISE) {
    return { ok: false, error: `Enter a price of ${formatRupees(MAX_PRICE_PAISE)} or less.` };
  }
  return { ok: true, paise: value };
}

export interface PosPricedCartLine extends PosCartLine {
  unitPricePaise: number;
}

export interface PosPriceWarning {
  productId: string;
  productName: string;
  message: string;
}

export type PosPricedCart =
  | { ok: true; lines: PosPricedCartLine[] }
  | { ok: false; error: string };

/**
 * Pair the clean cart with the prices the till sent. Every line must carry a
 * price; zero is allowed here and checked against the free-item confirmation
 * separately.
 */
export function validatePosPrices(rawLines: unknown, cartLines: readonly PosCartLine[]): PosPricedCart {
  if (!Array.isArray(rawLines) || rawLines.length !== cartLines.length) {
    return { ok: false, error: 'Every line must carry the price entered at the till.' };
  }
  const priced: PosPricedCartLine[] = [];
  for (let index = 0; index < cartLines.length; index += 1) {
    const line = cartLines[index];
    const record = (rawLines[index] ?? {}) as Record<string, unknown>;
    const parsed = parsePosUnitPrice(record.unitPricePaise);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (parsed.paise === null) {
      return { ok: false, error: `Enter the selling price for ${line.id}.` };
    }
    priced.push({ ...line, unitPricePaise: parsed.paise });
  }
  return { ok: true, lines: priced };
}

/** Zero-priced lines that have not been explicitly confirmed as free items. */
export function unconfirmedFreeLines(
  lines: readonly PosPricedCartLine[],
  confirmedIds: unknown,
): PosPricedCartLine[] {
  const confirmed = new Set(
    Array.isArray(confirmedIds)
      ? confirmedIds.filter((id): id is string => typeof id === 'string')
      : [],
  );
  return lines.filter((line) => line.unitPricePaise === 0 && !confirmed.has(line.id));
}

/**
 * A typo guard, not a rule: a price above ten times the regular price or
 * below cost is accepted only after the till asks the cashier to confirm it.
 * A free item (zero) is handled by its own confirmation.
 */
export function unusualPriceWarning(input: {
  unitPricePaise: number;
  regularPricePaise: number;
  costPaise: number | null;
}): string | null {
  const { unitPricePaise, regularPricePaise, costPaise } = input;
  if (unitPricePaise <= 0) return null;
  if (regularPricePaise > 0 && unitPricePaise > regularPricePaise * 10) {
    return `This price is more than 10 times the list price (${formatPaise(regularPricePaise)}).`;
  }
  if (costPaise !== null && Number.isInteger(costPaise) && costPaise > 0 && unitPricePaise < costPaise) {
    return `This price is below cost (${formatPaise(costPaise)}).`;
  }
  return null;
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

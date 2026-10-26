/**
 * Pure order-numbering rules.
 *
 * The prefix and starting number come from Store Admin → Order settings. An
 * empty prefix means the stored settings cannot produce a number, so checkout
 * keeps the previous `GDZ{time}{rand}` transaction id and leaves
 * `orders.order_number` NULL. Historical orders are never renumbered.
 *
 * Database-free so the allocator, the order document and the tests agree.
 */

/** Zero-padded width of the numeric part of an order number. */
export const ORDER_NUMBER_PAD = 6;

/** Row name used in `order_number_counters`. */
export const ORDER_NUMBER_COUNTER = 'order';

const MAX_PREFIX_LENGTH = 10;

export interface OrderNumberSettings {
  /** Upper-case alphanumeric prefix, or '' when the setting is unusable. */
  prefix: string;
  /** First number handed out; never below 1. */
  startNumber: number;
}

/**
 * Trim, upper-case and reduce a prefix to characters that are safe inside a
 * PayU transaction id. `fallback` is used when nothing valid remains.
 */
export function sanitizeOrderPrefix(value: unknown, fallback = ''): string {
  const cleaned = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, MAX_PREFIX_LENGTH);
  return cleaned || fallback;
}

/** Whole starting number, never below 1. Empty or invalid input means 1. */
export function parseOrderStartNumber(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(999_999_999, Math.max(1, Math.trunc(parsed)));
}

export function readOrderNumberSettings(input: {
  order_prefix?: unknown;
  order_start_number?: unknown;
}): OrderNumberSettings {
  return {
    prefix: sanitizeOrderPrefix(input.order_prefix),
    startNumber: parseOrderStartNumber(input.order_start_number),
  };
}

/** False when the prefix is empty, so checkout must fall back. */
export function hasUsableNumbering(settings: OrderNumberSettings): boolean {
  return settings.prefix.length > 0;
}

/** `GDZ1001` style display number. */
export function formatOrderNumber(prefix: string, number: number): string {
  const clean = sanitizeOrderPrefix(prefix);
  const value = Math.max(1, Math.trunc(Number(number) || 0));
  return `${clean}${String(value).padStart(ORDER_NUMBER_PAD, '0')}`;
}

/**
 * Invoice reference for an order: the invoice prefix plus the allocated order
 * number. Orders saved before numbering existed fall back to their txnid, so a
 * receipt always has a stable reference.
 */
export function formatInvoiceReference(input: {
  orderNumber?: number | string | null;
  invoicePrefix?: unknown;
  txnid: string;
}): string {
  const number = Number(input.orderNumber);
  if (Number.isSafeInteger(number) && number > 0) {
    const prefix = sanitizeOrderPrefix(input.invoicePrefix, 'INV');
    return `${prefix}${String(number).padStart(ORDER_NUMBER_PAD, '0')}`;
  }
  return String(input.txnid ?? '');
}

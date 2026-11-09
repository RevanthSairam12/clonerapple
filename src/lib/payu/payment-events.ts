/**
 * Sanitised payment event log for the Store Admin "Payment timeline".
 *
 * One row per callback decision, whichever path produced it: the browser
 * return (surl/furl/curl), the PayU webhook, the reconciler tick, or a staff
 * "Verify with PayU". Rows are append-only (a database trigger refuses UPDATE
 * and DELETE), so nothing here may ever contain a raw PayU payload, card data,
 * a secret, an email, a phone number or an address.
 *
 * Failures are swallowed: a timeline write must never be able to change the
 * payment outcome it is describing.
 */

import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';

export type PaymentEventSource = 'redirect' | 'webhook' | 'reconcile' | 'admin' | 'customer';

export type PaymentEventOutcome =
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'pending'
  | 'processing'
  | 'unchanged'
  | 'rejected';

/** Internal reason tag written when a verification lease is atomically claimed. */
export const VERIFICATION_CLAIM_REASON = 'verification_claim_lease';

export interface PaymentEventInput {
  orderId: string;
  txnid: string;
  source: PaymentEventSource;
  /** PayU's own status pair, for example `success/captured`. Never a payload. */
  payuStatus?: string | null;
  outcome: PaymentEventOutcome;
  /** Our own explanation (a decision reason), never gateway text with PII. */
  reason?: string | null;
  /** Row-level connection for tests; defaults to the application pool. */
  sql?: postgres.Sql;
}

export interface PaymentEventRow {
  id: string;
  txnid: string;
  source: PaymentEventSource;
  payuStatus: string;
  outcome: PaymentEventOutcome;
  reason: string;
  createdAt: string;
}

/** Lowercase, collapse whitespace and cap the length of a free-text field. */
export function sanitizeEventText(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** `success` + `captured` → `success/captured`; unknown values are dropped. */
export function formatPayUStatus(
  status: unknown,
  unmappedstatus?: unknown,
): string {
  const first = sanitizeEventText(status, 40).toLowerCase();
  const second = sanitizeEventText(unmappedstatus, 40).toLowerCase();
  if (!first) return second;
  if (!second || second === first) return first;
  return `${first}/${second}`;
}

const SOURCES = new Set<PaymentEventSource>(['redirect', 'webhook', 'reconcile', 'admin', 'customer']);
const OUTCOMES = new Set<PaymentEventOutcome>([
  'paid',
  'failed',
  'cancelled',
  'pending',
  'processing',
  'unchanged',
  'rejected',
]);

/**
 * Append one event. Resolves to false when the row could not be written (no
 * database, a schema without the table in an old deployment, any other error).
 */
export async function recordPaymentEvent(input: PaymentEventInput): Promise<boolean> {
  const sql = input.sql ?? getSql();
  if (!sql) return false;
  if (!input.orderId || !input.txnid) return false;
  if (!SOURCES.has(input.source) || !OUTCOMES.has(input.outcome)) return false;

  const payuStatus = sanitizeEventText(input.payuStatus, 81);
  const reason = sanitizeEventText(input.reason, 240);

  try {
    await sql`
      insert into payment_events (order_id, txnid, source, payu_status, outcome, reason)
      values (
        ${input.orderId},
        ${input.txnid},
        ${input.source},
        ${payuStatus},
        ${input.outcome},
        ${reason}
      )
    `;
    return true;
  } catch (error: unknown) {
    // A missing table on an un-migrated deployment, or a rejected value, must
    // not affect the payment. Report the fact without any payload.
    console.warn('[payu/events] could not record a payment event:', (error as Error).message);
    return false;
  }
}

/** Timeline for one order, oldest last. Safe fields only. */
export async function listPaymentEvents(
  txnid: string,
  options: { limit?: number } = {},
): Promise<PaymentEventRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const key = txnid.trim();
  if (!key) return [];
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  const rows = (await sql`
    select id, txnid, source, payu_status, outcome, reason, created_at
    from payment_events
    where txnid = ${key}
      and reason <> ${VERIFICATION_CLAIM_REASON}
    order by created_at desc, id desc
    limit ${limit}
  `) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    txnid: String(row.txnid),
    source: (SOURCES.has(row.source as PaymentEventSource)
      ? row.source
      : 'redirect') as PaymentEventSource,
    payuStatus: String(row.payu_status ?? ''),
    outcome: (OUTCOMES.has(row.outcome as PaymentEventOutcome)
      ? row.outcome
      : 'processing') as PaymentEventOutcome,
    reason: String(row.reason ?? ''),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ''),
  }));
}

/** The outcome label for a settled order status. */
export function outcomeForStatus(status: string): PaymentEventOutcome {
  switch (status) {
    case 'PAID':
      return 'paid';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'PENDING':
      return 'pending';
    default:
      return 'processing';
  }
}

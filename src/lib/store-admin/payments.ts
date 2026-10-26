import { getSql } from '@/lib/admin/db';

import {
  ADMIN_MAX_MARK_PAID_PAISE,
  MANUAL_METHODS,
  PAYMENT_STATUSES,
  validateManualPayment,
  type ManualMethod,
  type PaymentStatus,
} from './payment-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin payment repository must be server-only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  const result = iso(value);
  return result || null;
}

/* ----------------------------------------------------------- types */

export const PAYMENT_CHANNELS = ['online', 'pos', 'manual'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_METHODS = [
  'cash',
  'upi',
  'card_machine',
  'bank_transfer',
  'cod',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export { MANUAL_METHODS, PAYMENT_STATUSES, validateManualPayment, ADMIN_MAX_MARK_PAID_PAISE };
export type { ManualMethod, PaymentStatus };

/** Methods that must carry a provider reference. */
export const REF_REQUIRED_METHODS: readonly PaymentMethod[] = ['upi', 'bank_transfer'];

export const REVIEW_STATUSES = ['NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value);
}

export interface PaymentRow {
  id: number;
  orderId: string;
  channel: PaymentChannel;
  method: PaymentMethod;
  amountPaise: number;
  status: PaymentStatus;
  reviewStatus: ReviewStatus;
  providerRef: string | null;
  paidAt: string | null;
  markedPaidBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  notes: string;
  createdAt: string;
}

/** UPI, bank transfer and "other" entries wait for a second pair of eyes. */
export function methodNeedsReview(method: PaymentMethod): boolean {
  return method === 'upi' || method === 'bank_transfer' || method === 'other';
}

export function isManualMethod(value: unknown): value is ManualMethod {
  return typeof value === 'string' && (MANUAL_METHODS as readonly string[]).includes(value);
}

function isChannel(value: unknown): value is PaymentChannel {
  return typeof value === 'string' && (PAYMENT_CHANNELS as readonly string[]).includes(value);
}

function isMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/* --------------------------------------------------- pure rules */

/** Sum of PAID rows covers the order total → the order can become PAID. */
export function paymentCoversTotal(paidPaise: number, totalPaise: number): boolean {
  return paidPaise >= totalPaise && totalPaise > 0;
}

/* --------------------------------------------------- repository */

export type PaymentLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' };

function mapPayment(row: Row): PaymentRow {
  return {
    id: number(row.id),
    orderId: text(row.order_id),
    channel: isChannel(row.channel) ? row.channel : 'manual',
    method: isMethod(row.method) ? row.method : 'other',
    amountPaise: number(row.amount_paise),
    status: isStatus(row.status) ? row.status : 'PENDING',
    reviewStatus: isReviewStatus(row.review_status) ? row.review_status : 'NOT_REQUIRED',
    providerRef: nullableText(row.provider_ref),
    paidAt: nullableIso(row.paid_at),
    markedPaidBy: nullableText(row.marked_paid_by),
    reviewedAt: nullableIso(row.reviewed_at),
    rejectionReason: nullableText(row.rejection_reason),
    notes: text(row.notes),
    createdAt: iso(row.created_at),
  };
}

/** List the payments recorded against one order, newest first. */
export async function listOrderPayments(orderId: string): Promise<PaymentLoad<PaymentRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id, order_id, channel, method, amount_paise, status,
             review_status, provider_ref, paid_at, marked_paid_by,
             reviewed_at, rejection_reason, notes, created_at
      from order_payments
      where order_id = ${orderId}
      order by created_at desc, id desc
    `) as Row[];
    return { ok: true, data: rows.map(mapPayment) };
  } catch {
    console.warn('[store-admin/payments] could not list order payments');
    return { ok: false, reason: 'unavailable' };
  }
}

export type ManualPaymentResult =
  | {
      ok: true;
      orderId: string;
      txnid: string;
      paymentId: number;
      orderPaidNow: boolean;
      requiresReview: boolean;
      paidPaise: number;
      totalPaise: number;
      previousStatus: string;
    }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'already-paid'
        | 'cancelled'
        | 'invalid-input';
      error: string;
    };

function failure(
  reason: Extract<ManualPaymentResult, { ok: false }>['reason'],
  error: string,
): ManualPaymentResult {
  return { ok: false, reason, error };
}

/**
 * Record a manual payment against an order and promote the order to PAID when
 * the sum of PAID payment rows covers the total. Everything happens in one
 * locked transaction so a double-click cannot over-mark.
 */
export async function recordManualPayment(input: {
  txnid: string;
  method: ManualMethod;
  amountPaise: number;
  providerRef: string | null;
  notes: string;
  staffId: string;
}): Promise<ManualPaymentResult> {
  const sql = getSql();
  if (!sql) return failure('unavailable', 'Order records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, txnid, status, total_paise, amount
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return failure('not-found', 'Order not found.');

      const status = text(order.status);
      // A PayU-paid order is settled; manual marks on it would double-count.
      if (status === 'PAID') {
        return failure('already-paid', 'This order is already paid through the gateway.');
      }
      if (status === 'CANCELLED') {
        return failure('cancelled', 'A cancelled order cannot take payments.');
      }

      const orderId = text(order.id);
      const requiresReview = methodNeedsReview(input.method);

      const paymentRows = (await tx`
        insert into order_payments (
          order_id, channel, method, amount_paise, status,
          review_status, provider_ref, paid_at, marked_paid_by, notes
        ) values (
          ${orderId}, 'manual', ${input.method}, ${input.amountPaise},
          ${requiresReview ? 'PENDING' : 'PAID'},
          ${requiresReview ? 'PENDING' : 'NOT_REQUIRED'},
          ${input.providerRef}, ${requiresReview ? null : new Date()},
          ${input.staffId}, ${input.notes}
        )
        returning id
      `) as Row[];
      const paymentId = number(paymentRows[0]?.id);

      const sumRows = (await tx`
        select coalesce(sum(amount_paise), 0)::bigint as paid
        from order_payments
        where order_id = ${orderId} and status = 'PAID'
      `) as Row[];
      const paidPaise = number(sumRows[0]?.paid);
      const totalPaise = number(order.total_paise) || Math.round(number(order.amount) * 100);

      let orderPaidNow = false;
      if (!requiresReview && paymentCoversTotal(paidPaise, totalPaise)) {
        await tx`
          update orders
          set status = 'PAID',
              paid_at = coalesce(paid_at, now()),
              payment_method = coalesce(payment_method, ${input.method}),
              staff_id = ${input.staffId},
              updated_at = now()
          where id = ${orderId}
        `;
        orderPaidNow = true;
      }

      if (!requiresReview) {
        await tx`
          insert into order_status_history (order_id, domain, actor, from_status, to_status)
          values (${orderId}, 'payment', 'store_admin', ${status}, ${orderPaidNow ? 'PAID' : status})
        `;
      }

      return {
        ok: true as const,
        orderId,
        txnid: text(order.txnid),
        paymentId,
        orderPaidNow,
        requiresReview,
        paidPaise,
        totalPaise,
        previousStatus: status,
      };
    });
  } catch {
    console.warn('[store-admin/payments] could not record a manual payment');
    return failure('unavailable', 'Order records are not available.');
  }
}

/* ------------------------------------------------ manual review queue */

export interface PendingPayment {
  id: number;
  orderId: string;
  txnid: string;
  method: PaymentMethod;
  amountPaise: number;
  providerRef: string | null;
  notes: string;
  createdAt: string;
  orderStatus: string;
  orderTotalPaise: number;
}

/** Manual entries waiting for a verify/reject decision, newest first. */
export async function listPendingPayments(limit = 100): Promise<PaymentLoad<PendingPayment[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select p.id, p.order_id, p.method, p.amount_paise, p.provider_ref,
             p.notes, p.created_at,
             o.txnid, o.status as order_status,
             coalesce(o.total_paise, round(o.amount * 100)::bigint) as order_total_paise
      from order_payments p
      join orders o on o.id = p.order_id
      where p.review_status = 'PENDING'
      order by p.created_at asc, p.id asc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: number(row.id),
        orderId: text(row.order_id),
        txnid: text(row.txnid),
        method: isMethod(row.method) ? row.method : 'other',
        amountPaise: number(row.amount_paise),
        providerRef: nullableText(row.provider_ref),
        notes: text(row.notes),
        createdAt: iso(row.created_at),
        orderStatus: text(row.order_status),
        orderTotalPaise: number(row.order_total_paise),
      })),
    };
  } catch {
    console.warn('[store-admin/payments] could not read the review queue');
    return { ok: false, reason: 'unavailable' };
  }
}

export type PaymentReviewResult =
  | {
      ok: true;
      decision: 'approved' | 'rejected';
      txnid: string;
      orderId: string;
      orderPaidNow: boolean;
      paidPaise: number;
      totalPaise: number;
    }
  | {
      ok: false;
      reason: 'unavailable' | 'not-found' | 'not-pending' | 'cancelled' | 'invalid-input';
      error: string;
    };

function reviewFailure(
  reason: Extract<PaymentReviewResult, { ok: false }>['reason'],
  error: string,
): PaymentReviewResult {
  return { ok: false, reason, error };
}

/**
 * Approve or reject a pending manual payment.
 *
 * Approval flips the row to PAID and re-runs the coverage check, promoting the
 * order exactly like a counter payment would. Rejection moves the row to FAILED
 * with a required reason, so the amount stops counting towards the total.
 * Both paths lock the payment and the order row.
 */
export async function reviewManualPayment(input: {
  paymentId: number;
  decision: 'approve' | 'reject';
  reason: string;
  staffId: string;
}): Promise<PaymentReviewResult> {
  if (input.decision === 'reject') {
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 200) {
      return reviewFailure('invalid-input', 'Give a rejection reason between 5 and 200 characters.');
    }
  }

  const sql = getSql();
  if (!sql) return reviewFailure('unavailable', 'Payment records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select p.id, p.order_id, p.review_status, p.amount_paise,
               o.txnid, o.status as order_status, o.total_paise, o.amount
        from order_payments p
        join orders o on o.id = p.order_id
        where p.id = ${input.paymentId}
        for update of p, o
      `) as Row[];
      const payment = rows[0];
      if (!payment) return reviewFailure('not-found', 'Payment not found.');
      if (text(payment.review_status) !== 'PENDING') {
        return reviewFailure('not-pending', 'This payment has already been reviewed.');
      }

      const orderId = text(payment.order_id);
      const orderStatus = text(payment.order_status);
      if (orderStatus === 'CANCELLED') {
        return reviewFailure('cancelled', 'A cancelled order cannot take payments.');
      }

      if (input.decision === 'reject') {
        await tx`
          update order_payments
          set status = 'FAILED',
              review_status = 'REJECTED',
              rejection_reason = ${input.reason.trim()},
              reviewed_by = ${input.staffId},
              reviewed_at = now(),
              updated_at = now()
          where id = ${input.paymentId}
        `;
        return {
          ok: true as const,
          decision: 'rejected' as const,
          txnid: text(payment.txnid),
          orderId,
          orderPaidNow: false,
          paidPaise: 0,
          totalPaise: number(payment.total_paise) || Math.round(number(payment.amount) * 100),
        };
      }

      await tx`
        update order_payments
        set status = 'PAID',
            review_status = 'VERIFIED',
            paid_at = coalesce(paid_at, now()),
            reviewed_by = ${input.staffId},
            reviewed_at = now(),
            updated_at = now()
        where id = ${input.paymentId}
      `;

      const sumRows = (await tx`
        select coalesce(sum(amount_paise), 0)::bigint as paid
        from order_payments
        where order_id = ${orderId} and status = 'PAID'
      `) as Row[];
      const paidPaise = number(sumRows[0]?.paid);
      const totalPaise = number(payment.total_paise) || Math.round(number(payment.amount) * 100);

      let orderPaidNow = false;
      if (orderStatus !== 'PAID' && paymentCoversTotal(paidPaise, totalPaise)) {
        await tx`
          update orders
          set status = 'PAID',
              paid_at = coalesce(paid_at, now()),
              updated_at = now()
          where id = ${orderId}
        `;
        await tx`
          insert into order_status_history (order_id, domain, actor, from_status, to_status)
          values (${orderId}, 'payment', 'store_admin', ${orderStatus}, 'PAID')
        `;
        orderPaidNow = true;
      }

      return {
        ok: true as const,
        decision: 'approved' as const,
        txnid: text(payment.txnid),
        orderId,
        orderPaidNow,
        paidPaise,
        totalPaise,
      };
    });
  } catch {
    console.warn('[store-admin/payments] could not review a manual payment');
    return reviewFailure('unavailable', 'Payment records are not available.');
  }
}

/** Pure return, refund and cancellation rules. No database, no framework. */

export const RETURN_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'RECEIVED',
  'REFUNDED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export function isReturnStatus(value: unknown): value is ReturnStatus {
  return typeof value === 'string' && (RETURN_STATUSES as readonly string[]).includes(value);
}

/** Allowed moves. Terminal states never move again. */
export const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['REFUNDED'],
  REFUNDED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to);
}

export function isReturnOpen(status: ReturnStatus): boolean {
  return status === 'REQUESTED' || status === 'APPROVED' || status === 'RECEIVED';
}

/** Statuses that already consume some of a line's returnable quantity. */
export const RETURNING_STATUSES: readonly ReturnStatus[] = [
  'REQUESTED',
  'APPROVED',
  'RECEIVED',
  'REFUNDED',
];

/* ----------------------------------------------------- condition grades */

export const CONDITION_GRADES = ['RESELLABLE', 'OPENED', 'DAMAGED', 'DEFECTIVE'] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export function isConditionGrade(value: unknown): value is ConditionGrade {
  return typeof value === 'string' && (CONDITION_GRADES as readonly string[]).includes(value);
}

/** Grades that may go back on the shelf when the staff member ticks restock. */
export const RESTOCK_GRADES: readonly ConditionGrade[] = ['RESELLABLE', 'OPENED'];

export function restockEligible(grade: ConditionGrade, restock: boolean): boolean {
  return restock && RESTOCK_GRADES.includes(grade);
}

/* ---------------------------------------------------------- refund rules */

export const REFUND_METHODS = ['cash', 'upi', 'card_machine', 'bank_transfer', 'other'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export function isRefundMethod(value: unknown): value is RefundMethod {
  return typeof value === 'string' && (REFUND_METHODS as readonly string[]).includes(value);
}

/** Refund methods that must carry a reference (matching manual payments). */
export const REFUND_REFERENCE_METHODS: readonly RefundMethod[] = ['upi', 'bank_transfer'];

export type RefundCheck =
  | { ok: true; remainingPaise: number }
  | { ok: false; code: 'invalid-amount' | 'refund-exceeds-captured'; error: string };

/**
 * The refund invariant: the sum of refunds can never exceed what was captured.
 * `capturedPaise` is the PAID payment total; `refundedPaise` is every refund
 * already recorded against the order.
 */
export function checkRefund(input: {
  amountPaise: number;
  capturedPaise: number;
  refundedPaise: number;
}): RefundCheck {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, code: 'invalid-amount', error: 'Enter a refund amount greater than zero.' };
  }

  const captured = Math.max(0, Math.trunc(input.capturedPaise));
  const already = Math.max(0, Math.trunc(input.refundedPaise));
  const remaining = Math.max(0, captured - already);

  if (captured <= 0) {
    return {
      ok: false,
      code: 'refund-exceeds-captured',
      error: 'No payment has been captured on this order, so there is nothing to refund.',
    };
  }
  if (input.amountPaise > remaining) {
    return {
      ok: false,
      code: 'refund-exceeds-captured',
      error: `Refunds can total at most the captured amount. ₹${(remaining / 100).toFixed(2)} is left.`,
    };
  }
  return { ok: true, remainingPaise: remaining - input.amountPaise };
}

/** Validate a refund reference the way manual payments do. */
export function validateRefundReference(method: RefundMethod, reference: unknown): string | null {
  if (!REFUND_REFERENCE_METHODS.includes(method)) return null;
  const value = typeof reference === 'string' ? reference.trim() : '';
  return value ? value.slice(0, 120) : null;
}

/* -------------------------------------------------- return request rules */

export const RETURN_REASON_MIN = 3;
export const RETURN_REASON_MAX = 300;

export function validateReturnReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason.length >= RETURN_REASON_MIN && reason.length <= RETURN_REASON_MAX ? reason : null;
}

export function returnableQuantity(purchased: number, alreadyReturned: number): number {
  const bought = Number.isFinite(purchased) ? Math.max(0, Math.trunc(purchased)) : 0;
  const returned = Number.isFinite(alreadyReturned) ? Math.max(0, Math.trunc(alreadyReturned)) : 0;
  return Math.max(0, bought - returned);
}

export interface ReturnLineCheck {
  orderItemId: number;
  quantity: number;
  purchased: number;
  alreadyReturned: number;
}

export type ReturnLinesCheck =
  | { ok: true; expectedPaise: number }
  | { ok: false; code: 'invalid-input' | 'quantity-exceeds-purchased'; error: string };

/**
 * Check the requested quantities against what each line still has available.
 * `expectedPaise` is the value of the goods coming back and is used to decide
 * when a return is fully refunded.
 */
export function checkReturnLines(
  lines: ReturnLineCheck[],
  unitPricePaise: (orderItemId: number) => number,
): ReturnLinesCheck {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, code: 'invalid-input', error: 'Pick at least one item to return.' };
  }

  const seen = new Set<number>();
  let expectedPaise = 0;

  for (const line of lines) {
    if (!Number.isInteger(line.orderItemId) || line.orderItemId <= 0) {
      return { ok: false, code: 'invalid-input', error: 'A return line is missing its order item.' };
    }
    if (seen.has(line.orderItemId)) {
      return { ok: false, code: 'invalid-input', error: 'Each item can appear only once in a return.' };
    }
    seen.add(line.orderItemId);

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return { ok: false, code: 'invalid-input', error: 'Every returned line needs a quantity above zero.' };
    }
    const available = returnableQuantity(line.purchased, line.alreadyReturned);
    if (line.quantity > available) {
      return {
        ok: false,
        code: 'quantity-exceeds-purchased',
        error: available === 0
          ? 'That item has already been returned in full.'
          : `Only ${available} of that item can still be returned.`,
      };
    }
    expectedPaise += line.quantity * Math.max(0, Math.trunc(unitPricePaise(line.orderItemId)));
  }

  return { ok: true, expectedPaise };
}

/* ------------------------------------------------------- cancellation */

export function cancellationAllowed(input: {
  paymentStatus: string;
  fulfilmentStatus: string;
}): { ok: true } | { ok: false; code: 'already-cancelled' | 'already-delivered'; error: string } {
  if (input.fulfilmentStatus === 'CANCELED' || input.paymentStatus === 'CANCELLED') {
    return { ok: false, code: 'already-cancelled', error: 'This order is already cancelled.' };
  }
  if (input.fulfilmentStatus === 'DELIVERED') {
    return {
      ok: false,
      code: 'already-delivered',
      error: 'A delivered order is closed — record a return and a refund instead.',
    };
  }
  return { ok: true };
}

export function roleCanDecideReturns(role: 'store_owner' | 'store_admin' | 'store_viewer'): boolean {
  return role === 'store_owner' || role === 'store_admin';
}

/** Pure, shared financial/document policy. Captured payment is not order success. */
export interface DocumentFacts {
  paymentStatus: string;
  fulfilmentStatus: string;
  shipmentStarted?: boolean;
  paymentReviewRequired?: boolean;
  totalPaise: number;
  capturedPaise?: number;
  refundedPaise?: number;
  pendingRefundPaise?: number;
  refundDuePaise?: number;
  lastRefundOutcome?: string | null;
  invoiceNumber?: string | null;
  invoiceIssuedAt?: string | null;
  billRequested?: boolean;
  channel?: string;
}
export interface DocumentState {
  paymentStatus: string;
  orderStatus: string;
  shipmentStatus: string;
  refundStatus: 'NONE' | 'INITIATED' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'REJECTED';
  paymentStatusKey: CanonicalPaymentStatus;
  paymentStatusLabel: string;
  orderStatusKey: CanonicalOrderStatus;
  orderStatusLabel: string;
  label: string;
  kind: 'status' | 'provisional' | 'invoice' | 'legacy' | 'receipt';
  paymentSettled: boolean;
  canRequestBill: boolean;
  canViewBill: boolean;
  isPaymentProof: boolean;
  totalPaise: number;
  capturedPaise: number;
  refundedPaise: number;
  pendingRefundPaise: number;
  refundDuePaise: number;
  retainedPaise: number;
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  billRequested: boolean;
}
export type CustomerDocumentMode = 'receipt' | 'invoice';
export interface CustomerDocumentState extends DocumentState {
  canViewInvoice: boolean;
  canViewReceipt: boolean;
}

/** Undefined means the current default; empty, duplicate and unknown modes fail closed. */
export function parseCustomerDocumentMode(value: unknown): CustomerDocumentMode | undefined | null {
  return value === undefined ? undefined : value === 'receipt' || value === 'invoice' ? value : null;
}

/** Customer visibility only. Never change staff/POS issuance or document eligibility. */
export function projectCustomerDocumentState(state: DocumentState, mode?: CustomerDocumentMode): CustomerDocumentState {
  const settled = state.paymentSettled === true && state.paymentStatus === 'PAID';
  const canViewReceipt = settled && state.capturedPaise > 0;
  const canViewInvoice = settled && state.orderStatus === 'DELIVERED' &&
    Boolean(state.invoiceNumber && state.invoiceIssuedAt);
  const invoice = mode === 'invoice' || (mode === undefined && canViewInvoice);
  const canViewBill = invoice ? canViewInvoice : canViewReceipt;
  const kind = canViewBill ? (invoice ? 'invoice' : 'receipt') : 'status';
  return {
    ...state, kind, canViewInvoice, canViewReceipt, canViewBill,
    canRequestBill: false, billRequested: false,
    invoiceNumber: kind === 'invoice' ? state.invoiceNumber : null,
    invoiceIssuedAt: kind === 'invoice' ? state.invoiceIssuedAt : null,
    isPaymentProof: canViewBill && state.totalPaise > 0 && state.orderStatus !== 'CANCELLED' &&
      state.refundedPaise === 0 && state.pendingRefundPaise === 0,
  };
}

const money = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
export type CanonicalPaymentStatus =
  | 'PENDING'
  | 'VERIFYING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUND_INITIATED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export type CanonicalOrderStatus =
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED';

export interface DerivedOrderStatuses {
  paymentStatusKey: CanonicalPaymentStatus;
  paymentStatusLabel: string;
  orderStatusKey: CanonicalOrderStatus;
  orderStatusLabel: string;
}

const PAYMENT_STATUS_GLOSSARY: Record<CanonicalPaymentStatus, string> = {
  PENDING: 'Pending',
  VERIFYING: 'Verifying',
  PAID: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REFUND_INITIATED: 'Refund initiated',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
};

const ORDER_STATUS_GLOSSARY: Record<CanonicalOrderStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
};

/**
 * One shared glossary deriving independent Payment status and Order
 * (fulfilment) status for every admin and customer surface.
 *
 * Rules:
 * - Pending or cancelled payment never produces Paid.
 * - PROCESSING is Verifying, never revenue or Confirmed.
 * - Only a verified capture (`paymentStatus === 'PAID'`) produces Paid.
 * - Failed and cancelled payments leave the order Awaiting payment or
 *   Cancelled, never Confirmed.
 */
export function derivePaymentAndOrderStatus(input: {
  paymentStatus?: unknown;
  fulfilmentStatus?: unknown;
  saleState?: unknown;
  paymentReviewRequired?: boolean;
  capturedPaise?: unknown;
  refundedPaise?: unknown;
  pendingRefundPaise?: unknown;
  refundCount?: unknown;
  returnStatus?: unknown;
}): DerivedOrderStatuses {
  const rawPayment = String(input.paymentStatus ?? '').trim().toUpperCase();
  const rawFulfilment = String(input.fulfilmentStatus ?? '').trim().toUpperCase();
  const rawSaleState = String(input.saleState ?? '').trim().toUpperCase();
  const rawReturn = String(input.returnStatus ?? '').trim().toUpperCase();
  const capturedPaise = money(input.capturedPaise);
  const refundedPaise = money(input.refundedPaise);
  const pendingRefundPaise = money(input.pendingRefundPaise);
  const refundCount = money(input.refundCount);

  let paymentStatusKey: CanonicalPaymentStatus = 'PENDING';
  if (rawPayment === 'PAID') {
    if (pendingRefundPaise > 0) {
      paymentStatusKey = 'REFUND_INITIATED';
    } else if (refundedPaise > 0 && capturedPaise > 0 && refundedPaise < capturedPaise) {
      paymentStatusKey = 'PARTIALLY_REFUNDED';
    } else if (
      (refundedPaise > 0 && (capturedPaise === 0 || refundedPaise >= capturedPaise))
      || refundCount > 0
      || rawSaleState === 'REFUNDED'
    ) {
      paymentStatusKey = 'REFUNDED';
    } else {
      paymentStatusKey = 'PAID';
    }
  } else if (rawPayment === 'PROCESSING' || input.paymentReviewRequired === true) {
    paymentStatusKey = 'VERIFYING';
  } else if (rawPayment === 'FAILED') {
    paymentStatusKey = 'FAILED';
  } else if (rawPayment === 'CANCELLED' || rawPayment === 'CANCELED') {
    paymentStatusKey = 'CANCELLED';
  } else {
    paymentStatusKey = 'PENDING';
  }

  let orderStatusKey: CanonicalOrderStatus = 'AWAITING_PAYMENT';
  const isCancelled =
    rawFulfilment === 'CANCELED'
    || rawFulfilment === 'CANCELLED'
    || rawPayment === 'CANCELLED'
    || rawPayment === 'CANCELED';

  if (rawReturn === 'RECEIVED' || rawReturn === 'REFUNDED') {
    orderStatusKey = 'RETURNED';
  } else if (isCancelled) {
    orderStatusKey = 'CANCELLED';
  } else if (rawPayment !== 'PAID') {
    orderStatusKey = 'AWAITING_PAYMENT';
  } else if (rawFulfilment === 'DELIVERED') {
    orderStatusKey = 'DELIVERED';
  } else if (rawFulfilment === 'ON_THE_WAY') {
    orderStatusKey = 'SHIPPED';
  } else if (rawFulfilment === 'PROCESSING') {
    orderStatusKey = 'PACKED';
  } else {
    orderStatusKey = 'CONFIRMED';
  }

  return {
    paymentStatusKey,
    paymentStatusLabel: PAYMENT_STATUS_GLOSSARY[paymentStatusKey],
    orderStatusKey,
    orderStatusLabel: ORDER_STATUS_GLOSSARY[orderStatusKey],
  };
}

export function deriveDocumentState(facts: DocumentFacts): DocumentState {
  const totalPaise = money(facts.totalPaise);
  const capturedPaise = money(facts.capturedPaise);
  const refundedPaise = money(facts.refundedPaise);
  const pendingRefundPaise = money(facts.pendingRefundPaise);
  const refundDuePaise = money(facts.refundDuePaise);
  const payment = facts.paymentStatus.toUpperCase();
  const fulfilment = facts.fulfilmentStatus.toUpperCase();
  const cancelled = ['CANCELED', 'CANCELLED'].includes(fulfilment) || ['CANCELED', 'CANCELLED'].includes(payment);
  const shipped = facts.shipmentStarted === true || ['ON_THE_WAY', 'DELIVERED'].includes(fulfilment);
  const settled = payment === 'PAID' && !facts.paymentReviewRequired &&
    (capturedPaise >= totalPaise) && (totalPaise > 0 || facts.channel === 'pos');
  const refundStatus: DocumentState['refundStatus'] = pendingRefundPaise > 0 ? 'INITIATED'
    : refundedPaise > 0 ? (refundedPaise >= capturedPaise ? 'COMPLETED' : 'PARTIAL')
    : facts.lastRefundOutcome === 'FAILED' ? 'FAILED'
    : facts.lastRefundOutcome === 'REJECTED' ? 'REJECTED' : 'NONE';
  let label = 'Payment Pending';
  if (facts.paymentReviewRequired || payment === 'PROCESSING') label = 'Payment Pending / Verifying';
  else if (payment === 'FAILED') label = 'Payment Failed';
  else if (settled) label = totalPaise === 0 ? 'No payment required' : 'Paid';
  if (cancelled) label = 'Cancelled';
  if (pendingRefundPaise > 0) label = 'Refund Initiated';
  else if (refundedPaise > 0) label = refundedPaise >= capturedPaise ? 'Refund Successful' : 'Refund Successful — Partial';
  const invoiceNumber = facts.invoiceNumber || null;
  const invoiceIssuedAt = facts.invoiceIssuedAt || null;
  const issued = Boolean(invoiceNumber && invoiceIssuedAt);
  const billRequested = facts.billRequested === true;
  const ordinarySale = settled && !cancelled && refundedPaise === 0 && pendingRefundPaise === 0;
  const canRequestBill = ordinarySale && !shipped && !issued && !billRequested;
  // Existing issued documents remain available with their current status overlay.
  // Unpaid/review cases remain a status-only screen, never payment proof.
  const canViewBill = settled && (issued || shipped || (billRequested && (!cancelled || pendingRefundPaise > 0 || refundedPaise > 0)));
  const kind: DocumentState['kind'] = !canViewBill ? 'status' : issued ? 'invoice' : shipped ? 'legacy' : 'provisional';
  const derivedStatuses = derivePaymentAndOrderStatus({
    paymentStatus: payment,
    fulfilmentStatus: fulfilment,
    paymentReviewRequired: facts.paymentReviewRequired,
    capturedPaise,
    refundedPaise,
    pendingRefundPaise,
  });
  return {
    paymentStatus: payment, orderStatus: cancelled ? 'CANCELLED' : fulfilment,
    shipmentStatus: shipped ? (fulfilment === 'DELIVERED' ? 'DELIVERED' : 'SHIPPED') : 'NOT_SHIPPED',
    refundStatus,
    paymentStatusKey: derivedStatuses.paymentStatusKey,
    paymentStatusLabel: derivedStatuses.paymentStatusLabel,
    orderStatusKey: derivedStatuses.orderStatusKey,
    orderStatusLabel: derivedStatuses.orderStatusLabel,
    label, kind, canRequestBill, canViewBill, paymentSettled: settled,
    isPaymentProof: ordinarySale && totalPaise > 0 && canViewBill,
    totalPaise, capturedPaise, refundedPaise, pendingRefundPaise, refundDuePaise,
    retainedPaise: Math.max(0, capturedPaise - refundedPaise),
    invoiceNumber, invoiceIssuedAt, billRequested,
  };
}

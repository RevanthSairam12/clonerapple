/**
 * Customer-safe order status vocabulary shared by account pages and the live
 * status endpoint. This module is safe to import from client components: it
 * contains no database code and no internal order fields.
 */

import { fulfilmentLabel } from '@/lib/orders/fulfilment';
import { validateHttpsTrackingUrl } from '@/lib/store-admin/delivery';

export const ACCOUNT_ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PROCESSING',
  'SCHEDULED',
  'ON_THE_WAY',
  'DELIVERED',
  'CANCELED',
  'PAYMENT_FAILED',
  'REFUNDED',
] as const;

export type AccountOrderStatus = (typeof ACCOUNT_ORDER_STATUSES)[number];
export type AccountOrderRequestType = 'cancel' | 'return' | 'help';
export type AccountOrderRequestStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';

const STATUS_LABELS: Record<AccountOrderStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  PROCESSING: 'Processing',
  SCHEDULED: 'Scheduled',
  ON_THE_WAY: 'On the way',
  DELIVERED: 'Delivered',
  CANCELED: 'Canceled',
  PAYMENT_FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
};

const IN_FLIGHT = new Set<AccountOrderStatus>([
  'PENDING',
  'ACCEPTED',
  'PROCESSING',
  'SCHEDULED',
  'ON_THE_WAY',
]);

export function isAccountOrderStatus(value: unknown): value is AccountOrderStatus {
  return typeof value === 'string'
    && (ACCOUNT_ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Never trust a view column to be one of the known values. An unknown status
 * falls back to Pending rather than rendering a raw internal token.
 */
export function toAccountOrderStatus(value: unknown): AccountOrderStatus {
  return isAccountOrderStatus(value) ? value : 'PENDING';
}

export function accountOrderStatusLabel(status: AccountOrderStatus): string {
  return STATUS_LABELS[status];
}

export function isInFlightAccountOrderStatus(status: AccountOrderStatus): boolean {
  return IN_FLIGHT.has(status);
}

export function isFinalAccountOrderStatus(status: AccountOrderStatus): boolean {
  return !isInFlightAccountOrderStatus(status);
}

/**
 * The polling decision, kept pure so the cadence is testable without a DOM.
 * A final order never polls; a hidden tab never polls (the next focus tick
 * re-reads immediately).
 */
export function shouldPollAccountOrder(
  status: AccountOrderStatus,
  visibilityState: string,
): boolean {
  return visibilityState === 'visible' && !isFinalAccountOrderStatus(status);
}

export function accountPaymentStatusLabel(status: string): string {
  switch (status.trim().toUpperCase()) {
    case 'PAID':
      return 'Paid';
    case 'PROCESSING':
      return 'Payment processing';
    case 'PAYMENT_REVIEW':
      return 'Payment under review';
    case 'FAILED':
      return 'Payment failed';
    case 'CANCELLED':
      return 'Payment cancelled';
    case 'REFUNDED':
      return 'Refunded';
    default:
      return 'Payment pending';
  }
}

/** History labels are domain-aware: payment PROCESSING is never Preparing. */
export function accountOrderHistoryLabel(domain: string, status: string, method?: unknown): string | null {
  if (domain === 'fulfilment') return fulfilmentLabel(status, method);
  if (domain === 'payment') return accountPaymentStatusLabel(status);
  return null;
}

export function accountDeliveryStatusLabel(status: string | null): string {
  switch (status?.trim().toUpperCase()) {
    case 'SCHEDULED':
      return 'Scheduled';
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'FAILED':
      return 'Delivery attempt failed';
    case 'CANCELLED':
      return 'Delivery cancelled';
    case 'PENDING':
      return 'Preparing for delivery';
    default:
      return status?.trim() || 'Delivery updates pending';
  }
}

export function accountRequestTypeLabel(type: AccountOrderRequestType): string {
  if (type === 'cancel') return 'Cancellation';
  if (type === 'return') return 'Return';
  return 'Help';
}

export function accountRequestStatusLabel(status: AccountOrderRequestStatus): string {
  if (status === 'IN_PROGRESS') return 'In progress';
  if (status === 'RESOLVED') return 'Resolved';
  if (status === 'REJECTED') return 'Not approved';
  return 'Open';
}

export interface AccountOrderDeliverySnapshot {
  status: string;
  method: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  scheduledFor: string | null;
  deliverySlot: string | null;
  deliveredAt: string | null;
}

export interface AccountOrderRequestSnapshot {
  id: string;
  type: AccountOrderRequestType;
  status: AccountOrderRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AccountOrderRefundSnapshot {
  id: string;
  amountPaise: number;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
}

/** The small, owner-scoped payload used by the live order endpoint. */
export interface AccountOrderLiveStatus {
  txnid: string;
  status: AccountOrderStatus;
  paymentStatus: string;
  fulfilmentStatus: string;
  updatedAt: string;
  delivery: AccountOrderDeliverySnapshot | null;
  requests: AccountOrderRequestSnapshot[];
  refunds: AccountOrderRefundSnapshot[];
}

/* ------------------------------------------------------------- parsing */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function iso(value: unknown): string {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const REQUEST_TYPES: readonly AccountOrderRequestType[] = ['cancel', 'return', 'help'];
const REQUEST_STATUSES: readonly AccountOrderRequestStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];

/** A prepared delivery row is private until fulfilment proves pickup. */
export function toDeliverySnapshot(value: unknown, shipmentStarted = false): AccountOrderDeliverySnapshot | null {
  if (!shipmentStarted) return null;
  const row = record(value);
  const status = row ? text(row.status) : null;
  if (!row || !status) return null;
  const normalizedStatus = status.toUpperCase();
  if (normalizedStatus === 'CANCELED' || normalizedStatus === 'CANCELLED' || row.is_active === false) {
    return null;
  }
  const nullableIso = (value: unknown): string | null => {
    if (value == null) return null;
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  };
  return {
    status,
    method: text(row.method) ?? text(row.delivery_method),
    carrier: text(row.courier_name) ?? text(row.carrier),
    trackingNumber: text(row.trackingNumber) ?? text(row.tracking_number),
    trackingUrl: validateHttpsTrackingUrl(row.trackingUrl ?? row.tracking_url),
    scheduledFor: nullableIso(row.scheduledFor ?? row.scheduled_for),
    deliverySlot: text(row.deliverySlot) ?? text(row.delivery_slot),
    deliveredAt: nullableIso(row.deliveredAt ?? row.delivered_at),
  };
}

export function toRequestSnapshots(value: unknown): AccountOrderRequestSnapshot[] {
  return array(value).flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const id = text(row.id);
    const type = text(row.type);
    const status = text(row.status);
    if (!id || !type || !status) return [];
    if (!REQUEST_TYPES.includes(type as AccountOrderRequestType)) return [];
    if (!REQUEST_STATUSES.includes(status as AccountOrderRequestStatus)) return [];
    return [{
      id,
      type: type as AccountOrderRequestType,
      status: status as AccountOrderRequestStatus,
      createdAt: iso(row.createdAt ?? row.created_at),
      updatedAt: iso(row.updatedAt ?? row.updated_at),
    }];
  });
}

export function toRefundSnapshots(value: unknown): AccountOrderRefundSnapshot[] {
  return array(value).flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const id = text(row.id);
    const amount = Number(row.amountPaise ?? row.amount_paise);
    if (!id || !Number.isFinite(amount)) return [];
    return [{
      id,
      amountPaise: Math.max(0, Math.round(amount)),
      currency: text(row.currency) ?? 'INR',
      method: text(row.method) ?? 'other',
      status: text(row.status) ?? 'RECORDED',
      createdAt: iso(row.createdAt ?? row.created_at),
    }];
  });
}

/**
 * Everything the customer can see that changed, in one string. The client
 * uses it to decide whether a poll result is worth a full server re-render
 * (timeline, request buttons, totals) or only an updated chip.
 */
export function liveSignature(live: AccountOrderLiveStatus | null): string {
  if (!live) return '';
  return [
    live.status,
    live.paymentStatus,
    live.fulfilmentStatus,
    live.updatedAt,
    live.delivery
      ? JSON.stringify([
          live.delivery.status, live.delivery.method, live.delivery.carrier,
          live.delivery.trackingNumber, live.delivery.trackingUrl,
          live.delivery.scheduledFor, live.delivery.deliverySlot, live.delivery.deliveredAt,
        ])
      : 'no-delivery',
    ...live.requests.map((request) => `${request.id}:${request.status}`),
    ...live.refunds.map((refund) => `${refund.id}:${refund.status}:${refund.amountPaise}`),
  ].join('|');
}
/**
 * Pure delivery validation for the store-admin order API.
 *
 * The database has one delivery row per order.  The delivery method and the
 * optional tracking URL are stored on the delivery row and echoed into the
 * delivery-event details without copying sensitive values into audit payloads.
 */

export const DELIVERY_METHODS = ['self', 'courier'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** These are the only schedule slots accepted by the API. */
export const DELIVERY_SLOTS = ['10:00-13:00', '13:00-17:00', '17:00-20:00'] as const;
export type DeliverySlot = (typeof DELIVERY_SLOTS)[number];

export interface DeliveryInput {
  method: DeliveryMethod;
  personName: string | null;
  personPhone: string | null;
  courierName: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  scheduledFor: string;
  deliverySlot: DeliverySlot;
}

export type DeliveryValidation =
  | { ok: true; value: DeliveryInput }
  | { ok: false; error: string };

function nonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
}

export function isDeliveryMethod(value: unknown): value is DeliveryMethod {
  return typeof value === 'string' && (DELIVERY_METHODS as readonly string[]).includes(value);
}

export function isDeliverySlot(value: unknown): value is DeliverySlot {
  return typeof value === 'string' && (DELIVERY_SLOTS as readonly string[]).includes(value);
}

/** Strict calendar-date validation; date-times are not accepted here. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isTodayOrFutureDate(value: string): boolean {
  if (!isDateOnly(value)) return false;
  const today = new Date();
  const todayValue = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) >= todayValue;
}

/** Return the trimmed URL only when it is an HTTPS URL without credentials. */
export function validateHttpsTrackingUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Validate the complete delivery form. Empty optional text fields are treated
 * as absent, which lets an operator change a courier delivery back to self.
 */
export function validateDeliveryInput(input: {
  method?: unknown;
  deliveryMethod?: unknown;
  personName?: unknown;
  personPhone?: unknown;
  courierName?: unknown;
  carrier?: unknown;
  trackingNumber?: unknown;
  trackingUrl?: unknown;
  scheduledFor?: unknown;
  date?: unknown;
  deliverySlot?: unknown;
  slot?: unknown;
}): DeliveryValidation {
  const methodValue = input.deliveryMethod ?? input.method;
  if (!isDeliveryMethod(methodValue)) {
    return { ok: false, error: 'Delivery method must be self or courier.' };
  }

  const scheduledFor = input.scheduledFor ?? input.date;
  if (!isDateOnly(scheduledFor) || !isTodayOrFutureDate(scheduledFor)) {
    return { ok: false, error: 'A valid today-or-future delivery date is required.' };
  }

  const slotValue = input.deliverySlot ?? input.slot;
  if (!isDeliverySlot(slotValue)) {
    return { ok: false, error: 'Delivery slot must be 10:00-13:00, 13:00-17:00, or 17:00-20:00.' };
  }

  const personName = nonEmptyString(input.personName, 120);
  const personPhone = nonEmptyString(input.personPhone, 40);
  const courierName = nonEmptyString(input.courierName ?? input.carrier, 120);
  const carrier = courierName;
  const trackingNumber = nonEmptyString(input.trackingNumber, 200);
  const carrierText = typeof input.carrier === 'string' ? input.carrier.trim() : '';
  const trackingNumberText =
    typeof input.trackingNumber === 'string' ? input.trackingNumber.trim() : '';
  const suppliedTrackingUrl =
    typeof input.trackingUrl === 'string' ? input.trackingUrl.trim() : '';

  if (carrierText && !carrier) {
    return { ok: false, error: 'Carrier is too long or invalid.' };
  }
  if (trackingNumberText && !trackingNumber) {
    return { ok: false, error: 'Tracking number is too long or invalid.' };
  }

  if (methodValue === 'self' && (!personName || !personPhone)) {
    return { ok: false, error: 'Self delivery requires a person name and phone.' };
  }

  let trackingUrl: string | null = null;
  if (suppliedTrackingUrl) {
    trackingUrl = validateHttpsTrackingUrl(suppliedTrackingUrl);
    if (!trackingUrl) {
      return { ok: false, error: 'Tracking URL must be a valid HTTPS URL.' };
    }
  }

  if (methodValue === 'courier') {
    if (!courierName) return { ok: false, error: 'Courier deliveries require a courier name.' };
    if (!trackingNumber) {
      return {
        ok: false,
        error: 'Courier deliveries require a tracking number.',
      };
    }
  }

  if (methodValue === 'self' && (carrier || trackingNumber || trackingUrl)) {
    return {
      ok: false,
      error: 'Self deliveries cannot include courier tracking details.',
    };
  }

  return {
    ok: true,
    value: {
      method: methodValue,
      personName: methodValue === 'self' ? personName : null,
      personPhone: methodValue === 'self' ? personPhone : null,
      courierName: methodValue === 'courier' ? courierName : null,
      carrier: methodValue === 'courier' ? carrier : null,
      trackingNumber: methodValue === 'courier' ? trackingNumber : null,
      trackingUrl: methodValue === 'courier' ? trackingUrl : null,
      scheduledFor,
      deliverySlot: slotValue,
    },
  };
}

export interface DeliveryDetailsForTransit {
  method: DeliveryMethod | null;
  personName?: string | null;
  personPhone?: string | null;
  courierName?: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  scheduledFor: string | null;
  deliverySlot: string | null;
}

/** Requirements checked immediately before an order enters ON_THE_WAY. */
export function validateDeliveryDetailsForOnTheWay(
  details: DeliveryDetailsForTransit | null,
): { ok: true } | { ok: false; error: string } {
  if (!details || !details.method || !details.scheduledFor || !details.deliverySlot) {
    return { ok: false, error: 'Delivery date, slot, and method are required.' };
  }
  if (!isDateOnly(details.scheduledFor) || !isDeliverySlot(details.deliverySlot)) {
    return { ok: false, error: 'Delivery date and slot are invalid.' };
  }
  if (details.method === 'courier') {
    if (!(details.courierName || details.carrier) || !details.trackingNumber) {
      return { ok: false, error: 'Courier details require a courier name and tracking number.' };
    }
    if (details.trackingUrl && !validateHttpsTrackingUrl(details.trackingUrl)) {
      return { ok: false, error: 'Tracking URL must be a valid HTTPS URL.' };
    }
  }
  if (details.method === 'self' && (!details.personName || !details.personPhone)) {
    return { ok: false, error: 'Self delivery requires a person name and phone.' };
  }
  return { ok: true };
}

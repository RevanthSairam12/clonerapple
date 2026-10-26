/**
 * Pure rules for the Customers section: filters, groups, customer settings,
 * subscriber addresses and the coarse device label shown on login history.
 *
 * No database or Next.js imports — this file is shared by server modules,
 * route handlers, pages and the node test suite.
 */

/* ------------------------------------------------------------- filters */

export const CUSTOMER_PAGE_SIZE = 25;

export type CustomerType = 'all' | 'registered' | 'guest';
export type CustomerStatusFilter = 'all' | 'active' | 'blocked';
export type CustomerOrderPresence = 'all' | 'yes' | 'no';

export const CUSTOMER_TYPES: readonly CustomerType[] = ['all', 'registered', 'guest'];
export const CUSTOMER_STATUSES: readonly CustomerStatusFilter[] = ['all', 'active', 'blocked'];
export const CUSTOMER_ORDER_PRESENCE: readonly CustomerOrderPresence[] = ['all', 'yes', 'no'];

export interface CustomerFilters {
  query: string;
  type: CustomerType;
  status: CustomerStatusFilter;
  orders: CustomerOrderPresence;
  /** Start of the range, inclusive (ISO), or null. */
  fromIso: string | null;
  /** Start of the day after `to`, exclusive (ISO), or null. */
  toIso: string | null;
  /** Lifetime value bounds in rupees, or null. */
  minSpend: number | null;
  maxSpend: number | null;
  page: number;
}

export type ParsedCustomerFilters =
  | { ok: true; filters: CustomerFilters }
  | { ok: false; error: string };

export function isCustomerType(value: unknown): value is CustomerType {
  return typeof value === 'string' && (CUSTOMER_TYPES as readonly string[]).includes(value);
}

export function isCustomerStatus(value: unknown): value is CustomerStatusFilter {
  return typeof value === 'string' && (CUSTOMER_STATUSES as readonly string[]).includes(value);
}

export function isCustomerOrderPresence(value: unknown): value is CustomerOrderPresence {
  return (
    typeof value === 'string' &&
    (CUSTOMER_ORDER_PRESENCE as readonly string[]).includes(value)
  );
}

/** `2026-10-24` → midnight UTC of that day, or null when the date is invalid. */
export function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-30 and similar: the round-trip must match.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Spend bounds are whole rupees or rupees with up to two decimals. */
export function parseSpend(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  return Number(trimmed);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Validate raw query-string values (Next gives `string | string[] | undefined`).
 * Unknown or malformed values fall back to the default rather than throwing,
 * except for spend/date ranges, which surface a readable error so the operator
 * knows the filter was ignored.
 */
export function parseCustomerFilters(
  params: Record<string, string | string[] | undefined>,
): ParsedCustomerFilters {
  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value ?? '').trim();
  };

  const type = read('type');
  const status = read('status');
  const orders = read('orders');
  const from = read('from');
  const to = read('to');
  const minSpendText = read('min');
  const maxSpendText = read('max');
  const requestedPage = Number.parseInt(read('page'), 10);

  const fromDate = from ? parseIsoDay(from) : null;
  if (from && !fromDate) return { ok: false, error: 'The start date is not a valid date.' };

  const toDate = to ? parseIsoDay(to) : null;
  if (to && !toDate) return { ok: false, error: 'The end date is not a valid date.' };

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  const minSpend = minSpendText ? parseSpend(minSpendText) : null;
  if (minSpendText && minSpend === null) {
    return { ok: false, error: 'The minimum spend must be a rupee amount.' };
  }
  const maxSpend = maxSpendText ? parseSpend(maxSpendText) : null;
  if (maxSpendText && maxSpend === null) {
    return { ok: false, error: 'The maximum spend must be a rupee amount.' };
  }
  if (minSpend !== null && maxSpend !== null && minSpend > maxSpend) {
    return { ok: false, error: 'The maximum spend cannot be below the minimum.' };
  }

  return {
    ok: true,
    filters: {
      query: read('q').slice(0, 100),
      type: isCustomerType(type) ? type : 'all',
      status: isCustomerStatus(status) ? status : 'all',
      orders: isCustomerOrderPresence(orders) ? orders : 'all',
      fromIso: fromDate ? fromDate.toISOString() : null,
      toIso: toDate ? new Date(toDate.getTime() + DAY_MS).toISOString() : null,
      minSpend,
      maxSpend,
      page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    },
  };
}

/* -------------------------------------------------------------- groups */

export type CustomerGroup = 'retail' | 'vip' | 'wholesale';

export const CUSTOMER_GROUPS: readonly CustomerGroup[] = ['retail', 'vip', 'wholesale'];

export const CUSTOMER_GROUP_LABELS: Readonly<Record<CustomerGroup, string>> = {
  retail: 'Retail',
  vip: 'VIP',
  wholesale: 'Wholesale',
};

export function isCustomerGroup(value: unknown): value is CustomerGroup {
  return typeof value === 'string' && (CUSTOMER_GROUPS as readonly string[]).includes(value);
}

/* ------------------------------------------------------ customer settings */

export type CustomerSettingKey =
  | 'guest_checkout'
  | 'default_customer_group'
  | 'checkout_marketing_optin';

export const CUSTOMER_SETTING_KEYS: readonly CustomerSettingKey[] = [
  'guest_checkout',
  'default_customer_group',
  'checkout_marketing_optin',
];

export const CUSTOMER_SETTING_LABELS: Readonly<Record<CustomerSettingKey, string>> = {
  guest_checkout: 'Allow guest checkout',
  default_customer_group: 'Default customer group',
  checkout_marketing_optin: 'Show the offer opt-in at checkout',
};

export type CustomerSettings = Record<CustomerSettingKey, string>;

export const DEFAULT_CUSTOMER_SETTINGS: CustomerSettings = {
  guest_checkout: 'off',
  default_customer_group: 'retail',
  checkout_marketing_optin: 'off',
};

export function isCustomerSettingKey(value: unknown): value is CustomerSettingKey {
  return (
    typeof value === 'string' &&
    (CUSTOMER_SETTING_KEYS as readonly string[]).includes(value)
  );
}

export function isOn(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'on';
}

export type CustomerSettingValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateCustomerSettingValue(
  key: CustomerSettingKey,
  value: unknown,
): CustomerSettingValidation {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (key === 'default_customer_group') {
    if (!isCustomerGroup(text)) {
      return { ok: false, error: 'Choose retail, VIP or wholesale.' };
    }
    return { ok: true, value: text };
  }
  if (text !== 'on' && text !== 'off') {
    return { ok: false, error: 'Choose on or off.' };
  }
  return { ok: true, value: text };
}

/* ---------------------------------------------------------- subscribers */

export type SubscriberSource = 'storefront' | 'checkout' | 'manual' | 'import';

export const SUBSCRIBER_SOURCES: readonly SubscriberSource[] = [
  'storefront',
  'checkout',
  'manual',
  'import',
];

export const SUBSCRIBER_SOURCE_LABELS: Readonly<Record<SubscriberSource, string>> = {
  storefront: 'Storefront',
  checkout: 'Checkout opt-in',
  manual: 'Added by staff',
  import: 'Imported',
};

export function isSubscriberSource(value: unknown): value is SubscriberSource {
  return (
    typeof value === 'string' && (SUBSCRIBER_SOURCES as readonly string[]).includes(value)
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SUBSCRIBER_EMAIL_MAX = 254;

/** Normalise and validate a newsletter address; returns lower-case. */
export function validateSubscriberEmail(
  value: unknown,
): { ok: true; email: string } | { ok: false; error: string } {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) return { ok: false, error: 'Enter an email address.' };
  if (email.length > SUBSCRIBER_EMAIL_MAX) {
    return { ok: false, error: 'That email address is too long.' };
  }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, email };
}

/* -------------------------------------------------------------- reasons */

export const BLOCK_REASON_MIN = 5;
export const BLOCK_REASON_MAX = 200;

export function blockReasonError(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < BLOCK_REASON_MIN || reason.length > BLOCK_REASON_MAX) {
    return `A reason of ${BLOCK_REASON_MIN}-${BLOCK_REASON_MAX} characters is required.`;
  }
  return null;
}

export const UNSUBSCRIBE_REASON_MAX = 300;

export function unsubscribeReasonError(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length > UNSUBSCRIBE_REASON_MAX) {
    return `Keep the reason under ${UNSUBSCRIBE_REASON_MAX} characters.`;
  }
  return null;
}

/* ---------------------------------------------------------- device label */

const DEVICE_MAX = 60;

/**
 * Turn a user agent into the short label shown on a session card, e.g.
 * `Chrome · Windows`. The raw user agent is never stored.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'Unknown device';

  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) || /CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl';

  let platform = '';
  if (/iPhone|iPad|iPod/i.test(ua)) platform = 'iOS';
  else if (/Android/i.test(ua)) platform = 'Android';
  else if (/Windows NT/i.test(ua)) platform = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) platform = 'macOS';
  else if (/Linux/i.test(ua)) platform = 'Linux';

  const label = [browser, platform].filter(Boolean).join(' · ');
  if (!label) return 'Unknown device';
  return label.slice(0, DEVICE_MAX);
}

/* --------------------------------------------------------- block reason */

/** The temporary address written over an anonymised account's email. */
export function anonymisedEmail(userId: string): string {
  return `deleted-${userId}@anonymised.invalid`;
}

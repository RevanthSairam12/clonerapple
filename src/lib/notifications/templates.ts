/**
 * Rendering for notification templates.
 *
 * Two sources feed a message: a stored template (`email_templates` or
 * `automated_messages`) and, when that is missing or blank, a built-in default
 * for the event. A customer never receives an empty email because an admin
 * cleared a row.
 *
 * Substitution is deliberately narrow. Only the names in `TEMPLATE_VARIABLES`
 * are read, always from a plain object built field by field, never from the
 * event or a database row. Unknown names render empty. Values are control-
 * character stripped for every channel, escaped for HTML email, and flattened
 * to one line for subjects and SMS so a newline cannot inject a mail header.
 *
 * Email bodies are treated as plain text: the whole rendered body is escaped
 * and newlines become <br>. That keeps a stored `<script>` harmless and means
 * customer data can never become markup.
 *
 * Pure module: no database, no Next.js, no environment access.
 */

import type {
  NotificationAudience,
  NotificationChannel,
  NotificationEvent,
} from './types';

export const TEMPLATE_VARIABLES = [
  'order_number',
  'order_id',
  'txnid',
  'customer_name',
  'order_total',
  'total',
  'shipping_amount',
  'order_status',
  'tracking_number',
  'tracking_url',
  'tracking_link',
  'store_name',
  'support_phone',
  'support_email',
  'return_window_days',
  'refund_amount',
  'item_count',
  'product_name',
  'stock_available',
  'admin_link',
] as const;

const VARIABLE_SET = new Set<string>(TEMPLATE_VARIABLES);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TEMPLATE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** HTML-escape a value that is about to become email markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remove characters that can break a header or a terminal line. */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Format paise the same way the storefront and receipts do. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function money(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatPaise(value) : '';
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  CREATED: 'created',
  PAID: 'paid',
  FAILED: 'payment failed',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PROCESSING: 'processing',
  ON_THE_WAY: 'on the way',
  DELIVERED: 'delivered',
  REFUNDED: 'refunded',
  SCHEDULED: 'scheduled',
};

/** "ON_THE_WAY" → "on the way"; an unknown value is still readable. */
export function statusLabel(value: string | null | undefined): string {
  const key = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!key) return '';
  return STATUS_LABELS[key] ?? key.toLowerCase().replace(/_/g, ' ');
}

/** Only an https URL without embedded credentials can reach a message. */
export function safeHttpsUrl(value: string | null | undefined): string {
  const candidate = stripControlChars(text(value));
  if (!candidate || candidate.length > 2048) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * Links in email: https only, plus a same-site path resolved against the app
 * base. `javascript:` and protocol-relative URLs are rejected.
 */
export function safeEmailLink(value: string | null | undefined, baseUrl: string): string {
  const candidate = stripControlChars(text(value));
  if (!candidate || candidate.length > 2048) return '';

  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    const base = text(baseUrl).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    return `${base}${candidate}`;
  }

  return safeHttpsUrl(candidate);
}

/**
 * Every value a template may see, built explicitly from the event context.
 * Customer messages carry the customer's name; staff messages do not.
 */
export function templateValues(input: {
  audience: NotificationAudience;
  txnid?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  orderTotalPaise?: number | null;
  shippingPaise?: number | null;
  refundPaise?: number | null;
  orderStatus?: string | null;
  trackingNumber?: string | null;
  trackingLink?: string | null;
  itemCount?: number | null;
  productName?: string | null;
  stockAvailable?: number | null;
  storeName?: string | null;
  supportPhone?: string | null;
  supportEmail?: string | null;
  returnWindowDays?: string | number | null;
  adminLink?: string | null;
}): Record<string, string> {
  const orderNumber = text(input.orderNumber) || text(input.txnid);
  const customerName = input.audience === 'customer'
    ? text(input.customerName) || 'there'
    : '';
  const adminLink = stripControlChars(text(input.adminLink));
  const returnWindow = text(input.returnWindowDays) || '7';

  return {
    order_number: orderNumber,
    order_id: orderNumber,
    txnid: orderNumber,
    customer_name: customerName,
    order_total: money(input.orderTotalPaise),
    total: money(input.orderTotalPaise),
    shipping_amount: money(input.shippingPaise),
    order_status: statusLabel(input.orderStatus),
    tracking_number: text(input.trackingNumber),
    tracking_url: safeHttpsUrl(input.trackingLink),
    tracking_link: safeHttpsUrl(input.trackingLink),
    store_name: text(input.storeName) || 'Gadzio',
    support_phone: text(input.supportPhone),
    support_email: text(input.supportEmail),
    return_window_days: returnWindow,
    refund_amount: money(input.refundPaise),
    item_count: numberText(input.itemCount),
    product_name: text(input.productName),
    stock_available: numberText(input.stockAvailable),
    admin_link: adminLink,
  };
}

/** Replace whitelisted tokens; everything else becomes an empty string. */
export function substitute(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return String(template ?? '').replace(TEMPLATE_TOKEN, (_match, name: string) => {
    const key = name.toLowerCase();
    return VARIABLE_SET.has(key) ? values[key] ?? '' : '';
  });
}

/**
 * Render as text. `singleLine` is used for subjects and SMS, where a newline
 * from a value must not survive.
 */
export function renderText(
  template: string,
  values: Readonly<Record<string, string>>,
  singleLine = false,
): string {
  const rendered = stripControlChars(substitute(template, values)).replace(/\r\n?/g, '\n');
  return singleLine ? rendered.replace(/\s+/g, ' ').trim() : rendered.trim();
}

function supportLine(values: Readonly<Record<string, string>>): string {
  const parts = [values.support_email, values.support_phone].filter(Boolean);
  return parts.join(' · ');
}

function defaultFooter(values: Readonly<Record<string, string>>): string {
  const store = values.store_name || 'Gadzio';
  const support = supportLine(values);
  return `This is an automated message from ${store}.${support ? ` Questions? ${support}.` : ''}`;
}

export interface EmailParts {
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Compose the HTML and plain-text versions of an email. The stored/default
 * template parts are already merged by the caller; a blank part falls back to
 * a sensible default here rather than sending a blank message.
 */
export function renderEmail(
  parts: EmailParts,
  values: Readonly<Record<string, string>>,
  baseUrl: string,
): RenderedEmail {
  const subject = renderText(parts.subject, values, true) || 'Notification from Gadzio';
  const heading = renderText(parts.heading, values, true);
  const body = renderText(parts.body, values);
  const buttonLabel = renderText(parts.buttonLabel, values, true);
  const buttonUrl = safeEmailLink(renderText(parts.buttonUrl, values, true), baseUrl);
  const footer = parts.footer
    ? renderText(parts.footer, values)
    : defaultFooter(values);

  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');
  const buttonHtml = buttonUrl && buttonLabel
    ? `<p style="margin:24px 0"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:980px;font-size:15px">${escapeHtml(buttonLabel)}</a></p>`
    : '';

  const headingHtml = heading
    ? `<h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#1d1d1f">${escapeHtml(heading)}</h1>`
    : '';
  const bodyBlock = body
    ? `<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#1d1d1f">${bodyHtml}</p>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
${headingHtml}${bodyBlock}${buttonHtml}<p style="font-size:12px;line-height:1.5;margin:24px 0 0;color:#6e6e73">${escapeHtml(footer)}</p>
</div></body></html>`;

  const textParts = [heading, body, buttonUrl, footer].filter(Boolean);

  return { subject, text: textParts.join('\n\n'), html };
}

interface Copy {
  subject: string;
  heading: string;
  body: string;
  sms: string;
  buttonLabel?: string;
  buttonUrl?: string;
}

const CUSTOMER = 'customer' as const;
const STAFF = 'staff' as const;

/**
 * Built-in copy for every event and audience. A missing stored template never
 * means a silent or blank message.
 */
const EVENT_COPY: Readonly<Record<NotificationEvent, Readonly<Record<NotificationAudience, Copy>>>> = {
  order_placed: {
    [CUSTOMER]: {
      subject: 'Order {{order_number}} received',
      heading: 'Thank you for your order',
      body: 'Hi {{customer_name}},\n\nWe have received order {{order_number}} for {{order_total}}.\n\nWe will email you again when it is on the way.',
      sms: '{{store_name}}: order {{order_number}} received. Total {{order_total}}.',
      buttonLabel: 'View your order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'New order {{order_number}}',
      heading: 'New order received',
      body: 'Order {{order_number}} for {{order_total}} ({{item_count}} item(s)) was placed.',
      sms: '{{store_name}}: new order {{order_number}} for {{order_total}}.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  payment_received: {
    [CUSTOMER]: {
      subject: 'Payment received for {{order_number}}',
      heading: 'Payment received',
      body: 'Hi {{customer_name}},\n\nWe have received {{order_total}} for order {{order_number}}. Your order is confirmed.',
      sms: '{{store_name}}: payment of {{order_total}} received for {{order_number}}.',
      buttonLabel: 'View your order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Payment received: {{order_number}}',
      heading: 'Payment received',
      body: 'Order {{order_number}} was paid. Total {{order_total}}.',
      sms: '{{store_name}}: {{order_number}} paid {{order_total}}.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  processing: {
    [CUSTOMER]: {
      subject: 'Order {{order_number}} is being prepared',
      heading: 'We are preparing your order',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} is being prepared for dispatch.',
      sms: '{{store_name}}: order {{order_number}} is being prepared.',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} in processing',
      heading: 'Order moved to processing',
      body: 'Order {{order_number}} is now {{order_status}}.',
      sms: '{{order_number}} is now {{order_status}}.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  shipped: {
    [CUSTOMER]: {
      subject: 'Order {{order_number}} has shipped',
      heading: 'Your order is on the way',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} has shipped.\n\nTracking number: {{tracking_number}}',
      sms: '{{store_name}}: order {{order_number}} shipped. Tracking {{tracking_number}}.',
      buttonLabel: 'Track shipment',
      buttonUrl: '{{tracking_link}}',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} shipped',
      heading: 'Order shipped',
      body: 'Order {{order_number}} is now {{order_status}}.',
      sms: '{{order_number}} shipped.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  delivered: {
    [CUSTOMER]: {
      subject: 'Order {{order_number}} delivered',
      heading: 'Delivered',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} was delivered. If something is wrong, contact us within {{return_window_days}} days.',
      sms: '{{store_name}}: order {{order_number}} delivered.',
      buttonLabel: 'View your order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} delivered',
      heading: 'Order delivered',
      body: 'Order {{order_number}} is now {{order_status}}.',
      sms: '{{order_number}} delivered.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  cancelled: {
    [CUSTOMER]: {
      subject: 'Order {{order_number}} cancelled',
      heading: 'Order cancelled',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} has been cancelled. If a payment was taken, any refund follows the store refund policy.',
      sms: '{{store_name}}: order {{order_number}} cancelled.',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} cancelled',
      heading: 'Order cancelled',
      body: 'Order {{order_number}} was cancelled. Total {{order_total}}.',
      sms: '{{order_number}} cancelled.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  refund_requested: {
    [CUSTOMER]: {
      subject: 'We received your request for {{order_number}}',
      heading: 'Request received',
      body: 'Hi {{customer_name}},\n\nWe have received your request for order {{order_number}}. Our team will review it and reply soon.',
      sms: '{{store_name}}: request received for order {{order_number}}.',
    },
    [STAFF]: {
      subject: 'New request for {{order_number}}',
      heading: 'New customer request',
      body: 'A request was opened for order {{order_number}}.',
      sms: '{{order_number}}: new customer request.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  refund_completed: {
    [CUSTOMER]: {
      subject: 'Refund completed for {{order_number}}',
      heading: 'Refund completed',
      body: 'Hi {{customer_name}},\n\nA refund of {{refund_amount}} for order {{order_number}} has been completed. It may take a few days to appear in your account.',
      sms: '{{store_name}}: refund of {{refund_amount}} completed for {{order_number}}.',
    },
    [STAFF]: {
      subject: 'Refund completed: {{order_number}}',
      heading: 'Refund completed',
      body: 'A refund of {{refund_amount}} was recorded for order {{order_number}}.',
      sms: '{{order_number}}: refund {{refund_amount}} completed.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  back_in_stock: {
    [CUSTOMER]: {
      subject: '{{product_name}} is back in stock',
      heading: 'Back in stock',
      body: '{{product_name}} is available again. Order soon while stock lasts.',
      sms: '{{store_name}}: {{product_name}} is back in stock.',
    },
    [STAFF]: {
      subject: 'Back in stock: {{product_name}}',
      heading: 'Back in stock',
      body: '{{product_name}} is back in stock ({{stock_available}} available).',
      sms: '{{product_name}} back in stock.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  password_reset: {
    [CUSTOMER]: {
      subject: 'Your password was reset',
      heading: 'Password updated',
      body: 'Hi {{customer_name}},\n\nThe password for your account was changed. If this was not you, contact us at {{support_email}}.',
      sms: '{{store_name}}: your password was changed. If this was not you, contact support.',
    },
    [STAFF]: {
      subject: 'Staff password reset',
      heading: 'Password updated',
      body: 'The password for this staff account was changed. If this was not expected, contact the store owner.',
      sms: '{{store_name}}: staff password was changed.',
    },
  },
  staff_invite: {
    [CUSTOMER]: {
      subject: 'Your account is ready',
      heading: 'Account created',
      body: 'An account was created for you at {{store_name}}.',
      sms: '{{store_name}}: your account is ready.',
    },
    [STAFF]: {
      subject: 'Your staff account is ready',
      heading: 'Welcome to the team',
      body: 'A staff account has been created for you at {{store_name}}. Sign in to Store Admin and change your password when prompted.',
      sms: '{{store_name}}: your staff account is ready. Sign in and change your password.',
    },
  },
  low_stock: {
    [CUSTOMER]: {
      subject: '{{product_name}} is low in stock',
      heading: 'Low stock',
      body: 'Hurry, {{product_name}} is low in stock.',
      sms: '{{store_name}}: {{product_name}} is low in stock.',
    },
    [STAFF]: {
      subject: 'Low stock: {{product_name}}',
      heading: 'Low stock alert',
      body: '{{product_name}} is low on stock ({{stock_available}} available).',
      sms: '{{store_name}}: low stock for {{product_name}} ({{stock_available}} left).',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
};

export function defaultTemplate(
  event: NotificationEvent,
  channel: NotificationChannel,
  audience: NotificationAudience,
): EmailParts {
  const copy = EVENT_COPY[event][audience];
  if (channel === 'sms') {
    return {
      subject: copy.subject,
      heading: '',
      body: copy.sms,
      buttonLabel: '',
      buttonUrl: '',
      footer: '',
    };
  }
  if (channel === 'inapp') {
    return {
      subject: copy.subject,
      heading: copy.heading,
      body: copy.sms,
      buttonLabel: '',
      buttonUrl: '',
      footer: '',
    };
  }
  return {
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    buttonLabel: copy.buttonLabel ?? '',
    buttonUrl: copy.buttonUrl ?? '',
    footer: '',
  };
}

import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/platform/db';
import { writeAudit, type AuditInput } from './audit';

import { buildTrackingUrl } from './delivery';

/**
 * The small configuration lists behind the settings screens: couriers,
 * shipping methods, payment methods, pages, SEO rows, social links, analytics,
 * integrations, message templates, automated messages and reason lists.
 *
 * One engine, one descriptor per list. The table and column names come from
 * the fixed map below and never from a request, so the dynamic SQL cannot be
 * steered by a caller. Every value is still a bound parameter.
 *
 * Rows are never hard-deleted: configuration is hidden with `is_active` so
 * historical references keep their meaning (the same rule the reason lists
 * have followed since 0023).
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Settings lists must be read and written on the server only.');
}

type Row = Record<string, unknown>;

export type ListFieldKind = 'text' | 'textarea' | 'number' | 'money' | 'toggle' | 'select' | 'slug';

export interface ListField {
  column: string;
  label: string;
  kind: ListFieldKind;
  max?: number;
  options?: readonly { value: string; label: string }[];
  help?: string;
  required?: boolean;
  /** Only accepted when creating; the key of an existing row is stable. */
  createOnly?: boolean;
  /** An empty value is stored as NULL (used by media references). */
  nullable?: boolean;
  /** Extra pattern for slug fields, mirroring the table's check constraint. */
  pattern?: string;
  /** Value used when creating a row; defaults to on for toggles. */
  defaultValue?: string;
  /** Upper bound for number fields, mirroring the table's check constraint. */
  maxValue?: number;
}

export interface ListKind {
  key: string;
  label: string;
  description: string;
  table: string;
  idColumn: string;
  idPrefix: string;
  orderBy: string;
  fields: readonly ListField[];
  /** Fixed rows exist already (SEO pages); the UI edits but never adds. */
  fixedRows?: boolean;
}

const ACTIVE_FIELD: ListField = {
  column: 'is_active',
  label: 'Active',
  kind: 'toggle',
  required: true,
  help: 'Turn off to hide this entry without deleting historical references.',
};

const SORT_FIELD: ListField = {
  column: 'sort_order',
  label: 'Order',
  kind: 'number',
  required: true,
  maxValue: 9999,
  help: 'Display order (0–9999). Lower numbers appear first.',
};

export const LIST_KINDS: Record<string, ListKind> = {
  'fulfilment-providers': {
    key: 'fulfilment-providers',
    label: 'Couriers',
    description:
      'Courier names and the tracking URL template. Use {tracking} where the number belongs.',
    table: 'fulfilment_providers',
    idColumn: 'id',
    idPrefix: 'fp',
    orderBy: 'sort_order asc, name asc',
    fields: [
      { column: 'name', label: 'Courier name', kind: 'text', max: 120, required: true, help: 'Name of the delivery partner shown on shipment records.' },
      {
        column: 'tracking_template',
        label: 'Tracking URL template',
        kind: 'text',
        max: 500,
        help: 'Example: https://courier.example/track?awb={tracking}',
      },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'shipping-methods': {
    key: 'shipping-methods',
    label: 'Shipping methods',
    description: 'Not active yet for checkout pricing (checkout uses the single Shipping charge and threshold above). Retained for reference.',
    table: 'shipping_methods',
    idColumn: 'id',
    idPrefix: 'sm',
    orderBy: 'sort_order asc, name asc',
    fields: [
      { column: 'name', label: 'Method', kind: 'text', max: 120, required: true, help: 'Not active yet. Legacy shipping method name.' },
      { column: 'rate_paise', label: 'Rate (₹)', kind: 'money', required: true, help: 'Not active yet. Legacy per-method rate in rupees.' },
      { column: 'free_over_paise', label: 'Free over (₹)', kind: 'money', required: true, help: 'Not active yet. Legacy per-method free-shipping threshold.' },
      { column: 'eta_min_days', label: 'Minimum days', kind: 'number', required: true, maxValue: 365, help: 'Estimated minimum delivery days (0–365).' },
      { column: 'eta_max_days', label: 'Maximum days', kind: 'number', required: true, maxValue: 365, help: 'Estimated maximum delivery days (0–365).' },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'payment-methods': {
    key: 'payment-methods',
    label: 'Payment methods',
    description:
      'Gateway, cash-on-delivery and manual methods. Gateway keys themselves stay in environment variables.',
    table: 'payment_methods',
    idColumn: 'id',
    idPrefix: 'pm',
    orderBy: 'sort_order asc, label asc',
    fields: [
      {
        column: 'code',
        label: 'Code',
        kind: 'slug',
        max: 40,
        required: true,
        createOnly: true,
        pattern: '^[a-z0-9_]+$',
        help: 'Lowercase identifier for this payment method (cannot be changed after creation).',
      },
      { column: 'label', label: 'Label', kind: 'text', max: 120, required: true, help: 'Display name for this payment method in admin screens.' },
      {
        column: 'kind',
        label: 'Kind',
        kind: 'select',
        required: true,
        defaultValue: 'manual',
        help: 'Whether this method is an online gateway, cash on delivery, or a manual offline entry.',
        options: [
          { value: 'gateway', label: 'Gateway' },
          { value: 'cod', label: 'Cash on delivery' },
          { value: 'manual', label: 'Manual' },
        ],
      },
      { column: 'instructions', label: 'Instructions', kind: 'textarea', max: 1000, help: 'Optional instructions for staff or customers when using this method.' },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'social-links': {
    key: 'social-links',
    label: 'Social links',
    description: 'Not active yet on the storefront footer. Saved for future social links display.',
    table: 'social_links',
    idColumn: 'id',
    idPrefix: 'sl',
    orderBy: 'sort_order asc, network asc',
    fields: [
      {
        column: 'network',
        label: 'Network',
        kind: 'select',
        required: true,
        defaultValue: 'instagram',
        help: 'Not active yet. Social platform for this profile link.',
        options: [
          { value: 'instagram', label: 'Instagram' },
          { value: 'facebook', label: 'Facebook' },
          { value: 'youtube', label: 'YouTube' },
          { value: 'x', label: 'X' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'linkedin', label: 'LinkedIn' },
        ],
      },
      { column: 'url', label: 'URL', kind: 'text', max: 500, required: true, help: 'Not active yet. Full https:// profile URL.' },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'analytics-scripts': {
    key: 'analytics-scripts',
    label: 'Analytics',
    description: 'Not active yet on the storefront. Saved for future analytics integration.',
    table: 'analytics_scripts',
    idColumn: 'id',
    idPrefix: 'an',
    orderBy: 'provider asc',
    fields: [
      {
        column: 'provider',
        label: 'Provider',
        kind: 'select',
        required: true,
        defaultValue: 'ga4',
        help: 'Not active yet. Analytics platform provider.',
        options: [
          { value: 'ga4', label: 'GA4' },
          { value: 'gtm', label: 'Google Tag Manager' },
          { value: 'meta_pixel', label: 'Meta Pixel' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'snapchat', label: 'Snapchat' },
          { value: 'pinterest', label: 'Pinterest' },
          { value: 'linkedin', label: 'LinkedIn' },
          { value: 'x', label: 'X' },
        ],
      },
      { column: 'script_id', label: 'Measurement / script id', kind: 'text', max: 160, help: 'Not active yet. Public measurement or pixel ID (never paste secret API keys here).' },
      { ...ACTIVE_FIELD, defaultValue: 'off' },
    ],
  },
  integrations: {
    key: 'integrations',
    label: 'Integrations',
    description:
      'Not active yet. Non-secret configuration only. API keys, SMTP passwords and gateway salts stay in environment variables.',
    table: 'store_integrations',
    idColumn: 'id',
    idPrefix: 'int',
    orderBy: 'provider asc',
    fields: [
      { column: 'provider', label: 'Provider', kind: 'text', max: 120, required: true, help: 'Not active yet. Name of the external service provider.' },
      { column: 'region', label: 'Region', kind: 'text', max: 80, help: 'Not active yet. Cloud or service region identifier.' },
      { column: 'bucket', label: 'Bucket', kind: 'text', max: 120, help: 'Not active yet. Storage bucket or container name.' },
      { column: 'sender_identity', label: 'Sender identity', kind: 'text', max: 200, help: 'Not active yet. Non-secret sender address or identifier.' },
      { column: 'webhook_url', label: 'Webhook URL', kind: 'text', max: 500, help: 'Not active yet. Outbound webhook endpoint URL.' },
      { ...ACTIVE_FIELD, defaultValue: 'off' },
    ],
  },
  'automated-messages': {
    key: 'automated-messages',
    label: 'Automated messages',
    description: 'Overrides for outbound notification copy. Sent by the notification outbox when the event fires.',
    table: 'automated_messages',
    idColumn: 'id',
    idPrefix: 'am',
    orderBy: 'label asc',
    fields: [
      {
        column: 'message_key',
        label: 'Key',
        kind: 'slug',
        max: 60,
        required: true,
        createOnly: true,
        pattern: '^[a-z0-9_.]+$',
        help: 'Notification event key (such as order_placed, payment_received, shipped).',
      },
      { column: 'label', label: 'Label', kind: 'text', max: 120, required: true, help: 'Admin display name for this automated message.' },
      {
        column: 'channel',
        label: 'Channel',
        kind: 'select',
        required: true,
        defaultValue: 'email',
        help: 'Delivery channel this message copy applies to (Email, SMS or In-app).',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS' },
          { value: 'inapp', label: 'In-app' },
        ],
      },
      { column: 'subject', label: 'Subject', kind: 'text', max: 200, help: 'Subject line or short title for the message.' },
      { column: 'body', label: 'Body', kind: 'textarea', max: 4000, help: 'Tokens: {{order_id}}, {{customer_name}}, {{total}}, {{tracking_url}}, {{store_name}}' },
      { column: 'delay_minutes', label: 'Delay (minutes)', kind: 'number', required: true, maxValue: 10080, help: 'Not active yet. Messages are currently queued immediately when the event occurs.' },
      ACTIVE_FIELD,
    ],
  },
  'email-templates': {
    key: 'email-templates',
    label: 'Email templates',
    description: 'Tokens are checked on save: {{order_id}}, {{customer_name}}, {{total}}, {{tracking_url}}, {{refund_amount}}, {{store_name}}.',
    table: 'email_templates',
    idColumn: 'id',
    idPrefix: 'et',
    orderBy: 'name asc',
    fields: [
      {
        column: 'template_key',
        label: 'Key',
        kind: 'slug',
        max: 60,
        required: true,
        createOnly: true,
        pattern: '^[a-z0-9_.]+$',
        help: 'Notification event key that uses this email template (for example order_placed).',
      },
      { column: 'name', label: 'Name', kind: 'text', max: 120, required: true, help: 'Internal display name for this email template.' },
      { column: 'subject', label: 'Subject', kind: 'text', max: 200, help: 'Email subject line. Leave blank to keep the built-in subject.' },
      { column: 'heading', label: 'Heading', kind: 'text', max: 200, help: 'Main heading inside the email banner.' },
      { column: 'body', label: 'Body', kind: 'textarea', max: 8000, help: 'Email body text. Whitelisted tokens like {{order_id}} and {{customer_name}} are substituted safely.' },
      { column: 'button_label', label: 'Button label', kind: 'text', max: 80, help: 'Call-to-action button text inside the email.' },
      { column: 'button_url', label: 'Button URL', kind: 'text', max: 500, help: 'Destination link for the email button.' },
      { column: 'footer_text', label: 'Footer', kind: 'text', max: 500, help: 'Small footer note at the bottom of the email.' },
      ACTIVE_FIELD,
    ],
  },
  pages: {
    key: 'pages',
    label: 'Store pages',
    description: 'Policy and information pages (/privacy, /terms, /support). Published pages override the built-in fallback copy.',
    table: 'store_pages',
    idColumn: 'id',
    idPrefix: 'page',
    orderBy: 'title asc',
    fields: [
      {
        column: 'slug',
        label: 'Slug',
        kind: 'slug',
        max: 80,
        required: true,
        createOnly: true,
        pattern: '^[a-z0-9-]+$',
        help: 'URL slug (such as privacy, terms, or support). Cannot be changed after creation.',
      },
      { column: 'title', label: 'Title', kind: 'text', max: 160, required: true, help: 'Page heading shown at the top of the policy or support page.' },
      { column: 'body', label: 'Body (Markdown)', kind: 'textarea', max: 40000, help: 'Page content written in plain paragraphs and headings. Leave empty or draft to use the built-in text.' },
      { column: 'seo_title', label: 'SEO title', kind: 'text', max: 160, help: 'Browser tab title for this page when published.' },
      { column: 'seo_description', label: 'SEO description', kind: 'textarea', max: 320, help: 'Search engine summary description for this page when published.' },
      {
        column: 'status',
        label: 'Status',
        kind: 'select',
        required: true,
        defaultValue: 'draft',
        help: 'Set to Published to display this page content on the storefront; Draft keeps the built-in fallback copy.',
        options: [
          { value: 'draft', label: 'Draft' },
          { value: 'published', label: 'Published' },
        ],
      },
    ],
  },
  seo: {
    key: 'seo',
    label: 'Page SEO',
    description: 'Fallback SEO metadata per page key (privacy, terms, support, search). Homepage, Cases and Education SEO are managed under Website → Content.',
    table: 'seo_pages',
    idColumn: 'page_key',
    idPrefix: 'seo',
    orderBy: 'page_key asc',
    fixedRows: true,
    fields: [
      { column: 'meta_title', label: 'Meta title', kind: 'text', max: 160, help: 'Fallback browser tab title for this page key (use Website → Content for homepage, Cases and Education).' },
      { column: 'meta_description', label: 'Meta description', kind: 'textarea', max: 320, help: 'Fallback search engine summary description for this page key.' },
      {
        column: 'meta_image_media_id',
        label: 'Meta image media id',
        kind: 'text',
        max: 120,
        nullable: true,
        help: 'Not active yet. Media library ID for social sharing image.',
      },
      { column: 'robots_index', label: 'Robots: index', kind: 'toggle', required: true, help: 'Allow search engines to index this page.' },
      { column: 'robots_follow', label: 'Robots: follow', kind: 'toggle', required: true, help: 'Allow search engines to follow links on this page.' },
    ],
  },
  'bill-request-reasons': {
    key: 'bill-request-reasons',
    label: 'Bill request reasons',
    description: 'Customer reasons for requesting a provisional bill before shipment. Other is always available.',
    table: 'bill_request_reasons',
    idColumn: 'id',
    idPrefix: 'blr',
    orderBy: 'sort_order asc, label asc',
    fields: [
      { column: 'label', label: 'Reason', kind: 'text', max: 160, required: true, help: 'Shown to customers after successful payment. Hide unused reasons; submitted requests retain their original label. Other is supplied automatically.' },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'refund-reasons': {
    key: 'refund-reasons',
    label: 'Refund reasons',
    description: 'Pick-list for recording a refund.',
    table: 'refund_reasons',
    idColumn: 'id',
    idPrefix: 'rfr',
    orderBy: 'sort_order asc, label asc',
    fields: [
      { column: 'label', label: 'Reason', kind: 'text', max: 160, required: true, help: 'Reason label offered to staff when initiating or recording a refund.' },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'return-reasons': {
    key: 'return-reasons',
    label: 'Return reasons',
    description: 'Pick-list for accepting a return.',
    table: 'return_reasons',
    idColumn: 'id',
    idPrefix: 'rtr',
    orderBy: 'sort_order asc, label asc',
    fields: [
      { column: 'label', label: 'Reason', kind: 'text', max: 160, required: true, help: 'Reason label offered when opening a return request on a delivered order.' },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
};

export function isListKind(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIST_KINDS, value);
}

/**
 * Lists whose edits change what every customer receives. Templates can carry
 * links and copied into email HTML, so only a store owner may write them.
 * Reading them stays available to every signed-in role.
 */
export const OWNER_ONLY_LIST_KINDS: ReadonlySet<string> = new Set([
  'automated-messages',
  'email-templates',
]);

/* ---------------------------------------------------------- conversions */

const SLUG_RE = /^[a-z0-9_.-]+$/;
const MONEY_RE = /^\d{0,9}(\.\d{1,2})?$/;
const ALLOWED_TOKENS = [
  '{{order_id}}',
  '{{customer_name}}',
  '{{total}}',
  '{{tracking_url}}',
  '{{refund_amount}}',
  '{{store_name}}',
];

function rupeesToPaise(value: string): number | null {
  if (!MONEY_RE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const paise = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(paise) ? paise : null;
}

function paiseToRupees(value: unknown): string {
  const paise = Number(value);
  if (!Number.isFinite(paise)) return '0.00';
  return (paise / 100).toFixed(2);
}

function isOn(value: unknown): boolean {
  return value === true || value === 'on' || value === 'true' || value === '1';
}

export interface ListRow {
  id: string;
  isActive: boolean;
  values: Record<string, string>;
}

export type ListLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'invalid-input' | 'conflict' | 'not-found'; error: string };

/* -------------------------------------------------------------- reading */

export async function listSettingRows(kindKey: string): Promise<ListLoad<ListRow[]>> {
  const kind = LIST_KINDS[kindKey];
  if (!kind) return { ok: false, reason: 'not-found', error: 'Unknown list.' };

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'This list is not available.' };

  const columns = new Set<string>([kind.idColumn, 'updated_at']);
  for (const field of kind.fields) columns.add(field.column);

  try {
    const rows = (await sql.unsafe(
      `select ${[...columns].join(', ')} from ${kind.table} order by ${kind.orderBy}`,
    )) as Row[];

    return {
      ok: true,
      data: rows.map((row) => describeRow(kind, row)),
    };
  } catch {
    console.warn(`[store-admin/settings] could not read ${kind.table}`);
    return { ok: false, reason: 'unavailable', error: 'This list is not available.' };
  }
}

function describeRow(kind: ListKind, row: Row): ListRow {
  const values: Record<string, string> = {};
  for (const field of kind.fields) {
    if (field.createOnly) {
      values[field.column] = row[field.column] === null || row[field.column] === undefined
        ? ''
        : String(row[field.column]);
      continue;
    }
    const raw = row[field.column];
    if (field.kind === 'toggle') {
      values[field.column] = raw === true || String(raw) === 'true' ? 'on' : 'off';
    } else if (field.kind === 'money') {
      values[field.column] = paiseToRupees(raw);
    } else {
      values[field.column] = raw === null || raw === undefined ? '' : String(raw);
    }
  }
  // The active flag is often both a field and a table-level concept; keep the
  // dedicated property so the table can style hidden rows.
  const rawActive = row.is_active;
  return {
    id: String(row[kind.idColumn] ?? ''),
    isActive: rawActive === undefined ? true : rawActive === true || String(rawActive) === 'true',
    values,
  };
}

/* -------------------------------------------------------------- writing */

export type ListWriteInput = { id?: unknown; values?: unknown };

interface ValidatedRow {
  id: string | null;
  columns: string[];
  params: unknown[];
  isActive: boolean;
}

function validateRow(kind: ListKind, input: ListWriteInput): { ok: true; value: ValidatedRow } | { ok: false; error: string } {
  const rawValues = input.values;
  if (!rawValues || typeof rawValues !== 'object') {
    return { ok: false, error: 'No values were supplied.' };
  }
  const source = rawValues as Record<string, unknown>;

  const existingId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : null;
  if (kind.fixedRows && !existingId) {
    return { ok: false, error: 'These rows already exist and cannot be added here.' };
  }

  const columns: string[] = [];
  const params: unknown[] = [];
  let isActive = true;

  for (const field of kind.fields) {
    if (field.createOnly && existingId) continue;
    const raw = source[field.column];
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (field.required && field.kind !== 'toggle' && text === '') {
      return { ok: false, error: `${field.label} is required.` };
    }

    switch (field.kind) {
      case 'toggle': {
        const on = isOn(raw);
        columns.push(field.column);
        params.push(on);
        if (field.column === 'is_active') isActive = on;
        break;
      }
      case 'money': {
        const paise = rupeesToPaise(text || '0');
        if (paise === null) {
          return { ok: false, error: `${field.label} must be an amount like 499 or 499.50.` };
        }
        columns.push(field.column);
        params.push(paise);
        break;
      }
      case 'number': {
        if (text && !/^\d{1,10}$/.test(text)) {
          return { ok: false, error: `${field.label} must be a whole number.` };
        }
        const numeric = text === '' ? 0 : Number(text);
        if (field.maxValue !== undefined && numeric > field.maxValue) {
          return {
            ok: false,
            error: `${field.label} must be ${field.maxValue} or less.`,
          };
        }
        columns.push(field.column);
        params.push(numeric);
        break;
      }
      case 'slug': {
        if (!text) {
          if (field.required) return { ok: false, error: `${field.label} is required.` };
          break;
        }
        if (
          !SLUG_RE.test(text) ||
          (field.max && text.length > field.max) ||
          (field.pattern && !new RegExp(field.pattern).test(text))
        ) {
          return {
            ok: false,
            error: `${field.label} may only use lowercase letters, digits, dots, dashes and underscores.`,
          };
        }
        columns.push(field.column);
        params.push(text);
        break;
      }
      case 'select': {
        const allowed = field.options?.map((option) => option.value) ?? [];
        if (!allowed.includes(text)) {
          return { ok: false, error: `Choose a valid ${field.label.toLowerCase()}.` };
        }
        columns.push(field.column);
        params.push(text);
        break;
      }
      default: {
        if (field.max && text.length > field.max) {
          return { ok: false, error: `${field.label} must be ${field.max} characters or fewer.` };
        }
        if (field.nullable && text === '') {
          columns.push(field.column);
          params.push(null);
          break;
        }
        if (
          field.column === 'body' &&
          ALLOWED_TOKENS.length > 0 &&
          /\{\{[^}]*\}\}/.test(text)
        ) {
          const tokens = text.match(/\{\{[^}]*\}\}/g) ?? [];
          const unknown = tokens.filter((token) => !ALLOWED_TOKENS.includes(token));
          if (unknown.length > 0) {
            return { ok: false, error: `Unknown token ${unknown[0]}.` };
          }
        }
        if (field.column === 'tracking_template' && text) {
          if (!text.includes('{tracking}')) {
            return { ok: false, error: 'The tracking template must contain {tracking}.' };
          }
          if (!buildTrackingUrl(text, 'TEST123')) {
            return {
              ok: false,
              error: 'The tracking template must produce a valid HTTPS URL.',
            };
          }
        }
        columns.push(field.column);
        params.push(text);
      }
    }
  }

  return { ok: true, value: { id: existingId, columns, params, isActive } };
}

export async function saveSettingRow(
  kindKey: string,
  input: ListWriteInput,
  mandatoryAudit?: AuditInput,
): Promise<ListLoad<{ id: string; created: boolean }>> {
  const kind = LIST_KINDS[kindKey];
  if (!kind) return { ok: false, reason: 'not-found', error: 'Unknown list.' };

  const validation = validateRow(kind, input);
  if (!validation.ok) return { ok: false, reason: 'invalid-input', error: validation.error };
  const value = validation.value;

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'This list is not available.' };

  try {
    if (kindKey === 'bill-request-reasons') {
      if (!mandatoryAudit) return { ok: false, reason: 'invalid-input', error: 'An audited staff action is required.' };
      return await sql.begin(async tx => {
        const id = value.id ?? `${kind.idPrefix}_${randomBytes(6).toString('hex')}`;
        const params = [id, ...value.params];
        const query = value.id
          ? `update ${kind.table} set ${value.columns.map((c,i)=>`${c} = $${i+2}`).join(', ')}, updated_at=now() where id=$1 returning id`
          : `insert into ${kind.table} (id,${value.columns.join(',')}) values (${params.map((_,i)=>`$${i+1}`).join(',')}) returning id`;
        const rows = await tx.unsafe(query, params as never[]);
        if (!rows[0]) return { ok: false as const, reason: 'not-found' as const, error: 'That row does not exist.' };
        const audited = await writeAudit({ ...mandatoryAudit, entityId: id, before: undefined,
          after: { created: !value.id, active: value.isActive }, reason: value.id ? 'updated' : 'created' }, tx);
        if (!audited) throw new Error('Bill reason audit unavailable');
        return { ok: true as const, data: { id, created: !value.id } };
      });
    }
    if (value.id) {
      const assignments = value.columns.map((column, index) => `${column} = $${index + 2}`);
      const params = [value.id, ...value.params];
      const query =
        `update ${kind.table} set ${assignments.join(', ')}, updated_at = now()` +
        ` where ${kind.idColumn} = $1 returning ${kind.idColumn}`;
      const rows = (await sql.unsafe(query, params as never[])) as Row[];
      if (!rows[0]) {
        return { ok: false, reason: 'not-found', error: 'That row does not exist.' };
      }
      return { ok: true, data: { id: String(rows[0][kind.idColumn]), created: false } };
    }

    const id = `${kind.idPrefix}_${randomBytes(6).toString('hex')}`;
    const columns = [kind.idColumn, ...value.columns];
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const query =
      `insert into ${kind.table} (${columns.join(', ')})` +
      ` values (${placeholders.join(', ')}) returning ${kind.idColumn}`;
    const rows = (await sql.unsafe(query, [id, ...value.params] as never[])) as Row[];
    return { ok: true, data: { id: String(rows[0]?.[kind.idColumn] ?? id), created: true } };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/duplicate key|unique/i.test(message)) {
      return { ok: false, reason: 'conflict', error: 'That key is already in use.' };
    }
    console.warn(`[store-admin/settings] could not save ${kind.table}`);
    return { ok: false, reason: 'unavailable', error: 'This list is not available.' };
  }
}

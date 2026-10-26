import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

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
};

const SORT_FIELD: ListField = {
  column: 'sort_order',
  label: 'Order',
  kind: 'number',
  required: true,
  maxValue: 9999,
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
      { column: 'name', label: 'Courier name', kind: 'text', max: 120, required: true },
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
    description: 'Rates the storefront can offer. Zero in “free over” disables the threshold.',
    table: 'shipping_methods',
    idColumn: 'id',
    idPrefix: 'sm',
    orderBy: 'sort_order asc, name asc',
    fields: [
      { column: 'name', label: 'Method', kind: 'text', max: 120, required: true },
      { column: 'rate_paise', label: 'Rate (₹)', kind: 'money', required: true },
      { column: 'free_over_paise', label: 'Free over (₹)', kind: 'money', required: true },
      { column: 'eta_min_days', label: 'Minimum days', kind: 'number', required: true, maxValue: 365 },
      { column: 'eta_max_days', label: 'Maximum days', kind: 'number', required: true, maxValue: 365 },
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
      },
      { column: 'label', label: 'Label', kind: 'text', max: 120, required: true },
      {
        column: 'kind',
        label: 'Kind',
        kind: 'select',
        required: true,
        defaultValue: 'manual',
        options: [
          { value: 'gateway', label: 'Gateway' },
          { value: 'cod', label: 'Cash on delivery' },
          { value: 'manual', label: 'Manual' },
        ],
      },
      { column: 'instructions', label: 'Instructions', kind: 'textarea', max: 1000 },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'social-links': {
    key: 'social-links',
    label: 'Social links',
    description: 'Shown in the storefront footer.',
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
        options: [
          { value: 'instagram', label: 'Instagram' },
          { value: 'facebook', label: 'Facebook' },
          { value: 'youtube', label: 'YouTube' },
          { value: 'x', label: 'X' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'linkedin', label: 'LinkedIn' },
        ],
      },
      { column: 'url', label: 'URL', kind: 'text', max: 500, required: true },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
  'analytics-scripts': {
    key: 'analytics-scripts',
    label: 'Analytics',
    description: 'Rendered only when active and an id is present.',
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
      { column: 'script_id', label: 'Measurement / script id', kind: 'text', max: 160 },
      { ...ACTIVE_FIELD, defaultValue: 'off' },
    ],
  },
  integrations: {
    key: 'integrations',
    label: 'Integrations',
    description:
      'Non-secret configuration only. API keys, SMTP passwords and gateway salts stay in environment variables.',
    table: 'store_integrations',
    idColumn: 'id',
    idPrefix: 'int',
    orderBy: 'provider asc',
    fields: [
      { column: 'provider', label: 'Provider', kind: 'text', max: 120, required: true },
      { column: 'region', label: 'Region', kind: 'text', max: 80 },
      { column: 'bucket', label: 'Bucket', kind: 'text', max: 120 },
      { column: 'sender_identity', label: 'Sender identity', kind: 'text', max: 200 },
      { column: 'webhook_url', label: 'Webhook URL', kind: 'text', max: 500 },
      { ...ACTIVE_FIELD, defaultValue: 'off' },
    ],
  },
  'automated-messages': {
    key: 'automated-messages',
    label: 'Automated messages',
    description: 'Definitions only; sending waits for the outbox worker.',
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
      },
      { column: 'label', label: 'Label', kind: 'text', max: 120, required: true },
      {
        column: 'channel',
        label: 'Channel',
        kind: 'select',
        required: true,
        defaultValue: 'email',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS' },
          { value: 'inapp', label: 'In-app' },
        ],
      },
      { column: 'subject', label: 'Subject', kind: 'text', max: 200 },
      { column: 'body', label: 'Body', kind: 'textarea', max: 4000, help: 'Tokens: {{order_id}}, {{customer_name}}, {{total}}, {{tracking_url}}, {{store_name}}' },
      { column: 'delay_minutes', label: 'Delay (minutes)', kind: 'number', required: true, maxValue: 10080 },
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
      },
      { column: 'name', label: 'Name', kind: 'text', max: 120, required: true },
      { column: 'subject', label: 'Subject', kind: 'text', max: 200 },
      { column: 'heading', label: 'Heading', kind: 'text', max: 200 },
      { column: 'body', label: 'Body', kind: 'textarea', max: 8000 },
      { column: 'button_label', label: 'Button label', kind: 'text', max: 80 },
      { column: 'button_url', label: 'Button URL', kind: 'text', max: 500 },
      { column: 'footer_text', label: 'Footer', kind: 'text', max: 500 },
      ACTIVE_FIELD,
    ],
  },
  pages: {
    key: 'pages',
    label: 'Store pages',
    description: 'Policy and information pages. Markdown is stored as written.',
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
      },
      { column: 'title', label: 'Title', kind: 'text', max: 160, required: true },
      { column: 'body', label: 'Body (Markdown)', kind: 'textarea', max: 40000 },
      { column: 'seo_title', label: 'SEO title', kind: 'text', max: 160 },
      { column: 'seo_description', label: 'SEO description', kind: 'textarea', max: 320 },
      {
        column: 'status',
        label: 'Status',
        kind: 'select',
        required: true,
        defaultValue: 'draft',
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
    description: 'Defaults per page. Product and category pages can override them later.',
    table: 'seo_pages',
    idColumn: 'page_key',
    idPrefix: 'seo',
    orderBy: 'page_key asc',
    fixedRows: true,
    fields: [
      { column: 'meta_title', label: 'Meta title', kind: 'text', max: 160 },
      { column: 'meta_description', label: 'Meta description', kind: 'textarea', max: 320 },
      {
        column: 'meta_image_media_id',
        label: 'Meta image media id',
        kind: 'text',
        max: 120,
        nullable: true,
      },
      { column: 'robots_index', label: 'Robots: index', kind: 'toggle', required: true },
      { column: 'robots_follow', label: 'Robots: follow', kind: 'toggle', required: true },
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
      { column: 'label', label: 'Reason', kind: 'text', max: 160, required: true },
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
      { column: 'label', label: 'Reason', kind: 'text', max: 160, required: true },
      ACTIVE_FIELD,
      SORT_FIELD,
    ],
  },
};

export function isListKind(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIST_KINDS, value);
}

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
): Promise<ListLoad<{ id: string; created: boolean }>> {
  const kind = LIST_KINDS[kindKey];
  if (!kind) return { ok: false, reason: 'not-found', error: 'Unknown list.' };

  const validation = validateRow(kind, input);
  if (!validation.ok) return { ok: false, reason: 'invalid-input', error: validation.error };
  const value = validation.value;

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'This list is not available.' };

  try {
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

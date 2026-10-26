/**
 * Pure rules for store settings: the field catalogue, validation and defaults.
 *
 * Database-free, so the settings screens and the API validate with the same
 * code. Values are stored as text in `store_settings`; the field `kind` decides
 * how a text value is validated and rendered.
 *
 * Secrets are deliberately absent from this catalogue. SMTP passwords, PayU
 * keys and reCAPTCHA secrets live in environment variables; the screen shows
 * whether a secret is present, never its value.
 */

export type SettingKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'toggle'
  | 'select'
  | 'datetime';

export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

export interface SettingFieldDescriptor {
  readonly key: string;
  readonly label: string;
  readonly kind: SettingKind;
  readonly limit: number;
  readonly default: string;
  readonly section: string;
  readonly help?: string;
  readonly options?: readonly SettingOption[];
}

export interface SettingSectionDescriptor {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export const SETTING_SECTIONS = [
  {
    key: 'business',
    label: 'Business profile',
    description: 'The trade identity printed on receipts and invoices.',
  },
  {
    key: 'orders',
    label: 'Order settings',
    description: 'Numbering, fulfilment defaults and checkout text.',
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'Which payment methods the store accepts.',
  },
  {
    key: 'mail',
    label: 'Email and SMS',
    description: 'Outbound channels. Credentials stay in environment variables.',
  },
  {
    key: 'storefront',
    label: 'Storefront',
    description: 'Login screen copy and the reCAPTCHA site key.',
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    description: 'Take the storefront offline without closing this panel.',
  },
] as const satisfies readonly SettingSectionDescriptor[];

export type SettingSectionKey = (typeof SETTING_SECTIONS)[number]['key'];

const TOGGLE_OPTIONS: readonly SettingOption[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

const FULFILMENT_OPTIONS: readonly SettingOption[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'PACKED', label: 'Packed' },
  { value: 'SHIPPED', label: 'Shipped' },
];

const FIELD_DEFINITIONS = [
  // ---------------------------------------------------------- business
  { key: 'trade_name', label: 'Trade name', kind: 'text', limit: 120, default: '', section: 'business' },
  { key: 'legal_name', label: 'Legal name', kind: 'text', limit: 160, default: '', section: 'business' },
  { key: 'email', label: 'Support email', kind: 'email', limit: 120, default: '', section: 'business' },
  { key: 'phone', label: 'Support phone', kind: 'text', limit: 40, default: '', section: 'business' },
  { key: 'address', label: 'Registered address', kind: 'textarea', limit: 500, default: '', section: 'business' },
  { key: 'country', label: 'Country', kind: 'text', limit: 80, default: 'India', section: 'business' },
  {
    key: 'timezone',
    label: 'Timezone',
    kind: 'select',
    limit: 60,
    default: 'Asia/Kolkata',
    section: 'business',
    options: [
      { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
      { value: 'Asia/Dubai', label: 'Asia/Dubai' },
      { value: 'Europe/London', label: 'Europe/London' },
      { value: 'UTC', label: 'UTC' },
    ],
  },
  {
    key: 'time_format',
    label: 'Time format',
    kind: 'select',
    limit: 4,
    default: '12h',
    section: 'business',
    options: [
      { value: '12h', label: '12-hour' },
      { value: '24h', label: '24-hour' },
    ],
  },
  { key: 'footer_text', label: 'Footer text', kind: 'textarea', limit: 300, default: '', section: 'business' },
  {
    key: 'receipt_footer',
    label: 'Receipt footer',
    kind: 'textarea',
    limit: 300,
    default: 'Thank you for shopping with Gadzio.',
    section: 'business',
    help: 'Printed at the bottom of receipts, invoices and packing slips.',
  },
  { key: 'cookie_notice', label: 'Cookie notice', kind: 'textarea', limit: 500, default: '', section: 'business' },
  {
    key: 'logo_media_id',
    label: 'Logo media id',
    kind: 'text',
    limit: 120,
    default: '',
    section: 'business',
    help: 'Copy the id from the Media library.',
  },
  {
    key: 'favicon_media_id',
    label: 'Favicon media id',
    kind: 'text',
    limit: 120,
    default: '',
    section: 'business',
    help: 'Copy the id from the Media library.',
  },

  // ------------------------------------------------------------ orders
  { key: 'order_prefix', label: 'Order prefix', kind: 'text', limit: 10, default: 'GDZ', section: 'orders' },
  {
    key: 'order_start_number',
    label: 'Order starting number',
    kind: 'number',
    limit: 10,
    default: '1001',
    section: 'orders',
    help: 'Used by POS receipt numbering and the storefront once it reads the database.',
  },
  { key: 'invoice_prefix', label: 'Invoice prefix', kind: 'text', limit: 10, default: 'INV', section: 'orders' },
  {
    key: 'auto_confirm',
    label: 'Auto-confirm paid orders',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'orders',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'shipping_enabled',
    label: 'Shipping enabled',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'orders',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'pickup_enabled',
    label: 'Store pickup enabled',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'orders',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'free_shipping_over',
    label: 'Free shipping over (₹)',
    kind: 'number',
    limit: 10,
    default: '0',
    section: 'orders',
    help: 'Whole rupees. Zero disables the threshold.',
  },
  {
    key: 'auto_cancel_unpaid_hours',
    label: 'Auto-cancel unpaid after (hours)',
    kind: 'number',
    limit: 4,
    default: '0',
    section: 'orders',
    help: 'Zero leaves unpaid orders open indefinitely.',
  },
  {
    key: 'default_fulfilment_status',
    label: 'Default fulfilment status',
    kind: 'select',
    limit: 20,
    default: 'PENDING',
    section: 'orders',
    options: FULFILMENT_OPTIONS,
  },
  {
    key: 'processing_time_text',
    label: 'Processing text',
    kind: 'text',
    limit: 160,
    default: 'Dispatched in 1–2 business days.',
    section: 'orders',
  },
  {
    key: 'cutoff_text',
    label: 'Cut-off text',
    kind: 'text',
    limit: 160,
    default: 'Order before 4 pm for same-day dispatch.',
    section: 'orders',
  },

  // ---------------------------------------------------------- payments
  {
    key: 'cod_enabled',
    label: 'Cash on delivery',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'payments',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'payu_enabled',
    label: 'PayU',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'payments',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'manual_payments_enabled',
    label: 'Manual payments (UPI, bank transfer)',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'payments',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'payu_mode',
    label: 'PayU mode',
    kind: 'select',
    limit: 6,
    default: 'test',
    section: 'payments',
    options: [
      { value: 'test', label: 'Test' },
      { value: 'live', label: 'Live' },
    ],
    help: 'Display only. The gateway keys themselves stay in environment variables.',
  },
  {
    key: 'payment_note',
    label: 'Checkout payment note',
    kind: 'textarea',
    limit: 500,
    default: '',
    section: 'payments',
  },

  // -------------------------------------------------------------- mail
  {
    key: 'mail_driver',
    label: 'Mail driver',
    kind: 'select',
    limit: 10,
    default: 'log',
    section: 'mail',
    options: [
      { value: 'log', label: 'Log only (no delivery)' },
      { value: 'smtp', label: 'SMTP' },
    ],
  },
  {
    key: 'mail_status',
    label: 'Email sending',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'mail',
    options: TOGGLE_OPTIONS,
  },
  { key: 'mail_host', label: 'SMTP host', kind: 'text', limit: 200, default: '', section: 'mail' },
  { key: 'mail_port', label: 'SMTP port', kind: 'number', limit: 5, default: '587', section: 'mail' },
  { key: 'mail_username', label: 'SMTP username', kind: 'text', limit: 200, default: '', section: 'mail' },
  {
    key: 'mail_encryption',
    label: 'Encryption',
    kind: 'select',
    limit: 5,
    default: 'tls',
    section: 'mail',
    options: [
      { value: 'tls', label: 'STARTTLS' },
      { value: 'ssl', label: 'SSL' },
      { value: 'none', label: 'None' },
    ],
  },
  {
    key: 'mail_from_email',
    label: 'From email',
    kind: 'email',
    limit: 120,
    default: '',
    section: 'mail',
  },
  { key: 'mail_from_name', label: 'From name', kind: 'text', limit: 120, default: '', section: 'mail' },
  {
    key: 'sms_gateway',
    label: 'SMS gateway',
    kind: 'select',
    limit: 10,
    default: 'none',
    section: 'mail',
    options: [
      { value: 'none', label: 'Not configured' },
      { value: 'msg91', label: 'MSG91' },
      { value: 'twilio', label: 'Twilio' },
    ],
    help: 'SMS stays disabled until a provider and credentials are chosen.',
  },
  {
    key: 'sms_status',
    label: 'SMS sending',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'mail',
    options: TOGGLE_OPTIONS,
  },
  { key: 'sms_sender_id', label: 'SMS sender id', kind: 'text', limit: 20, default: '', section: 'mail' },

  // -------------------------------------------------------- storefront
  {
    key: 'login_heading',
    label: 'Login heading',
    kind: 'text',
    limit: 120,
    default: 'Store Desk',
    section: 'storefront',
  },
  {
    key: 'login_subheading',
    label: 'Login subheading',
    kind: 'text',
    limit: 200,
    default: '',
    section: 'storefront',
  },
  {
    key: 'login_background_media_id',
    label: 'Login background media id',
    kind: 'text',
    limit: 120,
    default: '',
    section: 'storefront',
  },
  {
    key: 'login_support_link',
    label: 'Support link',
    kind: 'text',
    limit: 300,
    default: '',
    section: 'storefront',
    help: 'Where “forgot password” sends staff.',
  },
  {
    key: 'recaptcha_site_key',
    label: 'reCAPTCHA site key',
    kind: 'text',
    limit: 200,
    default: '',
    section: 'storefront',
  },
  {
    key: 'recaptcha_status',
    label: 'reCAPTCHA',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'storefront',
    options: TOGGLE_OPTIONS,
  },

  // ------------------------------------------------------- maintenance
  {
    key: 'maintenance_enabled',
    label: 'Maintenance mode',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'maintenance',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'maintenance_message',
    label: 'Maintenance message',
    kind: 'textarea',
    limit: 500,
    default: 'We are making a few improvements. Please check back shortly.',
    section: 'maintenance',
  },
  {
    key: 'maintenance_starts_at',
    label: 'Starts at',
    kind: 'datetime',
    limit: 40,
    default: '',
    section: 'maintenance',
    help: 'Optional. Leave blank to start immediately.',
  },
  {
    key: 'maintenance_ends_at',
    label: 'Ends at',
    kind: 'datetime',
    limit: 40,
    default: '',
    section: 'maintenance',
    help: 'Optional. Leave blank to end manually.',
  },
] as const satisfies readonly SettingFieldDescriptor[];

/**
 * The tuple keeps the literal keys; the exported array is widened to the
 * descriptor shape so consumers can read optional `options` / `help` without
 * narrowing every member of the union first.
 */
export const SETTING_FIELDS: readonly SettingFieldDescriptor[] = FIELD_DEFINITIONS;

export type SettingField = SettingFieldDescriptor;
export type StoreSettingKey = (typeof FIELD_DEFINITIONS)[number]['key'];
export type StoreSettings = Record<StoreSettingKey, string>;

export const SETTING_KEYS: readonly StoreSettingKey[] = FIELD_DEFINITIONS.map(
  (field) => field.key,
);

/** Length limits per key; the server enforces them on every write. */
export const SETTING_LIMITS = Object.fromEntries(
  SETTING_FIELDS.map((field) => [field.key, field.limit]),
) as Record<StoreSettingKey, number>;

export const SETTING_LABELS = Object.fromEntries(
  SETTING_FIELDS.map((field) => [field.key, field.label]),
) as Record<StoreSettingKey, string>;

const FIELD_BY_KEY = new Map<string, SettingField>(
  SETTING_FIELDS.map((field) => [field.key, field]),
);

export function settingField(key: string): SettingField | undefined {
  return FIELD_BY_KEY.get(key);
}

export function isStoreSettingKey(value: unknown): value is StoreSettingKey {
  return typeof value === 'string' && FIELD_BY_KEY.has(value);
}

export function fieldsForSection(section: SettingSectionKey): readonly SettingField[] {
  return SETTING_FIELDS.filter((field) => field.section === section);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export type SettingValidation = { ok: true; value: string } | { ok: false; error: string };

/** Normalize a toggle to `on` / `off`. */
export function normalizeToggle(value: unknown): 'on' | 'off' {
  if (value === true || value === 1) return 'on';
  if (value === false || value === 0 || value === null || value === undefined) return 'off';
  const text = String(value).trim().toLowerCase();
  return text === 'on' || text === '1' || text === 'true' || text === 'yes' ? 'on' : 'off';
}

/** Validate one setting value against its field descriptor. */
export function validateSettingValue(key: string, value: unknown): SettingValidation {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return { ok: false, error: 'Unknown setting.' };

  if (field.kind === 'toggle') {
    return { ok: true, value: normalizeToggle(value) };
  }

  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > field.limit) {
    return { ok: false, error: `${field.label} must be ${field.limit} characters or fewer.` };
  }

  switch (field.kind) {
    case 'email':
      if (text && !EMAIL_RE.test(text)) {
        return { ok: false, error: `${field.label} is not a valid email address.` };
      }
      return { ok: true, value: text };
    case 'number':
      if (text === '') return { ok: true, value: '0' };
      if (!/^[0-9]{1,10}$/.test(text)) {
        return { ok: false, error: `${field.label} must be a whole number.` };
      }
      return { ok: true, value: text };
    case 'select': {
      const allowed = field.options?.map((option) => option.value) ?? [];
      if (!allowed.includes(text)) {
        return { ok: false, error: `Choose a valid value for ${field.label}.` };
      }
      return { ok: true, value: text };
    }
    case 'datetime':
      if (text === '') return { ok: true, value: '' };
      if (!DATETIME_RE.test(text)) {
        return { ok: false, error: `${field.label} must be a date and time.` };
      }
      return { ok: true, value: text };
    default:
      return { ok: true, value: text };
  }
}

/** Owner-only settings groups: the maintenance switch takes the shop offline. */
export function isOwnerOnlySetting(key: string): boolean {
  return key.startsWith('maintenance_');
}

export const DEFAULT_SETTINGS: StoreSettings = Object.fromEntries(
  SETTING_FIELDS.map((field) => [field.key, field.default]),
) as StoreSettings;

/** Human label for a stored toggle value. */
export function toggleLabel(value: string): string {
  return value === 'on' ? 'On' : 'Off';
}

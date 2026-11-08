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

const MAX_PRICE_PAISE = 1_000_000_00;

function parseRupeesToPaise(value: unknown): { ok: true; paise: number | null } | { ok: false; message: string } {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = raw.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (cleaned === '') return { ok: true, paise: null };
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return { ok: false, message: 'Enter an amount in rupees, for example 499.50.' };
  const [rupees, fraction = ''] = cleaned.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? { ok: true, paise } : { ok: false, message: 'That amount is too large.' };
}

export type SettingKind =
  | 'money'
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
  /**
   * The value is shown but cannot be changed. `validation` still refuses any
   * other value, so a crafted request cannot bypass the disabled control.
   */
  readonly locked?: boolean;
  /** The only value a locked field may hold. */
  readonly lockedValue?: string;
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
    key: 'shipping',
    label: 'Shipping',
    description: 'Checkout shipping charge and free-shipping threshold.',
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'Which payment methods the store accepts.',
  },
  {
    key: 'coupons',
    label: 'Coupons',
    description: 'Discount codes and whether a refund gives the use back.',
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

export type SettingSectionKey = (typeof SETTING_SECTIONS)[number]['key'] | 'legacy-shipping';

const TOGGLE_OPTIONS: readonly SettingOption[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

// Only statuses the order rules can actually reach are offered; the previous
// PACKED/SHIPPED values did not exist in the database constraint.
const FULFILMENT_OPTIONS: readonly SettingOption[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'PROCESSING', label: 'Preparing (pickup is marked manually)' },
];

const FIELD_DEFINITIONS = [
  // ---------------------------------------------------------- business
  { key: 'trade_name', label: 'Trade name', kind: 'text', limit: 120, default: '', section: 'business', help: 'Customer-facing store name shown on receipts, invoices and emails.' },
  { key: 'legal_name', label: 'Legal name', kind: 'text', limit: 160, default: '', section: 'business', help: 'Registered business entity name shown on formal order documents.' },
  { key: 'email', label: 'Support email', kind: 'email', limit: 120, default: '', section: 'business', help: 'Public customer support email address shown on the support page and receipts.' },
  { key: 'phone', label: 'Support phone', kind: 'text', limit: 40, default: '', section: 'business', help: 'Public customer support phone number shown on the support page and receipts.' },
  { key: 'address', label: 'Registered address', kind: 'textarea', limit: 500, default: '', section: 'business', help: 'Business postal address printed on invoices and payment receipts.' },
  { key: 'country', label: 'Country', kind: 'text', limit: 80, default: 'India', section: 'business', help: 'Country of operation printed on order documents.' },
  {
    key: 'timezone',
    label: 'Timezone',
    kind: 'select',
    limit: 60,
    default: 'Asia/Kolkata',
    section: 'business',
    help: 'Store timezone used to cut daily sales reports and schedule sale windows.',
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
    help: 'Display preference (12-hour or 24-hour) for timestamps in admin views.',
    options: [
      { value: '12h', label: '12-hour' },
      { value: '24h', label: '24-hour' },
    ],
  },
  { key: 'footer_text', label: 'Footer text', kind: 'textarea', limit: 300, default: '', section: 'business', help: 'Short copyright or statement line for the storefront footer.' },
  {
    key: 'receipt_footer',
    label: 'Receipt footer',
    kind: 'textarea',
    limit: 300,
    default: 'Thank you for shopping with Gadzio.',
    section: 'business',
    help: 'Printed at the bottom of receipts, invoices and packing slips.',
  },
  { key: 'cookie_notice', label: 'Cookie notice', kind: 'textarea', limit: 500, default: '', section: 'business', help: 'Optional cookie or privacy notice text for the storefront.' },
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
  { key: 'order_prefix', label: 'Order prefix', kind: 'text', limit: 10, default: 'GDZ', section: 'orders', help: 'Short uppercase letters prepended to sequential online order numbers (for example GDZ).' },
  {
    key: 'order_start_number',
    label: 'Order starting number',
    kind: 'number',
    limit: 10,
    default: '1001',
    section: 'orders',
    help: 'First number used for online orders. Existing orders keep their ids.',
  },
  { key: 'invoice_prefix', label: 'Invoice prefix', kind: 'text', limit: 10, default: 'INV', section: 'orders', help: 'Short uppercase prefix prepended to sequential invoice numbers (for example INV).' },
  {
    key: 'auto_confirm',
    label: 'Auto-confirm paid orders',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'orders',
    help: 'When on, verified online payments automatically move the order to Confirmed.',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'shipping_enabled',
    label: 'Shipping enabled',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'shipping',
    options: TOGGLE_OPTIONS,
    help: 'Off means no shipping charge. Pickup remains unavailable.',
  },
  {
    key: 'pos_confirm_unusual_price',
    label: 'Confirm unusual POS prices',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'orders',
    options: TOGGLE_OPTIONS,
    help: 'Ask the cashier to confirm a typed price above 10× list or below cost. The sale can always proceed.',
  },
  {
    key: 'pickup_enabled',
    label: 'Store pickup enabled',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'orders',
    options: TOGGLE_OPTIONS,
    // Pickup has no checkout path: there is no delivery-method selector, so
    // a stored "on" could never do anything. The control is shown, disabled,
    // and the server refuses every value but "off".
    help: 'Store pickup is not available yet. Checkout offers delivery only; this stays off until pickup is built end to end.',
    locked: true,
    lockedValue: 'off',
  },
  {
    key: 'free_shipping_over',
    label: 'Free shipping over (₹)',
    kind: 'number',
    limit: 10,
    default: '0',
    section: 'orders',
    help: 'Legacy only; unused by checkout after canonical shipping initialization.',
  },
  {
    key: 'shipping_charge_paise',
    label: 'Shipping charge (₹)',
    kind: 'money',
    limit: 24,
    default: '0',
    section: 'shipping',
    help: 'Enter rupees, e.g. 50 or 50.50 (maximum ₹10,00,000). Zero means free shipping. This is the only checkout delivery rate.',
  },
  {
    key: 'free_shipping_threshold_paise',
    label: 'Free-shipping threshold (₹)',
    kind: 'money',
    limit: 24,
    default: '',
    section: 'shipping',
    help: 'Compare sale-priced items before coupon discounts. Blank means no threshold; zero means every nonempty cart qualifies. A valid free-shipping coupon also waives the charge.',
  },
  {
    key: 'auto_cancel_unpaid_hours',
    label: 'Auto-cancel unpaid after (hours)',
    kind: 'number',
    limit: 4,
    default: '0',
    section: 'orders',
    help: 'Zero keeps the 2-hour abandoned-checkout expiry.',
  },
  {
    key: 'reservation_seconds',
    label: 'Checkout reservation (seconds)',
    kind: 'number',
    limit: 4,
    default: '600',
    section: 'orders',
    help: 'How long a checkout holds stock before it is returned. 30–1800 seconds.',
  },
  {
    key: 'payment_failure_grace_seconds',
    label: 'Payment failure grace (seconds)',
    kind: 'number',
    limit: 4,
    default: '120',
    section: 'orders',
    help: 'How long stock stays held after a definitive payment failure so a retry can succeed. 0–900 seconds.',
  },
  {
    key: 'payment_unresolved_minutes',
    label: 'Unresolved payment window (minutes)',
    kind: 'number',
    limit: 4,
    default: '60',
    section: 'orders',
    help: 'How long an unverified payment keeps its stock claim before it is released and flagged for review. 5–1440 minutes.',
  },
  {
    key: 'return_window_days',
    label: 'Return window (days)',
    kind: 'number',
    limit: 3,
    default: '7',
    section: 'orders',
    help: 'How long after delivery a customer can request a return.',
  },
  {
    key: 'default_fulfilment_status',
    label: 'Default fulfilment status',
    kind: 'select',
    limit: 20,
    default: 'PENDING',
    section: 'orders',
    help: 'Fulfilment stage assigned automatically when an online payment is confirmed.',
    options: FULFILMENT_OPTIONS,
  },
  {
    key: 'processing_time_text',
    label: 'Processing text',
    kind: 'text',
    limit: 160,
    default: 'Dispatched in 1–2 business days.',
    section: 'orders',
    help: 'Short dispatch expectation shown on order summaries and support notes.',
  },
  {
    key: 'cutoff_text',
    label: 'Cut-off text',
    kind: 'text',
    limit: 160,
    default: 'Order before 4 pm for same-day dispatch.',
    section: 'orders',
    help: 'Daily order cut-off note for same-day or next-day dispatch.',
  },

  // ----------------------------------------------------------- coupons
  {
    key: 'coupons_enabled',
    label: 'Coupon codes at checkout',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'coupons',
    options: TOGGLE_OPTIONS,
    help: 'Turn the coupon box off without deleting any code. Existing orders keep their discount.',
  },
  {
    key: 'refunds_restore_coupon',
    label: 'Refunds restore coupon use',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'coupons',
    options: TOGGLE_OPTIONS,
    help: 'Off by default. When on, a refund that covers the whole order gives the coupon use back.',
  },

  // ---------------------------------------------------------- payments
  {
    key: 'cod_enabled',
    label: 'Cash on delivery',
    kind: 'toggle',
    limit: 3,
    // Checkout has no payment-method selector, so COD stays unwired and off.
    default: 'off',
    section: 'payments',
    help: 'Not active yet. Cash on delivery is kept off and invisible to customers.',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'payu_enabled',
    label: 'PayU',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'payments',
    help: 'Allow online checkout payments through PayU Hosted Checkout.',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'manual_payments_enabled',
    label: 'Manual payments (UPI, bank transfer)',
    kind: 'toggle',
    limit: 3,
    default: 'on',
    section: 'payments',
    help: 'Allow staff to record and review manual UPI or bank-transfer payments on orders.',
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
    help: 'Optional neutral note shown below the Pay button at checkout (do not name payment providers).',
  },

  // -------------------------------------------------------------- mail
  {
    key: 'mail_driver',
    label: 'Mail driver',
    kind: 'select',
    limit: 10,
    default: 'log',
    section: 'mail',
    help: 'Choose SMTP to deliver real emails, or Log only to record outbox rows without sending.',
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
    help: 'Master switch for outbound email notifications.',
    options: TOGGLE_OPTIONS,
  },
  { key: 'mail_host', label: 'SMTP host', kind: 'text', limit: 200, default: '', section: 'mail', help: 'Hostname of your SMTP server (must match MAIL_ALLOWED_HOSTS in production).' },
  { key: 'mail_port', label: 'SMTP port', kind: 'number', limit: 5, default: '587', section: 'mail', help: 'Port number of your SMTP server (usually 587 for STARTTLS or 465 for SSL).' },
  { key: 'mail_username', label: 'SMTP username', kind: 'text', limit: 200, default: '', section: 'mail', help: 'Account username for authenticating with the SMTP server. Password stays in MAIL_PASSWORD.' },
  {
    key: 'mail_encryption',
    label: 'Encryption',
    kind: 'select',
    limit: 5,
    default: 'tls',
    section: 'mail',
    help: 'Transport encryption required for SMTP connections (STARTTLS or SSL in production).',
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
    help: 'Sender email address shown on outbound transactional emails.',
  },
  { key: 'mail_from_name', label: 'From name', kind: 'text', limit: 120, default: '', section: 'mail', help: 'Sender display name shown on outbound transactional emails.' },
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
    help: 'Master switch for outbound SMS notifications.',
    options: TOGGLE_OPTIONS,
  },
  { key: 'sms_sender_id', label: 'SMS sender id', kind: 'text', limit: 20, default: '', section: 'mail', help: '6-character DLT sender header or Twilio sender phone number.' },
  {
    key: 'sms_dlt_template_id',
    label: 'MSG91 DLT template id',
    kind: 'text',
    limit: 40,
    default: '',
    section: 'mail',
    help: 'India only. Carriers drop SMS that do not match a DLT-registered template. Paste the template id from your MSG91 / DLT portal. MSG91 sending stays off without it.',
  },

  // -------------------------------------------------------- storefront
  {
    key: 'login_heading',
    label: 'Login heading',
    kind: 'text',
    limit: 120,
    default: 'Store Desk',
    section: 'storefront',
    help: 'Not active yet. Saved for future sign-in screen heading customization.',
  },
  {
    key: 'login_subheading',
    label: 'Login subheading',
    kind: 'text',
    limit: 200,
    default: '',
    section: 'storefront',
    help: 'Not active yet. Saved for future sign-in screen subheading customization.',
  },
  {
    key: 'login_background_media_id',
    label: 'Login background media id',
    kind: 'text',
    limit: 120,
    default: '',
    section: 'storefront',
    help: 'Not active yet. Copy a media id from the Media library for future sign-in background use.',
  },
  {
    key: 'login_support_link',
    label: 'Support link',
    kind: 'text',
    limit: 300,
    default: '',
    section: 'storefront',
    help: 'Where “forgot password” sends staff. (Not active yet on customer sign-in.)',
  },
  {
    key: 'recaptcha_site_key',
    label: 'reCAPTCHA site key',
    kind: 'text',
    limit: 200,
    default: '',
    section: 'storefront',
    help: 'Not active yet. Public site key for bot protection; secret key stays in RECAPTCHA_SECRET_KEY.',
  },
  {
    key: 'recaptcha_status',
    label: 'reCAPTCHA',
    kind: 'toggle',
    limit: 3,
    default: 'off',
    section: 'storefront',
    help: 'Not active yet. Bot verification is currently handled by rate limiting and same-origin guards.',
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
    help: 'When on (and within any schedule window), closes the public storefront and checkout while keeping Store Admin open.',
    options: TOGGLE_OPTIONS,
  },
  {
    key: 'maintenance_message',
    label: 'Maintenance message',
    kind: 'textarea',
    limit: 500,
    default: 'We are making a few improvements. Please check back shortly.',
    section: 'maintenance',
    help: 'Message shown to visitors on the maintenance screen while the store is offline.',
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

export function isShippingMoneyKey(key: unknown): key is 'shipping_charge_paise' | 'free_shipping_threshold_paise' {
  return key === 'shipping_charge_paise' || key === 'free_shipping_threshold_paise';
}

export function isShippingSetting(key: unknown): boolean {
  return key === 'shipping_enabled' || isShippingMoneyKey(key);
}

/** Explicit UI/API rupee boundary; persisted values are always integer paise. */
export function validateShippingRupees(key: string, value: unknown): SettingValidation {
  if (!isShippingMoneyKey(key)) return { ok: false, error: 'Unknown shipping amount.' };
  if (typeof value !== 'string' || value.length > 24) {
    return { ok: false, error: 'Enter an amount in rupees as text.' };
  }
  const parsed = parseRupeesToPaise(value);
  if (!parsed.ok) return { ok: false, error: parsed.message };
  if (parsed.paise === null) {
    return key === 'free_shipping_threshold_paise'
      ? { ok: true, value: '' }
      : { ok: false, error: 'Shipping charge is required; enter 0 for free shipping.' };
  }
  return validateSettingValue(key, String(parsed.paise));
}

/** Validate one PERSISTED setting value; money is integer paise, never rupees. */
export function validateSettingValue(key: string, value: unknown): SettingValidation {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return { ok: false, error: 'Unknown setting.' };

  // A locked field is read-only at the API as well as in the screen: the
  // disabled control is a convenience, this is the rule.
  if (field.locked) {
    const lockedValue = field.lockedValue ?? field.default;
    const candidate = field.kind === 'toggle' ? normalizeToggle(value) : String(value ?? '').trim();
    if (candidate !== lockedValue) {
      return {
        ok: false,
        error: `${field.label} cannot be changed. Store pickup is not available yet.`,
      };
    }
    return { ok: true, value: lockedValue };
  }

  if (field.kind === 'toggle') {
    return { ok: true, value: normalizeToggle(value) };
  }

  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > field.limit) {
    return { ok: false, error: `${field.label} must be ${field.limit} characters or fewer.` };
  }

  switch (field.kind) {
    case 'money':
      if (key === 'free_shipping_threshold_paise' && text === '' && typeof value === 'string') {
        return { ok: true, value: '' };
      }
      if (typeof value !== 'string' || !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > MAX_PRICE_PAISE) {
        return { ok: false, error: `${field.label} must be between ₹0 and ₹10,00,000, with at most two decimal places.` };
      }
      return { ok: true, value: String(Number(text)) };
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
      if (key === 'mail_encryption' && !mailEncryptionAllowed(text)) {
        return { ok: false, error: 'SMTP encryption cannot be turned off outside development.' };
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

/**
 * Owner-only settings groups: maintenance takes the shop offline, and the
 * `mail_*` keys decide where the server's SMTP password is sent.
 */
export function isOwnerOnlySetting(key: string): boolean {
  return key.startsWith('maintenance_') || key.startsWith('mail_');
}

/**
 * `mail_encryption = "none"` would send the SMTP login in clear text. It is
 * accepted only in local development; every other environment must use
 * STARTTLS or SSL.
 */
export function mailEncryptionAllowed(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return value !== 'none' || env.NODE_ENV === 'development';
}

/**
 * Store pickup is not offered. Checkout has no delivery-method selector, so a
 * stored `on` value must never turn into behaviour. Every server path that
 * could ask "is pickup available?" asks here, and the answer is always false.
 * The stored setting is kept only so the disabled control has something to
 * show.
 */
export function pickupEnabled(_settings?: Pick<StoreSettings, 'pickup_enabled'>): false {
  return false;
}

export const DEFAULT_SETTINGS: StoreSettings = Object.fromEntries(
  SETTING_FIELDS.map((field) => [field.key, field.default]),
) as StoreSettings;

/** Human label for a stored toggle value. */
export function toggleLabel(value: string): string {
  return value === 'on' ? 'On' : 'Off';
}

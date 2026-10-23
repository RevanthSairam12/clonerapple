/** Pure rules for store settings: database-free and shared with the UI. */

export type StoreSettingKey =
  | 'trade_name'
  | 'address'
  | 'phone'
  | 'email'
  | 'receipt_footer'
  | 'low_stock_default';

export const SETTING_KEYS: readonly StoreSettingKey[] = [
  'trade_name',
  'address',
  'phone',
  'email',
  'receipt_footer',
  'low_stock_default',
];

/** Length limits per key; the server enforces them on every write. */
export const SETTING_LIMITS: Readonly<Record<StoreSettingKey, number>> = {
  trade_name: 120,
  address: 500,
  phone: 40,
  email: 120,
  receipt_footer: 300,
  low_stock_default: 10,
};

export const SETTING_LABELS: Readonly<Record<StoreSettingKey, string>> = {
  trade_name: 'Trade name',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  receipt_footer: 'Receipt footer',
  low_stock_default: 'Default low-stock threshold',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isStoreSettingKey(value: unknown): value is StoreSettingKey {
  return (
    typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value)
  );
}

export type SettingValidation = { ok: true; value: string } | { ok: false; error: string };

/** Validate one setting value. Numbers-only keys are checked for digits. */
export function validateSettingValue(
  key: StoreSettingKey,
  value: unknown,
): SettingValidation {
  const text = typeof value === 'string' ? value.trim() : '';
  const limit = SETTING_LIMITS[key];
  if (text.length > limit) {
    return { ok: false, error: `${SETTING_LABELS[key]} must be ${limit} characters or fewer.` };
  }
  if (key === 'email' && text && !EMAIL_RE.test(text)) {
    return { ok: false, error: 'Email is not a valid address.' };
  }
  if (key === 'low_stock_default') {
    if (text === '') return { ok: true, value: '0' };
    if (!/^[0-9]{1,10}$/.test(text)) {
      return { ok: false, error: 'Low-stock threshold must be a whole number.' };
    }
    return { ok: true, value: text };
  }
  return { ok: true, value: text };
}

export type StoreSettings = Record<StoreSettingKey, string>;

export const DEFAULT_SETTINGS: StoreSettings = {
  trade_name: '',
  address: '',
  phone: '',
  email: '',
  receipt_footer: '',
  low_stock_default: '0',
};

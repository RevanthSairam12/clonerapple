import { getSql } from '@/lib/admin/db';

import {
  DEFAULT_CUSTOMER_SETTINGS,
  isCustomerSettingKey,
  validateCustomerSettingValue,
  type CustomerSettingKey,
  type CustomerSettings,
} from './customer-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Customer settings must be read and written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export type CustomerSettingsLoad =
  | { ok: true; settings: CustomerSettings }
  | { ok: false; reason: 'unavailable' };

/** Read every known customer setting, falling back to defaults. */
export async function getCustomerSettings(): Promise<CustomerSettingsLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select key, value from customer_settings
    `) as Row[];
    const settings: CustomerSettings = { ...DEFAULT_CUSTOMER_SETTINGS };
    for (const row of rows) {
      if (isCustomerSettingKey(row.key)) settings[row.key] = text(row.value);
    }
    return { ok: true, settings };
  } catch {
    console.warn('[store-admin/customer-settings] could not read customer settings');
    return { ok: false, reason: 'unavailable' };
  }
}

export type CustomerSettingUpdate =
  | { ok: true; key: CustomerSettingKey; before: string; after: string }
  | { ok: false; reason: 'unavailable' | 'invalid-input'; error: string };

export async function updateCustomerSetting(
  key: CustomerSettingKey,
  value: unknown,
  staffId: string,
): Promise<CustomerSettingUpdate> {
  const validation = validateCustomerSettingValue(key, value);
  if (!validation.ok) {
    return { ok: false, reason: 'invalid-input', error: validation.error };
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Customer settings are not available.' };
  }

  try {
    return await sql.begin(async (tx) => {
      const beforeRows = (await tx`
        select value from customer_settings where key = ${key}
      `) as Row[];
      const before = beforeRows[0] ? text(beforeRows[0].value) : DEFAULT_CUSTOMER_SETTINGS[key];

      await tx`
        insert into customer_settings (key, value, updated_by, updated_at)
        values (${key}, ${validation.value}, ${staffId}, now())
        on conflict (key) do update set
          value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
      return { ok: true as const, key, before, after: validation.value };
    });
  } catch {
    console.warn('[store-admin/customer-settings] could not update a setting');
    return { ok: false, reason: 'unavailable', error: 'Customer settings are not available.' };
  }
}

/**
 * Storefront read: never throws, and returns the safe defaults when the
 * database or the table is unavailable.
 */
export async function readCustomerSettings(): Promise<CustomerSettings> {
  const result = await getCustomerSettings();
  return result.ok ? result.settings : { ...DEFAULT_CUSTOMER_SETTINGS };
}

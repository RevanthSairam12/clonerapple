import { getSql } from '@/lib/admin/db';

import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  isStoreSettingKey,
  validateSettingValue,
  type StoreSettingKey,
  type StoreSettings,
} from './settings-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store settings must be read and written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export type SettingsLoad =
  | { ok: true; settings: StoreSettings }
  | { ok: false; reason: 'unavailable' };

/** Read every known setting, falling back to defaults for missing rows. */
export async function getStoreSettings(): Promise<SettingsLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select key, value from store_settings
    `) as Row[];
    const settings: StoreSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (isStoreSettingKey(row.key)) settings[row.key] = text(row.value);
    }
    return { ok: true, settings };
  } catch {
    console.warn('[store-admin/settings] could not read store settings');
    return { ok: false, reason: 'unavailable' };
  }
}

export type SettingUpdateResult =
  | { ok: true; key: StoreSettingKey; before: string; after: string }
  | { ok: false; reason: 'unavailable' | 'invalid-input'; error: string };

/** Update one setting; returns the previous value for the audit log. */
export async function updateStoreSetting(
  key: StoreSettingKey,
  value: unknown,
  staffId: string,
): Promise<SettingUpdateResult> {
  const validation = validateSettingValue(key, value);
  if (!validation.ok) {
    return { ok: false, reason: 'invalid-input', error: validation.error };
  }
  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Settings are not available.' };
  }

  try {
    return await sql.begin(async (tx) => {
      const beforeRows = (await tx`
        select value from store_settings where key = ${key}
      `) as Row[];
      const before = beforeRows[0] ? text(beforeRows[0].value) : DEFAULT_SETTINGS[key];

      await tx`
        insert into store_settings (key, value, updated_by, updated_at)
        values (${key}, ${validation.value}, ${staffId}, now())
        on conflict (key) do update set
          value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
      return { ok: true as const, key, before, after: validation.value };
    });
  } catch {
    console.warn('[store-admin/settings] could not update a setting');
    return { ok: false, reason: 'unavailable', error: 'Settings are not available.' };
  }
}

export { SETTING_KEYS };

import type postgres from 'postgres';

import {
  DEFAULT_SETTINGS,
  isStoreSettingKey,
  type StoreSettings,
} from '@/lib/store-admin/settings-rules';

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

/**
 * Read every known setting with defaults for missing rows. Providers need the
 * mail/SMS section; the template renderer needs the store name, support
 * contact and return window. One read serves both.
 */
export async function readNotificationSettings(sql: Sql): Promise<StoreSettings> {
  const rows = (await sql`select key, value from store_settings`) as Row[];
  const settings: StoreSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = String(row.key ?? '');
    if (isStoreSettingKey(key)) {
      settings[key] = row.value === null || row.value === undefined ? '' : String(row.value);
    }
  }
  return settings;
}

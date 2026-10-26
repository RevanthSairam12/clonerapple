import { getSql } from '@/lib/admin/db';

import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  isOwnerOnlySetting,
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

export interface SettingChange {
  key: StoreSettingKey;
  before: string;
  after: string;
}

export type SettingUpdateResult =
  | { ok: true; changes: SettingChange[] }
  | { ok: false; reason: 'unavailable' | 'invalid-input' | 'forbidden'; error: string };

/**
 * Update one or more settings atomically; returns the previous value of every
 * key that actually changed, for the audit log.
 *
 * `canEditOwnerOnly` is false for admins: the maintenance switch takes the
 * storefront offline and stays with the owner.
 */
export async function updateStoreSettings(
  input: { key: unknown; value: unknown }[],
  staffId: string,
  canEditOwnerOnly: boolean,
): Promise<SettingUpdateResult> {
  if (input.length === 0) {
    return { ok: false, reason: 'invalid-input', error: 'No settings were supplied.' };
  }
  if (input.length > 100) {
    return { ok: false, reason: 'invalid-input', error: 'Too many settings in one request.' };
  }

  const validated: { key: StoreSettingKey; value: string }[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isStoreSettingKey(item.key)) {
      return { ok: false, reason: 'invalid-input', error: 'Unknown setting.' };
    }
    if (seen.has(item.key)) {
      return { ok: false, reason: 'invalid-input', error: 'A setting was sent twice.' };
    }
    seen.add(item.key);
    if (isOwnerOnlySetting(item.key) && !canEditOwnerOnly) {
      return {
        ok: false,
        reason: 'forbidden',
        error: 'Only a store owner can change maintenance settings.',
      };
    }
    const validation = validateSettingValue(item.key, item.value);
    if (!validation.ok) {
      return { ok: false, reason: 'invalid-input', error: validation.error };
    }
    validated.push({ key: item.key, value: validation.value });
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Settings are not available.' };
  }

  try {
    return await sql.begin(async (tx) => {
      const changes: SettingChange[] = [];
      for (const item of validated) {
        const beforeRows = (await tx`
          select value from store_settings where key = ${item.key}
        `) as Row[];
        const before = beforeRows[0]
          ? text(beforeRows[0].value)
          : DEFAULT_SETTINGS[item.key];

        if (before === item.value) continue;

        await tx`
          insert into store_settings (key, value, updated_by, updated_at)
          values (${item.key}, ${item.value}, ${staffId}, now())
          on conflict (key) do update set
            value = excluded.value,
            updated_by = excluded.updated_by,
            updated_at = now()
        `;
        changes.push({ key: item.key, before, after: item.value });
      }
      return { ok: true as const, changes };
    });
  } catch {
    console.warn('[store-admin/settings] could not update settings');
    return { ok: false, reason: 'unavailable', error: 'Settings are not available.' };
  }
}

/** Single-key wrapper kept for callers that only change one value. */
export async function updateStoreSetting(
  key: StoreSettingKey,
  value: unknown,
  staffId: string,
  canEditOwnerOnly = true,
): Promise<
  | { ok: true; key: StoreSettingKey; before: string; after: string }
  | { ok: false; reason: 'unavailable' | 'invalid-input' | 'forbidden'; error: string }
> {
  const result = await updateStoreSettings([{ key, value }], staffId, canEditOwnerOnly);
  if (!result.ok) return result;
  const change = result.changes[0];
  if (!change) {
    // No change: read the current value so the caller can answer truthfully.
    const current = await getStoreSettings();
    const value = current.ok ? current.settings[key] : DEFAULT_SETTINGS[key];
    return { ok: true, key, before: value, after: value };
  }
  return { ok: true, key: change.key, before: change.before, after: change.after };
}

export { SETTING_KEYS };

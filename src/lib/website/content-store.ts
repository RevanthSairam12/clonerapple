import { getSql } from '@/lib/platform/db';

/**
 * Server-side writes for the Website screens (storefront content and theme).
 *
 * Reads stay in `src/lib/content.ts` — the same functions the storefront
 * uses — so an edit is visible to the site immediately and there is only one
 * definition of "current value". This module owns the three write shapes:
 *
 * - save: an upsert that un-archives a previously reset row;
 * - reset: archive, never delete (content_blocks since 0033, site_settings
 *   since 0046);
 * - list: which keys currently carry an override, and who last changed them.
 *
 * `updated_by` is written with the editor's NAME, never the email: both
 * columns live in anonymised, publicly readable tables (RLS "public read"
 * policies from 0002), so an address there would be a data leak. The audit
 * log keeps the actor id and a masked email.
 */

export interface ContentOverride {
  key: string;
  updatedAt: string;
  updatedBy: string | null;
  archived: boolean;
}

export interface ThemeOverride {
  key: string;
  updatedAt: string;
  updatedBy: string | null;
}

export type StoreResult<T> = { ok: true; data: T } | { ok: false; error: string };

function unavailable<T>(): StoreResult<T> {
  return { ok: false, error: 'The database is not configured.' };
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Every content_blocks row, including archived ones (latest state per key). */
export async function listContentOverrides(): Promise<StoreResult<ContentOverride[]>> {
  const sql = getSql();
  if (!sql) return unavailable();
  try {
    const rows = await sql`
      select key, updated_at, updated_by, archived_at
      from content_blocks
      order by key asc
    `;
    return {
      ok: true,
      data: rows.map((row) => ({
        key: String(row.key),
        updatedAt: asIso(row.updated_at),
        updatedBy: asText(row.updated_by),
        archived: row.archived_at !== null && row.archived_at !== undefined,
      })),
    };
  } catch {
    console.warn('[website] could not list content overrides');
    return { ok: false, error: 'Saved content could not be read.' };
  }
}

export async function saveContentBlock(
  key: string,
  value: Record<string, unknown>,
  editorName: string,
): Promise<StoreResult<true>> {
  const sql = getSql();
  if (!sql) return unavailable();
  try {
    await sql`
      insert into content_blocks (key, value, updated_at, updated_by, archived_at)
      values (${key}, ${JSON.parse(JSON.stringify(value)) as never}, now(), ${editorName}, null)
      on conflict (key) do update
      set value = excluded.value,
          updated_at = now(),
          updated_by = excluded.updated_by,
          archived_at = null
    `;
    return { ok: true, data: true };
  } catch {
    console.warn('[website] content save failed');
    return { ok: false, error: 'The content could not be saved.' };
  }
}

/** Revert a collection to coded defaults by archiving its row. */
export async function archiveContentBlock(
  key: string,
  editorName: string,
): Promise<StoreResult<boolean>> {
  const sql = getSql();
  if (!sql) return unavailable();
  try {
    const rows = await sql`
      update content_blocks
      set archived_at = now(), updated_at = now(), updated_by = ${editorName}
      where key = ${key} and archived_at is null
      returning key
    `;
    return { ok: true, data: rows.length > 0 };
  } catch {
    console.warn('[website] content reset failed');
    return { ok: false, error: 'The content could not be reset.' };
  }
}

export async function listThemeOverrides(): Promise<StoreResult<ThemeOverride[]>> {
  const sql = getSql();
  if (!sql) return unavailable();
  try {
    const rows = await sql`
      select key, updated_at, updated_by
      from site_settings
      where archived_at is null
      order by key asc
    `;
    return {
      ok: true,
      data: rows.map((row) => ({
        key: String(row.key),
        updatedAt: asIso(row.updated_at),
        updatedBy: asText(row.updated_by),
      })),
    };
  } catch {
    console.warn('[website] could not list theme overrides');
    return { ok: false, error: 'Saved theme values could not be read.' };
  }
}

export async function saveThemeValue(
  key: string,
  value: string,
  editorName: string,
): Promise<StoreResult<true>> {
  const sql = getSql();
  if (!sql) return unavailable();
  try {
    await sql`
      insert into site_settings (key, value, updated_at, updated_by, archived_at)
      values (${key}, ${value}, now(), ${editorName}, null)
      on conflict (key) do update
      set value = excluded.value,
          updated_at = now(),
          updated_by = excluded.updated_by,
          archived_at = null
    `;
    return { ok: true, data: true };
  } catch {
    console.warn('[website] theme save failed');
    return { ok: false, error: 'The theme value could not be saved.' };
  }
}

/** Revert one theme value to its coded default by archiving the row. */
export async function archiveThemeValue(
  key: string,
  editorName: string,
): Promise<StoreResult<boolean>> {
  const sql = getSql();
  if (!sql) return unavailable();
  try {
    const rows = await sql`
      update site_settings
      set archived_at = now(), updated_at = now(), updated_by = ${editorName}
      where key = ${key} and archived_at is null
      returning key
    `;
    return { ok: true, data: rows.length > 0 };
  } catch {
    console.warn('[website] theme reset failed');
    return { ok: false, error: 'The theme value could not be reset.' };
  }
}

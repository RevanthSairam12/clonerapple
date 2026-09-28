import { createServerClient } from '@supabase/ssr';

import { getSql } from './admin/db';

/**
 * Theme keys the admin panel may write to site_settings. Sourced from the
 * Theme page field registry so the whitelist can never drift from the UI.
 */
import { THEME_FIELDS } from './admin/collections';

export const THEME_SETTING_KEYS: Set<string> = new Set(
  THEME_FIELDS.map((field) => field.path),
);

/**
 * Content layer — the single seam between the site and the admin panel.
 *
 * Every editable surface reads through these functions: when a row exists in
 * content_blocks the stored JSON wins; when it does not (no database, first
 * boot, never edited) the hardcoded default passed by the caller is returned
 * verbatim, so an unedited site renders pixel-identically to the original.
 *
 * Reads prefer the Supabase REST API (publishable key, RLS-scoped, read-only,
 * works over IPv4). Writes stay on the direct DATABASE_URL connection in the
 * admin API routes (table owner, bypasses RLS).
 *
 * All functions are safe to call from Server Components (pages/layouts).
 */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
}

/** Fetch one content block; returns null when absent (never throws). */
export async function getContentRaw<T>(key: string): Promise<T | null> {
  // Prefer REST (no DB connection pool, IPv4-friendly).
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('content_blocks')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (!error) return ((data?.value as T) ?? null);
    } catch {
      // fall through to the direct connection
    }
  }

  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`select value from content_blocks where key = ${key}`;
    return (rows[0]?.value as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * getContent('apple.hero_tiles', HERO_TILES) — DB value if an editor saved
 * one, otherwise the hardcoded fallback untouched.
 */
export async function getContent<T>(key: string, fallback: T): Promise<T> {
  const value = await getContentRaw<T>(key);
  return value ?? fallback;
}

/** Fetch several content blocks in one round-trip; missing keys fall back. */
export async function getContentMany<T extends Record<string, unknown>>(
  entries: { [K in keyof T]: [string, T[K]] },
): Promise<T> {
  const keys = Object.values(entries).map(([key]) => key);
  const result: Record<string, unknown> = {};

  if (keys.length > 0) {
    // Prefer REST (one batched request over IPv4).
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('content_blocks')
          .select('key, value')
          .in('key', keys);
        if (!error) for (const row of data ?? []) result[row.key] = row.value;
      } catch {
        // fall through to the direct connection
      }
    }

    if (Object.keys(result).length === 0) {
      const sql = getSql();
      if (sql) {
        try {
          const rows = await sql`select key, value from content_blocks where key in ${sql(keys)}`;
          for (const row of rows) result[row.key] = row.value;
        } catch {
          // fall through to defaults
        }
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const [name, [key, fallback]] of Object.entries(entries)) {
    out[name] = result[key] ?? fallback;
  }
  return out as T;
}

/** Fetch all site_settings rows at once (fonts, colors, logo). */
export async function getThemeSettings(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase.from('site_settings').select('key, value');
      if (!error) {
        const out: Record<string, string> = {};
        for (const row of data ?? []) out[row.key] = row.value;
        return out;
      }
    } catch {
      // fall through to the direct connection
    }
  }

  const sql = getSql();
  if (!sql) return {};
  try {
    const rows = await sql`select key, value from site_settings`;
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  } catch {
    return {};
  }
}

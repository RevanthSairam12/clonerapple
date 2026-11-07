import { createServerClient } from '@supabase/ssr';

import { getSql } from './platform/db';

/**
 * Theme keys the admin panel may write to site_settings. Sourced from the
 * Theme page field registry so the whitelist can never drift from the UI.
 */
import { THEME_FIELDS } from './website/collections';

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

const CONTENT_CACHE_TTL_MS = 15_000;

interface ContentCacheState {
  blocks: Map<string, { value: unknown; at: number }>;
  allLoadedAt: number;
  inflightAllBlocks: Promise<Map<string, unknown>> | null;
  inflightBlocks: Map<string, Promise<unknown>>;
  theme: { value: Record<string, string>; at: number } | null;
  inflightTheme: Promise<Record<string, string>> | null;
}

const globalForContent = globalThis as typeof globalThis & {
  __gadzioContentCache?: ContentCacheState;
};

function contentCache(): ContentCacheState {
  if (!globalForContent.__gadzioContentCache) {
    globalForContent.__gadzioContentCache = {
      blocks: new Map(),
      allLoadedAt: 0,
      inflightAllBlocks: null,
      inflightBlocks: new Map(),
      theme: null,
      inflightTheme: null,
    };
  }
  return globalForContent.__gadzioContentCache;
}

/** Clear cached content blocks and theme settings immediately after an admin write. */
export function clearContentCache(): void {
  const cache = contentCache();
  cache.blocks.clear();
  cache.allLoadedAt = 0;
  cache.inflightAllBlocks = null;
  cache.inflightBlocks.clear();
  cache.theme = null;
  cache.inflightTheme = null;
}

async function ensureAllContentBlocksLoaded(): Promise<void> {
  const cache = contentCache();
  const now = Date.now();
  if (cache.allLoadedAt > 0 && now - cache.allLoadedAt < CONTENT_CACHE_TTL_MS) {
    return;
  }

  if (!cache.inflightAllBlocks) {
    cache.inflightAllBlocks = (async () => {
      const fetched = new Map<string, unknown>();
      let loaded = false;

      const sql = getSql();
      if (sql) {
        try {
          const rows = await sql<{ key: string; value: unknown }[]>`
            select key, value from content_blocks
            where archived_at is null
          `;
          for (const row of rows) fetched.set(row.key, row.value);
          loaded = true;
        } catch {
          // fall through to Supabase REST fallback
        }
      }

      if (!loaded) {
        const supabase = getSupabase();
        if (supabase) {
          try {
            const { data, error } = await supabase
              .from('content_blocks')
              .select('key, value')
              .is('archived_at', null);
            if (!error) {
              for (const row of data ?? []) fetched.set(row.key, row.value);
              loaded = true;
            }
          } catch {
            // fall through to defaults
          }
        }
      }

      if (loaded) {
        const ts = Date.now();
        cache.blocks.clear();
        for (const [k, v] of fetched.entries()) {
          cache.blocks.set(k, { value: v ?? null, at: ts });
        }
        cache.allLoadedAt = ts;
      }
      return fetched;
    })().finally(() => {
      cache.inflightAllBlocks = null;
    });
  }

  await cache.inflightAllBlocks;
}

/** Fetch one content block; returns null when absent (never throws). */
export async function getContentRaw<T>(key: string): Promise<T | null> {
  const cache = contentCache();
  const now = Date.now();
  const hit = cache.blocks.get(key);
  if (hit && now - hit.at < CONTENT_CACHE_TTL_MS) {
    return (hit.value as T) ?? null;
  }
  if (cache.allLoadedAt > 0 && now - cache.allLoadedAt < CONTENT_CACHE_TTL_MS) {
    return null;
  }
  if (cache.allLoadedAt > 0) {
    void ensureAllContentBlocksLoaded();
    return (hit?.value as T) ?? null;
  }

  await ensureAllContentBlocksLoaded();
  const afterLoad = cache.blocks.get(key);
  return (afterLoad?.value as T) ?? null;
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
  const cache = contentCache();
  const now = Date.now();
  const allFresh =
    cache.allLoadedAt > 0 && now - cache.allLoadedAt < CONTENT_CACHE_TTL_MS;

  if (!allFresh) {
    if (cache.allLoadedAt > 0) {
      void ensureAllContentBlocksLoaded();
    } else {
      await ensureAllContentBlocksLoaded();
    }
  }

  const out: Record<string, unknown> = {};
  for (const [name, [key, fallback]] of Object.entries(entries)) {
    const hit = cache.blocks.get(key);
    out[name] = hit?.value ?? fallback;
  }
  return out as T;
}

function startThemeRefresh(cache: ContentCacheState): Promise<Record<string, string>> {
  if (cache.inflightTheme) return cache.inflightTheme;
  const inflight = (async () => {
    const sql = getSql();
    if (sql) {
      try {
        const rows = await sql<{ key: string; value: string }[]>`
          select key, value from site_settings where archived_at is null
        `;
        const out: Record<string, string> = {};
        for (const row of rows) out[row.key] = row.value;
        cache.theme = { value: out, at: Date.now() };
        return out;
      } catch {
        // fall through to Supabase REST fallback
      }
    }

    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('site_settings')
          .select('key, value')
          .is('archived_at', null);
        if (!error) {
          const out: Record<string, string> = {};
          for (const row of data ?? []) out[row.key] = row.value;
          cache.theme = { value: out, at: Date.now() };
          return out;
        }
      } catch {
        // fall through to defaults
      }
    }

    return {};
  })().finally(() => {
    if (cache.inflightTheme === inflight) {
      cache.inflightTheme = null;
    }
  });
  cache.inflightTheme = inflight;
  return inflight;
}

/**
 * Fetch all live site_settings rows at once (fonts, colors, logo).
 *
 * A row is archived — not deleted — when an editor resets a theme value
 * (migration 0046); archived rows are ignored here so the site falls back to
 * its coded default while the old value stays in the table for rollback.
 */
export async function getThemeSettings(): Promise<Record<string, string>> {
  const cache = contentCache();
  const now = Date.now();
  if (cache.theme && now - cache.theme.at < CONTENT_CACHE_TTL_MS) {
    return { ...cache.theme.value };
  }
  if (cache.theme) {
    void startThemeRefresh(cache);
    return { ...cache.theme.value };
  }

  return { ...(await startThemeRefresh(cache)) };
}

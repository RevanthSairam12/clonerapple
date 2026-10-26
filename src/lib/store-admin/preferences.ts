import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';
import { isDateOnly } from './delivery';
import { isOrderSort, isSaleState } from './orders';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin preferences must be server-only.');
}

type Row = Record<string, unknown>;

const MAX_SAVED_VIEWS = 10;
const MAX_NAME_LENGTH = 28;
const VIEW_FILTER_KEYS = ['q', 'channel', 'state', 'sort', 'from', 'to'] as const;

export interface SavedView {
  id: string;
  name: string;
  /** Canonical query string, always starts from the allow-listed keys. */
  query: string;
}

export type ViewsLoad =
  | { ok: true; views: SavedView[] }
  | { ok: false; reason: 'unavailable' };

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Collapse a filter set into the canonical order used by the orders page. */
export function canonicalViewQuery(input: Record<string, unknown>): string | null {
  const query = new URLSearchParams();

  const search = text(input.q).trim().slice(0, 100);
  if (search) query.set('q', search);

  const channel = text(input.channel).trim().toLowerCase();
  if (channel === 'web' || channel === 'pos') query.set('channel', channel);

  const state = text(input.state).trim().toUpperCase();
  if (state && isSaleState(state)) query.set('state', state);

  const sort = text(input.sort).trim();
  if (sort && isOrderSort(sort) && sort !== 'newest') query.set('sort', sort);

  const from = text(input.from).trim();
  if (from && isDateOnly(from)) query.set('from', from);

  const to = text(input.to).trim();
  if (to && isDateOnly(to)) query.set('to', to);

  // Sort on its own is not a view — it would just be the default list.
  const hasFilter = query.has('q') || query.has('channel') || query.has('state') || query.has('from') || query.has('to');
  if (!hasFilter) return null;
  return query.toString();
}

function cleanName(value: unknown): string | null {
  const name = text(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function cleanId(value: unknown): string | null {
  const id = text(value).trim();
  return /^view_[a-z0-9]{6,32}$/.test(id) ? id : null;
}

/**
 * Validate a whole view list coming from a client or from the preferences row.
 * Anything that fails validation is dropped rather than failing the request, so
 * a stale row can never break the orders page.
 */
export function sanitizeSavedViews(value: unknown): SavedView[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const views: SavedView[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = cleanId(record.id);
    const name = cleanName(record.name);
    if (!id || !name || seen.has(id)) continue;

    const query = canonicalViewQuery(
      Object.fromEntries(
        VIEW_FILTER_KEYS.map((key) => [
          key,
          typeof record.query === 'string' ? new URLSearchParams(record.query).get(key) : null,
        ]),
      ),
    );
    if (!query) continue;

    seen.add(id);
    views.push({ id, name, query });
    if (views.length >= MAX_SAVED_VIEWS) break;
  }

  return views;
}

export function newViewId(): string {
  return `view_${randomBytes(6).toString('hex')}`;
}

export async function getSavedViews(adminId: string): Promise<ViewsLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select saved_views from store_admin_preferences where admin_id = ${adminId}
    `) as Row[];
    const raw = rows[0]?.saved_views;
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        value = [];
      }
    }
    return { ok: true, views: sanitizeSavedViews(value) };
  } catch {
    console.warn('[store-admin/preferences] could not read saved views');
    return { ok: false, reason: 'unavailable' };
  }
}

export type SaveViewsResult =
  | { ok: true; views: SavedView[] }
  | { ok: false; reason: 'unavailable' | 'invalid-input'; error: string };

/**
 * Replace the saved view list for one staff member. The list is normalised
 * first, so the jsonb column only ever holds allow-listed filters.
 */
export async function saveSavedViews(adminId: string, views: unknown): Promise<SaveViewsResult> {
  if (!Array.isArray(views)) {
    return { ok: false, reason: 'invalid-input', error: 'Views must be a list.' };
  }
  const clean = sanitizeSavedViews(views);
  if (clean.length === 0 && views.length > 0) {
    return { ok: false, reason: 'invalid-input', error: 'That view cannot be saved — pick at least one filter.' };
  }

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Preferences are not available.' };
  try {
    await sql`
      insert into store_admin_preferences (admin_id, saved_views, updated_at)
      values (${adminId}, ${sql.json(clean.map(({ id, name, query }) => ({ id, name, query })))}, now())
      on conflict (admin_id) do update
        set saved_views = excluded.saved_views,
            updated_at = now()
    `;
    return { ok: true, views: clean };
  } catch {
    console.warn('[store-admin/preferences] could not save views');
    return { ok: false, reason: 'unavailable', error: 'Preferences are not available.' };
  }
}

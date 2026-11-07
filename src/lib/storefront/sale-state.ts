/**
 * Server reader for the one-row `sale_settings` switch.
 *
 * The status comes from `saleStatusAt()` with `now()` from PostgreSQL, so a
 * browser with the wrong clock cannot start or extend a sale. A missing row,
 * a missing table or a query failure reads as **off**, which makes every
 * caller fall back to regular prices and normal mode.
 */

import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';

import { saleStatusAt, type SaleStatus, type SaleWindow } from './sale';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Sale state is read on the server only.');
}

export interface SaleState extends SaleWindow {
  status: SaleStatus;
  live: boolean;
  /** The database clock used for the decision, ISO-8601. */
  databaseNow: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** True when the switch could not be read and everything fell back to off. */
  unreadable: boolean;
}

export const SALE_OFF: SaleState = {
  enabled: false,
  startsAt: null,
  endsAt: null,
  status: 'off',
  live: false,
  databaseNow: new Date(0).toISOString(),
  updatedAt: null,
  updatedBy: null,
  unreadable: true,
};

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function readSaleStateUsing(
  sql: postgres.Sql | postgres.TransactionSql,
  options: { authoritative?: boolean } = {},
): Promise<SaleState> {
  const rows = (await sql`
    select enabled, starts_at, ends_at, updated_at, updated_by, now() as db_now
    from sale_settings
    where id = 'default'
    limit 1
  `) as Row[];

  const row = rows[0] ?? {};
  // Checkout evaluates the sale after acquiring stock locks, not at the start
  // of a transaction that may have waited across a sale boundary. When the sale
  // switch is disabled, the window cannot be live at any timestamp, so the
  // statement's own db_now is sufficient.
  const clock = (options.authoritative && Boolean(row.enabled)) || !row.db_now
    ? await sql`select clock_timestamp() as db_now`
    : null;
  const databaseNow = iso(clock?.[0]?.db_now ?? row.db_now);
  if (!databaseNow || (options.authoritative && rows.length === 0)) {
    throw new Error('Checkout sale settings are temporarily unavailable.');
  }
  const window: SaleWindow = {
    enabled: Boolean(row.enabled),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
  };
  const status = saleStatusAt(window, databaseNow);

  return {
    ...window,
    status,
    live: status === 'live',
    databaseNow,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by === null || row.updated_by === undefined
      ? null
      : text(row.updated_by),
    unreadable: rows.length === 0,
  };
}

export const SALE_STATE_CACHE_TTL_MS = 3_000;

interface SaleCacheSlot {
  state: SaleState | null;
  at: number;
  inflight: Promise<SaleState> | null;
}

const globalForSaleState = globalThis as typeof globalThis & {
  __gadzioSaleStateCache?: SaleCacheSlot;
  __gadzioCatalogSnapshot?: unknown;
};

function saleCacheSlot(): SaleCacheSlot {
  if (!globalForSaleState.__gadzioSaleStateCache) {
    globalForSaleState.__gadzioSaleStateCache = { state: null, at: 0, inflight: null };
  }
  return globalForSaleState.__gadzioSaleStateCache;
}

/** Clear the short in-memory sale switch cache immediately after a Store Admin write. */
export function clearSaleStateCache(): void {
  const slot = saleCacheSlot();
  slot.state = null;
  slot.at = 0;
  slot.inflight = null;
  globalForSaleState.__gadzioCatalogSnapshot = null;
}

function advanceSaleState(cached: SaleState, elapsedMs: number): SaleState {
  const baseMs = Date.parse(cached.databaseNow);
  const advancedIso = Number.isFinite(baseMs)
    ? new Date(baseMs + Math.max(0, elapsedMs)).toISOString()
    : cached.databaseNow;
  const status = saleStatusAt(cached, advancedIso);
  return {
    ...cached,
    status,
    live: status === 'live',
    databaseNow: advancedIso,
  };
}

function startSaleStateRefresh(sql: postgres.Sql, slot: SaleCacheSlot): Promise<SaleState> {
  if (slot.inflight) return slot.inflight;
  const inflight = (async (): Promise<SaleState> => {
    try {
      const state = await readSaleStateUsing(sql);
      slot.state = state;
      slot.at = Date.now();
      return state;
    } catch {
      console.warn('[storefront/sale] sale settings unavailable; using regular prices and normal mode');
      slot.state = null;
      slot.at = 0;
      return { ...SALE_OFF };
    }
  })().finally(() => {
    if (slot.inflight === inflight) {
      slot.inflight = null;
    }
  });
  slot.inflight = inflight;
  return inflight;
}

/** Never throws: an unreadable switch means regular prices and normal mode. */
export async function readSaleState(): Promise<SaleState> {
  const sql = getSql();
  if (!sql) return { ...SALE_OFF };

  const slot = saleCacheSlot();
  const now = Date.now();
  if (slot.state && now - slot.at < SALE_STATE_CACHE_TTL_MS) {
    return advanceSaleState(slot.state, now - slot.at);
  }
  return { ...(await startSaleStateRefresh(sql, slot)) };
}

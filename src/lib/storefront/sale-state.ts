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
): Promise<SaleState> {
  const rows = (await sql`
    select enabled, starts_at, ends_at, updated_at, updated_by, now() as db_now
    from sale_settings
    where id = 'default'
    limit 1
  `) as Row[];

  const row = rows[0] ?? {};
  const databaseNow = iso(row.db_now) ?? new Date().toISOString();
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

/** Never throws: an unreadable switch means regular prices and normal mode. */
export async function readSaleState(): Promise<SaleState> {
  const sql = getSql();
  if (!sql) return { ...SALE_OFF };
  try {
    return await readSaleStateUsing(sql);
  } catch {
    console.warn('[storefront/sale] sale settings unavailable; using regular prices and normal mode');
    return { ...SALE_OFF };
  }
}

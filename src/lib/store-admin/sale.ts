import type postgres from 'postgres';

import { getSql } from '@/lib/admin/db';
import { readSaleStateUsing, type SaleState } from '@/lib/storefront/sale-state';

import type { CatalogWrite } from './catalog-writes';
import { getStoreSettings } from './settings';
import {
  bulkSalePrice,
  type SaleSettingsInput,
} from './sale-admin-rules';

/**
 * Sale mode for the store admin.
 *
 * The one-row `sale_settings` table holds the switch and the optional window;
 * `readSaleStateUsing` decides the status on the database clock. This module
 * only writes: nothing here compares timestamps itself.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Sale settings are read and written on the server only.');
}

type Row = Record<string, unknown>;
type Tx = postgres.TransactionSql;

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fail(
  reason: 'unavailable' | 'invalid-input',
  error: string,
): { ok: false; reason: 'unavailable' | 'invalid-input'; error: string } {
  return { ok: false, reason, error };
}

/** The store timezone, falling back to IST when it cannot be read. */
export async function getStoreTimeZone(): Promise<string> {
  const settings = await getStoreSettings();
  if (!settings.ok) return DEFAULT_TIMEZONE;
  const zone = settings.settings.timezone.trim();
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export interface SaleProductRow {
  id: string;
  name: string;
  pricePaise: number;
  salePricePaise: number | null;
  costPaise: number | null;
  /** True only when the product has a stock row with tracking on. */
  tracked: boolean;
  onHand: number | null;
  reserved: number | null;
  available: number | null;
  lowStockThreshold: number | null;
  isActive: boolean;
}

export interface SaleAdminData {
  state: SaleState;
  timezone: string;
  products: SaleProductRow[];
}

export type SaleAdminLoad =
  | { ok: true; data: SaleAdminData }
  | { ok: false; reason: 'unavailable' };

function mapProduct(row: Row): SaleProductRow {
  const hasStock = row.track_inventory !== null && row.track_inventory !== undefined;
  const onHand = hasStock ? number(row.on_hand) : null;
  const reserved = hasStock ? number(row.reserved) : null;
  return {
    id: text(row.id),
    name: text(row.name),
    pricePaise: number(row.price_paise),
    salePricePaise: nullableNumber(row.sale_price_paise),
    costPaise: nullableNumber(row.cost_paise),
    tracked: Boolean(row.track_inventory),
    onHand,
    reserved,
    available: onHand === null || reserved === null ? null : onHand - reserved,
    lowStockThreshold: hasStock ? number(row.low_stock_threshold) : null,
    isActive: Boolean(row.is_active),
  };
}

/** Everything the sale screen shows: the switch, the clock and every product. */
export async function getSaleAdminData(): Promise<SaleAdminLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const [state, timezone, rows] = await Promise.all([
      readSaleStateUsing(sql),
      getStoreTimeZone(),
      sql`
        select p.id, p.name, p.price_paise, p.sale_price_paise, p.cost_paise,
               p.is_active, s.on_hand, s.reserved, s.low_stock_threshold,
               s.track_inventory
        from products p
        left join stock s on s.product_id = p.id and s.variant_id is null
        where p.deleted_at is null
        order by p.name asc, p.id asc
      `,
    ]);

    return {
      ok: true,
      data: {
        state,
        timezone,
        products: (rows as Row[]).map(mapProduct),
      },
    };
  } catch {
    console.warn('[store-admin/sale] could not read the sale screen');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface SaleSettingsSnapshot {
  before: SaleState;
  after: SaleState;
  changed: boolean;
}

/**
 * Write the switch and window. The naive wall-clock strings are converted by
 * PostgreSQL using the store timezone, so the stored instant is exact.
 */
export async function updateSaleSettings(
  input: SaleSettingsInput,
  timezone: string,
  staffId: string,
): Promise<CatalogWrite<SaleSettingsSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Sale settings are not available.');
  return updateSaleSettingsUsing(sql, input, timezone, staffId);
}

/** The same write against a caller-supplied connection (integration tests). */
export async function updateSaleSettingsUsing(
  sql: postgres.Sql,
  input: SaleSettingsInput,
  timezone: string,
  staffId: string,
): Promise<CatalogWrite<SaleSettingsSnapshot>> {
  try {
    return await sql.begin(async (tx) => {
      const before = await readSaleStateUsing(tx);
      // `::text` first: the driver would otherwise serialize the naive wall
      // clock as a JS Date in the server's own zone and shift the instant.
      await tx`
        update sale_settings
        set enabled = ${input.enabled},
            starts_at = (${input.startsAt}::text)::timestamp at time zone ${timezone}::text,
            ends_at = (${input.endsAt}::text)::timestamp at time zone ${timezone}::text,
            updated_at = now(),
            updated_by = ${staffId}
        where id = 'default'
      `;
      const after = await readSaleStateUsing(tx);

      const changed =
        before.enabled !== after.enabled
        || before.startsAt !== after.startsAt
        || before.endsAt !== after.endsAt;

      return { ok: true as const, data: { before, after, changed } };
    });
  } catch (error) {
    console.warn('[store-admin/sale] could not write sale settings:', errorMessage(error));
    return fail('unavailable', 'Sale settings could not be saved.');
  }
}

export type SaleBulkAction =
  | { action: 'percent'; percent: number }
  | { action: 'clear' };

export interface SaleBulkResult {
  action: 'percent' | 'clear';
  percent: number | null;
  /** Products that had a sale price before the write. */
  beforeWithSalePrice: number;
  changed: number;
  /** Products skipped because the computed price was not a usable amount. */
  skipped: number;
}

/**
 * Apply a percent discount to every live product, or clear every sale price.
 * Each changed product gets an append-only history row in the same
 * transaction, so the bulk action and its paper trail commit together.
 */
export async function applySalePrices(input: SaleBulkAction, staffId: string): Promise<CatalogWrite<SaleBulkResult>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  return applySalePricesUsing(sql, input, staffId);
}

/** The same write against a caller-supplied connection (integration tests). */
export async function applySalePricesUsing(
  sql: postgres.Sql,
  input: SaleBulkAction,
  staffId: string,
): Promise<CatalogWrite<SaleBulkResult>> {
  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id, price_paise, sale_price_paise
        from products
        where deleted_at is null
        order by id
        for update
      `) as Row[];

      const beforeWithSalePrice = rows.filter(
        (row) => row.sale_price_paise !== null && row.sale_price_paise !== undefined,
      ).length;

      const updates: Array<{ id: string; before: number | null; next: number | null }> = [];
      let skipped = 0;

      for (const row of rows) {
        const current = nullableNumber(row.sale_price_paise);
        if (input.action === 'clear') {
          if (current !== null) updates.push({ id: text(row.id), before: current, next: null });
          continue;
        }
        const next = bulkSalePrice(number(row.price_paise), input.percent);
        if (next === null) {
          skipped += 1;
          continue;
        }
        if (next !== current) {
          updates.push({ id: text(row.id), before: current, next });
        }
      }

      for (const update of updates) {
        await tx`
          update products
          set sale_price_paise = ${update.next},
              updated_at = now(),
              updated_by = ${staffId}
          where id = ${update.id}
        `;
      }

      const history = updates.map((update) => ({
        product_id: update.id,
        variant_id: null,
        old_price_paise: update.before,
        new_price_paise: update.next ?? 0,
        price_kind: update.next === null ? 'sale_cleared' : 'sale',
        currency: 'INR',
        reason: update.next === null ? 'sale_bulk_clear' : 'sale_bulk_percent',
        source: 'store_admin',
        changed_by: staffId,
      }));

      if (history.length > 0) {
        await tx`
          insert into price_history
          ${tx(
            history,
            'product_id',
            'variant_id',
            'old_price_paise',
            'new_price_paise',
            'price_kind',
            'currency',
            'reason',
            'source',
            'changed_by',
          )}
        `;
      }

      return {
        ok: true as const,
        data: {
          action: input.action,
          percent: input.action === 'percent' ? input.percent : null,
          beforeWithSalePrice,
          changed: updates.length,
          skipped,
        },
      };
    });
  } catch (error) {
    console.warn('[store-admin/sale] could not apply sale prices:', errorMessage(error));
    return fail('unavailable', 'Sale prices could not be saved.');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

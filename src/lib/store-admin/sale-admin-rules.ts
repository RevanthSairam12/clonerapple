/**
 * Pure rules for the sale screen. No database, no framework.
 *
 * Datetime values travel as naive wall-clock strings (`YYYY-MM-DDTHH:mm`) in
 * the store's configured timezone; the database converts them with
 * `::timestamp at time zone <store tz>`. Nothing here reads the browser clock
 * or the machine clock to decide whether a sale is live.
 */

import type { SaleStatus } from '@/lib/storefront/sale';

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SaleSettingsInput {
  enabled: boolean;
  /** Naive wall-clock start in the store timezone, or null for no start. */
  startsAt: string | null;
  /** Naive wall-clock end in the store timezone, or null for no end. */
  endsAt: string | null;
}

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

function localDateTime(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string' || !LOCAL_DATETIME_RE.test(value.trim())) {
    return { ok: false, error: 'Use a date and time in the form YYYY-MM-DDTHH:mm.' };
  }
  const cleaned = value.trim();
  if (!Number.isFinite(Date.parse(cleaned))) {
    return { ok: false, error: 'That date and time is not valid.' };
  }
  return { ok: true, value: cleaned };
}

export function validateSaleSettingsInput(input: unknown): FieldResult<SaleSettingsInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Send the sale settings as a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean') {
    return { ok: false, error: 'Say whether sale mode is on.' };
  }

  const starts = localDateTime(body.startsAt);
  if (!starts.ok) return starts;
  const ends = localDateTime(body.endsAt);
  if (!ends.ok) return ends;

  if (
    starts.value !== null
    && ends.value !== null
    && Date.parse(starts.value) >= Date.parse(ends.value)
  ) {
    return { ok: false, error: 'The end must be after the start.' };
  }

  return {
    ok: true,
    value: { enabled: body.enabled, startsAt: starts.value, endsAt: ends.value },
  };
}

export const SALE_PERCENT_MIN = 1;
export const SALE_PERCENT_MAX = 95;

export function parseSalePercent(value: unknown): FieldResult<number> {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < SALE_PERCENT_MIN
    || parsed > SALE_PERCENT_MAX
  ) {
    return {
      ok: false,
      error: `Enter a whole percent between ${SALE_PERCENT_MIN} and ${SALE_PERCENT_MAX}.`,
    };
  }
  return { ok: true, value: parsed };
}

/**
 * The sale price after a percent off, floored to whole paise. Null when the
 * result would not be a usable price (zero) — the caller skips that product
 * rather than writing an invalid row.
 */
export function bulkSalePrice(pricePaise: number, percent: number): number | null {
  if (!Number.isSafeInteger(pricePaise) || pricePaise <= 0) return null;
  if (!Number.isInteger(percent) || percent < SALE_PERCENT_MIN || percent > SALE_PERCENT_MAX) {
    return null;
  }
  const next = Math.floor((pricePaise * (100 - percent)) / 100);
  return next >= 1 && next < pricePaise ? next : null;
}

export function saleStatusLabel(status: SaleStatus): string {
  if (status === 'live') return 'SALE LIVE';
  if (status === 'scheduled') return 'SALE SCHEDULED';
  return 'SALE OFF';
}

export interface SalePreflightRow {
  name: string;
  salePricePaise: number | null;
  costPaise: number | null;
  tracked: boolean;
  available: number | null;
}

export interface SalePreflightWarning {
  key: 'tracking-off' | 'zero-stock' | 'below-cost';
  count: number;
  /** Up to five product names, for a short operator-facing list. */
  names: string[];
}

export interface SalePreflight {
  withSalePrice: number;
  warnings: SalePreflightWarning[];
}

function warning(
  key: SalePreflightWarning['key'],
  rows: SalePreflightRow[],
): SalePreflightWarning {
  return {
    key,
    count: rows.length,
    names: rows.slice(0, 5).map((row) => row.name),
  };
}

/** Warnings are advisory; none of them blocks a sale write. */
export function salePreflight(rows: readonly SalePreflightRow[]): SalePreflight {
  const onSale = rows.filter((row) => row.salePricePaise !== null);
  const trackingOff = onSale.filter((row) => !row.tracked);
  const zeroStock = onSale.filter(
    (row) => row.tracked && (row.available ?? 0) <= 0,
  );
  const belowCost = onSale.filter(
    (row) => row.costPaise !== null && row.salePricePaise !== null && row.salePricePaise < row.costPaise,
  );

  return {
    withSalePrice: onSale.length,
    warnings: [
      warning('tracking-off', trackingOff),
      warning('zero-stock', zeroStock),
      warning('below-cost', belowCost),
    ].filter((entry) => entry.count > 0),
  };
}

/**
 * An ISO instant as the `datetime-local` value in `timeZone`. Invalid input or
 * an unknown zone returns an empty string, which renders as an empty field.
 */
export function toLocalDateTimeInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const year = pick('year');
    const month = pick('month');
    const day = pick('day');
    const hour = pick('hour');
    const minute = pick('minute');
    if (!year || !month || !day || hour === '' || minute === '') return '';
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return '';
  }
}

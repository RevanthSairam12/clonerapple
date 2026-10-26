/**
 * Sale-mode status, decided against the database clock.
 *
 * Pure: callers pass the `now()` returned by PostgreSQL. The browser clock is
 * never consulted for whether the sale is live.
 */

export interface SaleWindow {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export type SaleStatus = 'live' | 'scheduled' | 'off';

function ms(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Live when the switch is on and the database clock is inside the optional
 * window. A row with no window is decided by the switch alone. `starts_at` is
 * inclusive, `ends_at` exclusive, so a sale stops the instant it ends.
 */
export function saleStatusAt(sale: SaleWindow, databaseNow: string): SaleStatus {
  if (!sale.enabled) return 'off';
  const now = ms(databaseNow);
  if (now === null) return 'off';

  const startsAt = ms(sale.startsAt);
  const endsAt = ms(sale.endsAt);
  if (startsAt !== null && now < startsAt) return 'scheduled';
  if (endsAt !== null && now >= endsAt) return 'off';
  return 'live';
}

export function isSaleLive(sale: SaleWindow, databaseNow: string): boolean {
  return saleStatusAt(sale, databaseNow) === 'live';
}

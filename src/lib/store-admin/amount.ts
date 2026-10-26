/** Money input helpers shared by the admin routes and UI. Pure functions. */

/**
 * The store's revenue definition: the order total as charged, i.e.
 * items − discount + shipping.
 *
 * `total_paise` is authoritative; orders created before migration 0014 only
 * have the rupee `amount`, so fall back to it instead of counting them as
 * zero. Shipping is included because the customer paid it. The item-wise and
 * category/brand reports sum `line_total_paise`, which is product revenue and
 * therefore excludes shipping by construction.
 */
export function orderRevenuePaise(totalPaise: unknown, amountRupees: unknown): number {
  const total = Number(totalPaise);
  if (Number.isFinite(total) && total > 0) return Math.trunc(total);
  const amount = Number(amountRupees);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

/**
 * Parse an amount in rupees (decimal string or number) into integer paise.
 * Rejects zero, negatives, more than two decimals and absurd magnitudes.
 */
export function parseAmountToPaise(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  const paise = Math.round(parseFloat(trimmed) * 100);
  return paise > 0 ? paise : null;
}

/**
 * Format integer paise as `₹1,23,456.78` (en-IN). Negative amounts keep the
 * sign in front of the symbol (`-₹250.00`), which the transaction statement
 * uses for refund lines.
 */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Money input helpers shared by the admin routes and UI. Pure functions. */

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

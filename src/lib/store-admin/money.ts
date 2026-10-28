/**
 * Rupee ↔ paise conversion for every store-admin money field.
 *
 * Admins type rupees; the database stores whole paise. This is the one parser
 * and formatter for that boundary, so the product editor, the inline sale
 * table, bulk actions and CSV import cannot disagree about `499.50`.
 *
 * The parser accepts what an admin is likely to paste — `₹1,299.50`,
 * `Rs 1299`, `1,29,900.50` — rejects negative and more-than-two-decimal values,
 * and uses integer arithmetic so `4.35` cannot become 434.99999999999994.
 *
 * Pure and safe to import from client components.
 */

/** ₹10,00,000 — the largest price the catalogue accepts. */
export const MAX_PRICE_PAISE = 1_000_000_00;

const RUPEE_RE = /^\d+(?:\.\d{1,2})?$/;

export type RupeeParse =
  | { ok: true; paise: number | null }
  | { ok: false; message: string };

/**
 * Parse an admin-typed rupee amount.
 *
 * A blank value is `{ ok: true, paise: null }`: callers decide whether blank
 * means "clear this field" (sale/compare-at) or "a value is required"
 * (selling price).
 */
export function parseRupeesToPaise(value: unknown): RupeeParse {
  const raw = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const cleaned = raw
    .replace(/[₹,\s]/g, '')
    .replace(/^rs\.?/i, '');

  if (cleaned === '') return { ok: true, paise: null };
  if (!RUPEE_RE.test(cleaned)) {
    return {
      ok: false,
      message: 'Enter an amount in rupees, for example 499.50.',
    };
  }

  const [rupees, fraction = ''] = cleaned.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) {
    return { ok: false, message: 'That amount is too large.' };
  }
  return { ok: true, paise };
}

/** `49950` → `₹499.50`; `12990050` → `₹1,29,900.50`. */
export function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/**
 * Why a sale price cannot be stored, or null when it can.
 *
 * The complete rule set: the regular price must exist and be above zero, the
 * sale price must be a positive whole number of paise, and it must be strictly
 * lower than the regular price. Below-cost is deliberately **not** here — it
 * is a warning, never a block.
 */
export function salePriceProblem(salePaise: number, regularPaise: number): string | null {
  if (!Number.isInteger(regularPaise) || regularPaise <= 0) {
    return 'Set a regular price above zero before adding a sale price.';
  }
  if (!Number.isInteger(salePaise) || salePaise <= 0) {
    return 'Sale price must be a positive amount above zero. Leave it blank to clear it.';
  }
  if (salePaise > MAX_PRICE_PAISE) {
    return `Sale price must be ${formatRupees(MAX_PRICE_PAISE)} or less.`;
  }
  if (salePaise >= regularPaise) {
    return `Sale price must be lower than the regular price (${formatRupees(regularPaise)}).`;
  }
  return null;
}

/** A non-blocking warning, or null when the sale price is at/above cost. */
export function belowCostWarning(salePaise: number, costPaise: number | null): string | null {
  if (costPaise === null || !Number.isInteger(costPaise)) return null;
  if (salePaise >= costPaise) return null;
  return `Sale price is below cost (${formatRupees(costPaise)}). It will still be saved.`;
}

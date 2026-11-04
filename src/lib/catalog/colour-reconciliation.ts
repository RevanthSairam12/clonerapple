import { createHash } from 'node:crypto';
import { normalizeSharedName } from './shared-list-rules';

type Row = Record<string, unknown>;
export interface ColourSnapshot {
  schema: { missing: string[]; rlsDisabled: string[] };
  colours: Row[]; variants: Row[]; links: Row[]; products: Row[];
}
export interface ColourLink { product_id: string; variant_id: string; colour_id: string }
export interface ColourIssue { productId: string; variantId: string; code: string }
export interface ColourPlan {
  version: number; digest: string; schema: ColourSnapshot['schema'];
  inserts: ColourLink[]; review: ColourIssue[];
  counts: { insertLinks: number; existingLinks: number; review: number; affectedProducts: number; audit: number };
}
export const safeCatalogueId = (value: unknown): string => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(String(value ?? '')) ? String(value) : '[redacted-id]';
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const hex = (value: unknown): string | null => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
const key = (value: unknown) => normalizeSharedName(String(value ?? ''));

/** Evidence requires BOTH an explicit colour option name and matching name+hex.
 * No label parsing, nearest matches, hex-only guesses, seeds or identity changes.
 * Inactive/retired variants are reported, not given new selections. Saved links,
 * even inactive ones, are never replaced. Only owner-created active colours qualify.
 */
export function planColourReconciliation(snapshot: ColourSnapshot, target: string): ColourPlan {
  const inserts: ColourLink[] = [], review: ColourIssue[] = [];
  let existingLinks = 0;
  const issue = (variant: Row, code: string) => review.push({ productId: safeCatalogueId(variant.product_id), variantId: safeCatalogueId(variant.id), code });
  for (const variant of [...snapshot.variants].sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'))) {
    const links = snapshot.links.filter(link => link.variant_id === variant.id);
    if (links.length) {
      if (links.length !== 1 || links[0].product_id !== variant.product_id || !snapshot.colours.some(colour => colour.id === links[0].colour_id)) issue(variant, 'existing-link-conflict');
      else existingLinks++;
      continue; // A saved link is authoritative, never re-evaluated for replacement.
    }
    if (!['colour', 'color'].includes(key(variant.option_name))) continue;
    const product = snapshot.products.filter(row => row.id === variant.product_id);
    if (product.length !== 1 || product[0].deleted_at != null || variant.retired_at != null || variant.is_active !== true) { issue(variant, 'ineligible-option'); continue; }
    if (snapshot.variants.filter(row => row.id === variant.id).length !== 1) { issue(variant, 'ambiguous-variant'); continue; }
    const name = key(variant.option_value), value = hex(variant.option_hex);
    if (!name || !value) { issue(variant, 'missing-name-or-hex'); continue; }
    const names = snapshot.colours.filter(colour => key(colour.name) === name);
    const hexes = snapshot.colours.filter(colour => hex(colour.hex) === value);
    if (!names.length && !hexes.length) { issue(variant, 'unmatched-colour'); continue; }
    if (names.length !== 1 || hexes.length !== 1 || names[0].id !== hexes[0].id) { issue(variant, 'name-hex-disagreement-or-collision'); continue; }
    if (names[0].is_active !== true) { issue(variant, 'inactive-colour'); continue; }
    const link = { product_id: String(variant.product_id), variant_id: String(variant.id), colour_id: String(names[0].id) };
    if (Object.values(link).some(id => safeCatalogueId(id) !== id)) { issue(variant, 'unsafe-identifier'); continue; }
    inserts.push(link);
  }
  inserts.sort((a, b) => a.product_id.localeCompare(b.product_id, 'en') || a.variant_id.localeCompare(b.variant_id, 'en'));
  const schema = { missing: [...snapshot.schema.missing].sort(), rlsDisabled: [...snapshot.schema.rlsDisabled].sort() };
  const counts = { insertLinks: inserts.length, existingLinks, review: review.length, affectedProducts: new Set(inserts.map(row => row.product_id)).size, audit: inserts.length ? 1 : 0 };
  const content = { version: 1, schema, inserts, review, counts };
  return { ...content, digest: createHash('sha256').update(canonical({ target, snapshot, content })).digest('hex') };
}
export function assertColourApproval(plan: ColourPlan, approvedDigest: string): void {
  if (!/^[a-f0-9]{64}$/.test(approvedDigest) || plan.digest !== approvedDigest) throw new Error('Colour approval mismatch; obtain a fresh dry-run approval.');
  if (plan.schema.missing.length || plan.schema.rlsDisabled.length) throw new Error('Colour schema/RLS is not ready; install separately and replan.');
  // Review rows are deliberately excluded, not guessed or changed.
}

/** Read-only collision diagnostics include inactive records, never their names. */
export function sharedNameCollisions(brands: Row[], models: Row[], colours: Row[] = []) {
  const groups = (rows: Row[], identity: (row: Row) => string) => {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) { const value = identity(row); grouped.set(value, [...(grouped.get(value) ?? []), row]); }
    return [...grouped.values()].filter(rows => rows.length > 1).map(rows => rows.map(row => ({ id: safeCatalogueId(row.id), active: row.is_active === true })).sort((a, b) => a.id.localeCompare(b.id, 'en'))).sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
  };
  return { brands: groups(brands, row => key(row.name)), models: groups(models, row => JSON.stringify([row.brand_id, key(row.name)])), colours: groups(colours, row => key(row.name)), colourHexes: groups(colours.filter(row => hex(row.hex)), row => hex(row.hex)!) };
}

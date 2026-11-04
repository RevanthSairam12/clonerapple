import { createHash } from 'node:crypto';

/** Historical allowlist, not a classifier. No names, descriptions, broad device
 * phrases, or newly created products are used to infer an assignment. */
export const HISTORICAL_PRODUCTS = [
  { id: 'iphone18pro-max-clear-magsafe', category: 'cases-protection', type: 'type_cases_protection_case', models: ['iPhone 18 Pro Max', 'iPhone 18 Pro'] },
  { id: 'iphone17-silicone-black', category: 'cases-protection', type: 'type_cases_protection_case', models: ['iPhone 17'] },
  { id: 'mc-gadzio-silicone-17promax', category: 'mobile-cases', type: 'type_mobile_case', models: ['iPhone 17 Pro Max'] },
  { id: 'mc-gadzio-clear-17pro', category: 'mobile-cases', type: 'type_mobile_case', models: ['iPhone 17 Pro'] },
  { id: 'ac-gadzio-silicone-pro3', category: 'airpods-case', type: 'type_airpods_case', models: ['AirPods Pro 3'] },
  { id: 'ac-gadzio-silicone-pro2', category: 'airpods-case', type: 'type_airpods_case', models: ['AirPods Pro 2'] },
  { id: 'pa-gadzio-20w-usbc', category: 'power-adapter-cable', type: 'type_power_adapter', models: [] },
  { id: 'pa-gadzio-35w-dual', category: 'power-adapter-cable', type: 'type_power_adapter', models: [] },
  { id: 'we-gadzio-pulse-usbc', category: 'wired-earphones', type: 'type_wired_earphones', models: [] },
  { id: 'we-gadzio-pulse-35mm', category: 'wired-earphones', type: 'type_wired_earphones', models: [] },
  { id: 'cpc-gadzio-silicone-organizer', category: 'cable-plug-case', type: 'type_cable_organizer', models: [] },
  { id: 'cpc-gadzio-charger-shell-20w', category: 'cable-plug-case', type: 'type_charger_shell', models: [] },
] as const;

export const HISTORICAL_TYPES = [
  { id: 'type_cases_protection_case', category: 'cases-protection', name: 'Protective Case', requires_compatibility: true, keys: ['material', 'brand'] },
  { id: 'type_mobile_case', category: 'mobile-cases', name: 'Mobile Case', requires_compatibility: true, keys: ['material', 'brand'] },
  { id: 'type_airpods_case', category: 'airpods-case', name: 'AirPods Case', requires_compatibility: true, keys: ['material', 'brand'] },
  { id: 'type_power_adapter', category: 'power-adapter-cable', name: 'Power Adapter', requires_compatibility: false, keys: ['wattage', 'connector', 'brand'] },
  { id: 'type_wired_earphones', category: 'wired-earphones', name: 'Wired Earphones', requires_compatibility: false, keys: ['connector', 'driver', 'brand'] },
  { id: 'type_cable_organizer', category: 'cable-plug-case', name: 'Cable Organizer', requires_compatibility: false, keys: ['type', 'material', 'brand'] },
  { id: 'type_charger_shell', category: 'cable-plug-case', name: 'Charger Case', requires_compatibility: false, keys: ['type', 'material', 'brand'] },
] as const;

export const HISTORICAL_MODELS = [
  ['device_iphone_18_pro_max', 'iPhone 18 Pro Max'],
  ['device_iphone_18_pro', 'iPhone 18 Pro'],
  ['device_iphone_17', 'iPhone 17'],
  ['device_iphone_17_pro_max', 'iPhone 17 Pro Max'],
  ['device_iphone_17_pro', 'iPhone 17 Pro'],
  ['device_airpods_pro_3', 'AirPods Pro 3'],
  ['device_airpods_pro_2', 'AirPods Pro 2'],
] as const;

// There are SEVEN exact device labels in the supplied six-product mapping:
// three cases-protection labels, two mobile labels, two AirPods labels.
export type BackfillRow = Record<string, unknown>;
export interface BackfillSnapshot {
  schema: { missing: string[]; rlsDisabled: string[] };
  categories: BackfillRow[]; products: BackfillRow[]; attributes: BackfillRow[];
  facetDefs: BackfillRow[]; facets: BackfillRow[]; values: BackfillRow[];
  types: BackfillRow[]; typeAttributes: BackfillRow[]; brands: BackfillRow[];
  models: BackfillRow[]; joins: BackfillRow[];
}
export interface BackfillIssue { code: string; id: string; key?: string }
export interface ProductChange { product_id: string; product_type_id?: string; review_compatibility: boolean }
export interface BackfillPlan {
  version: number; digest: string; schema: BackfillSnapshot['schema'];
  inserts: { product_types: BackfillRow[]; product_type_attributes: BackfillRow[]; device_brands: BackfillRow[]; device_models: BackfillRow[]; product_device_models: BackfillRow[] };
  updates: ProductChange[];
  conflicts: BackfillIssue[]; review: BackfillIssue[];
  unrelatedValues: { productId: string; attributeId: string; key: string; archived: boolean }[];
  counts: Record<string, { insert: number; update: number }>;
}

/** Output identifiers are untrusted DB data too. Never emit arbitrary text. */
export function safeBackfillId(value: unknown): string {
  const text = String(value ?? '');
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(text) ? text : '[redacted-id]';
}
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const ordered = <T>(rows: T[]): T[] => [...rows].sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
const normalizedName = (value: unknown) => String(value ?? '').trim().toLowerCase();
const live = (row: BackfillRow) => row.deleted_at == null;
const active = (row: BackfillRow) => live(row) && row.is_active === true;

/** Pure deterministic plan. Existing rows are never overwritten, revived,
 * archived, or deleted. PAVs are inspected/reported, NEVER modified. A conflict
 * blocks application of the entire plan, not just the conflicting operation.
 * The target identity is hashed, not printed; include host/port/db/login in it.
 */
export function planProductMetadataBackfill(snapshot: BackfillSnapshot, targetIdentity: string): BackfillPlan {
  const inserts: BackfillPlan['inserts'] = { product_types: [], product_type_attributes: [], device_brands: [], device_models: [], product_device_models: [] };
  const updates: ProductChange[] = [];
  const conflicts: BackfillIssue[] = [], review: BackfillIssue[] = [];
  const issue = (into: BackfillIssue[], code: string, id: unknown, key?: unknown) => into.push({ code, id: safeBackfillId(id), ...(key === undefined ? {} : { key: safeBackfillId(key) }) });
  const relevant = { ...snapshot, schema: { missing: [...snapshot.schema.missing].sort(), rlsDisabled: [...snapshot.schema.rlsDisabled].sort() } };
  for (const key of Object.keys(snapshot) as (keyof BackfillSnapshot)[]) {
    if (key !== 'schema') relevant[key] = ordered(snapshot[key]);
  }
  const desiredTypes = new Map<string, BackfillRow>();
  const applicable = new Map<string, Set<string>>();
  const reference = (existing: BackfillRow[], proposed: BackfillRow, table: keyof BackfillPlan['inserts'], nameScope?: string) => {
    const saved = existing.find(row => row.id === proposed.id);
    const nameCollision = proposed.name != null && existing.some(row => row.id !== proposed.id && normalizedName(row.name) === normalizedName(proposed.name) && (!nameScope || row[nameScope] === proposed[nameScope]));
    if (nameCollision || (saved && Object.entries(proposed).some(([key, value]) => saved[key] !== value))) {
      issue(conflicts, 'reference-conflict', proposed.id, table);
    } else if (!saved) inserts[table].push(proposed);
  };
  for (const [index, spec] of HISTORICAL_TYPES.entries()) {
    const category = snapshot.categories.find(row => row.slug === spec.category);
    if (!category || !active(category)) { issue(conflicts, 'category-missing-or-inactive', spec.category); continue; }
    const type = { id: spec.id, category_id: category.id, name: spec.name, requires_compatibility: spec.requires_compatibility, sort_order: index, is_active: true };
    desiredTypes.set(spec.id, type);
    applicable.set(spec.id, new Set());
    reference(snapshot.types, type, 'product_types', 'category_id');
    // This is an explicit allowlist intersected with that category's current
    // facet definitions. New/unrecognised facets are not silently imported.
    const defs = snapshot.facetDefs.filter(row => row.category_id === category.id && row.facet_key !== 'model');
    for (const def of ordered(defs)) {
      const key = String(def.facet_key);
      if (!(spec.keys as readonly string[]).includes(key)) { issue(review, 'unmapped-category-facet', category.id, key); continue; }
      const attribute = snapshot.attributes.find(row => row.key === key);
      if (!attribute || !active(attribute)) { issue(conflicts, 'attribute-missing-or-inactive', spec.id, key); continue; }
      applicable.get(spec.id)!.add(String(attribute.id));
      const mapping = { product_type_id: spec.id, attribute_id: attribute.id, is_required: false, sort_order: Number(def.sort_order ?? 0), show_in_specs: true, show_in_filters: true, show_in_search: false, is_active: true };
      const saved = snapshot.typeAttributes.find(row => row.product_type_id === spec.id && row.attribute_id === attribute.id);
      if (saved && Object.entries(mapping).some(([k, value]) => saved[k] !== value)) issue(conflicts, 'type-attribute-conflict', spec.id, attribute.id);
      else if (!saved) inserts.product_type_attributes.push(mapping);
    }
    for (const key of spec.keys) if (!defs.some(row => row.facet_key === key)) issue(conflicts, 'category-facet-missing', spec.id, key);
    for (const mapping of snapshot.typeAttributes.filter(row => row.product_type_id === spec.id)) {
      if (!applicable.get(spec.id)!.has(String(mapping.attribute_id))) issue(conflicts, 'unexpected-type-attribute', spec.id, mapping.attribute_id);
    }
  }
  // Device references must be supplied by an owner, never invented by backfills.
  const ownerBrands = snapshot.brands.filter(row => normalizedName(row.name) === 'apple' && row.is_active === true);
  const ownerModelIds = new Map<string, string>();
  for (const [, name] of HISTORICAL_MODELS) {
    const matches = snapshot.models.filter(row => normalizedName(row.name) === normalizedName(name) && row.is_active === true && ownerBrands.some(brand => brand.id === row.brand_id));
    if (matches.length === 1 && ownerBrands.length === 1) ownerModelIds.set(name, String(matches[0].id));
    else issue(conflicts, 'owner-device-reference-missing-or-ambiguous', name);
  }

  for (const known of HISTORICAL_PRODUCTS) {
    if (!snapshot.products.some(row => row.id === known.id && live(row))) issue(review, 'historical-product-missing-or-deleted', known.id);
  }
  const unrelatedValues: BackfillPlan['unrelatedValues'] = [];
  for (const product of ordered(snapshot.products)) {
    if (!live(product)) continue;
    const id = String(product.id);
    const known = HISTORICAL_PRODUCTS.find(row => row.id === id);
    const type = known ? desiredTypes.get(known.type) : undefined;
    const attributeIds = known ? applicable.get(known.type) : undefined;
    for (const value of snapshot.values.filter(row => row.product_id === id)) {
      if (!attributeIds?.has(String(value.attribute_id))) {
        const attribute = snapshot.attributes.find(row => row.id === value.attribute_id);
        unrelatedValues.push({ productId: safeBackfillId(id), attributeId: safeBackfillId(value.attribute_id), key: safeBackfillId(attribute?.key), archived: value.archived_at != null });
      }
    }
    const explicit = snapshot.facets.filter(row => row.product_id === id && row.facet_key === 'model').map(row => row.facet_value);
    // A legacy single-valued model PAV is also explicit evidence. Keep it as
    // history; it is not a source for importing unrecognised device models.
    for (const value of snapshot.values.filter(row => row.product_id === id && row.archived_at == null)) {
      if (snapshot.attributes.some(row => row.id === value.attribute_id && row.key === 'model')) {
        explicit.push(value.option_value ?? value.value_text ?? value.value_number ?? value.value_bool);
      }
    }
    if (!known) {
      if (product.product_type_id == null) issue(review, 'unknown-product-needs-type', id);
      if (explicit.length) issue(review, 'unknown-explicit-model', id, 'model');
      continue;
    }
    const before = conflicts.length;
    if (!type || product.category_id !== type.category_id) issue(conflicts, 'product-category-conflict', id);
    if (product.product_type_id != null && product.product_type_id !== known.type) issue(conflicts, 'product-type-conflict', id);
    const hasUnknownModel = explicit.some(value => !(known.models as readonly unknown[]).includes(value));
    if (hasUnknownModel) {
      issue(review, 'unknown-explicit-model', id, 'model');
      issue(conflicts, 'product-model-conflict', id, 'model');
    }
    const joins = snapshot.joins.filter(row => row.product_id === id);
    const expected = known.models.flatMap(name => ownerModelIds.has(name) ? [ownerModelIds.get(name)!] : []);
    if (expected.length !== known.models.length) { issue(conflicts, 'owner-device-reference-required', id); continue; }
    // Deliberate reviewed-empty selections are sacrosanct. Otherwise an
    // unexpected or archived join is a conflict, never an upsert/revival.
    if (product.compatibility_reviewed_at == null && joins.some(row => row.archived_at != null || !expected.includes(row.device_model_id as typeof expected[number]))) issue(conflicts, 'existing-join-conflict', id);
    if (conflicts.length !== before) continue;
    const change: ProductChange = { product_id: id, review_compatibility: false };
    if (product.product_type_id == null) change.product_type_id = known.type;
    if (product.compatibility_reviewed_at == null && expected.length) {
      for (const [index, modelId] of expected.entries()) if (!joins.some(row => row.device_model_id === modelId)) inserts.product_device_models.push({ product_id: id, device_model_id: modelId, sort_order: index });
      change.review_compatibility = true;
    }
    if (change.product_type_id || change.review_compatibility) updates.push(change);
  }
  for (const key of Object.keys(inserts) as (keyof typeof inserts)[]) inserts[key] = ordered(inserts[key]);
  const counts: BackfillPlan['counts'] = Object.fromEntries(Object.entries(inserts).map(([table, rows]) => [table, { insert: rows.length, update: 0 }]));
  counts.products = { insert: 0, update: updates.length };
  counts.product_attribute_values = { insert: 0, update: 0 };
  counts.product_attribute_history = { insert: 0, update: 0 };
  counts.store_admin_audit = { insert: Object.values(inserts).some(rows => rows.length) || updates.length ? 1 : 0, update: 0 };
  const content = { version: 1, schema: relevant.schema, inserts, updates: ordered(updates), conflicts: ordered(conflicts), review: ordered(review), unrelatedValues: ordered(unrelatedValues), counts };
  // Hash full relevant state (including PAV values) WITHOUT ever reporting it.
  // Schema installation changes this digest: obtain a new approval afterwards.
  const digest = createHash('sha256').update(canonical({ targetIdentity, snapshot: relevant, plan: content })).digest('hex');
  return { ...content, digest };
}

export function assertBackfillApproval(plan: BackfillPlan, approvedDigest: string): void {
  if (!/^[a-f0-9]{64}$/.test(approvedDigest) || approvedDigest !== plan.digest) throw new Error('Backfill approval mismatch or snapshot drift. Run a fresh dry-run and obtain approval.');
  if (plan.schema.missing.length || plan.schema.rlsDisabled.length) throw new Error('Migration 0051 schema/RLS is not ready. Apply schema separately, then obtain a fresh dry-run approval.');
  if (plan.conflicts.length) throw new Error('Backfill conflicts require review; no changes are permitted.');
}

/** Serializable starter suggestions and deterministic planning only. Safe for client imports.
 * This is reference setup, not a classifier: no product or compatibility assignments. */
export interface CatalogStarterAttributeSuggestion { key: string; label: string; dataType: 'text' | 'number' }
export interface CatalogStarterTemplate {
  id: string; name: string; categorySlug: string; requiresCompatibility: boolean;
  attributes: readonly CatalogStarterAttributeSuggestion[];
}
const material = { key: 'material', label: 'Material', dataType: 'text' } as const;
const connector = { key: 'connector', label: 'Connector', dataType: 'text' } as const;
const accessoryType = { key: 'type', label: 'Accessory type', dataType: 'text' } as const;
export const CATALOG_STARTER_TEMPLATES: readonly CatalogStarterTemplate[] = [
  { id: 'type_cases_protection_case', name: 'Protective Case', categorySlug: 'cases-protection', requiresCompatibility: true, attributes: [material] },
  { id: 'type_mobile_case', name: 'Mobile Case', categorySlug: 'mobile-cases', requiresCompatibility: true, attributes: [material] },
  { id: 'type_airpods_case', name: 'AirPods Case', categorySlug: 'airpods-case', requiresCompatibility: true, attributes: [material] },
  { id: 'type_power_adapter', name: 'Power Adapter', categorySlug: 'power-adapter-cable', requiresCompatibility: false, attributes: [{ key: 'wattage', label: 'Wattage', dataType: 'number' }, connector] },
  { id: 'type_wired_earphones', name: 'Wired Earphones', categorySlug: 'wired-earphones', requiresCompatibility: false, attributes: [connector, { key: 'driver', label: 'Driver', dataType: 'text' }] },
  { id: 'type_cable_organizer', name: 'Cable Organizer', categorySlug: 'cable-plug-case', requiresCompatibility: false, attributes: [accessoryType, material] },
  { id: 'type_charger_shell', name: 'Charger Case', categorySlug: 'cable-plug-case', requiresCompatibility: false, attributes: [accessoryType, material] },
];
export interface CatalogStarterSelection { templateId: string; categoryId?: string }
export type CatalogStarterStatus = 'create' | 'reuse' | 'conflict' | 'missing';
export interface CatalogStarterRow {
  templateId: string; kind: 'category' | 'type' | 'attribute' | 'mapping';
  id: string | null; label: string; status: CatalogStarterStatus; message: string;
  categoryId?: string; dataType?: string; unitId?: string | null; options?: string[];
}
export interface CatalogStarterSummary {
  create: number; reuse: number; conflict: number; missing: number;
  types: number; attributes: number; mappings: number;
}
export interface CatalogStarterPreview {
  selections: CatalogStarterSelection[]; rows: CatalogStarterRow[]; summary: CatalogStarterSummary;
  schema: { missing: string[]; rlsDisabled: string[] }; canApply: boolean; fingerprint: string;
}
export type StarterRecord = Record<string, unknown>;
export interface CatalogStarterSnapshot {
  schema: CatalogStarterPreview['schema']; categories: StarterRecord[]; types: StarterRecord[];
  attributes: StarterRecord[]; mappings: StarterRecord[]; units: StarterRecord[]; options: StarterRecord[];
}
export interface CatalogStarterInserts {
  types: StarterRecord[]; attributes: StarterRecord[]; mappings: StarterRecord[];
}
export interface CatalogStarterPlan {
  preview: Omit<CatalogStarterPreview, 'fingerprint'>; inserts: CatalogStarterInserts;
}
export class CatalogStarterError extends Error {
  constructor(message: string, public readonly status: 400 | 409 | 503 = 400) { super(message); this.name = 'CatalogStarterError'; }
}
const record = (value: unknown): value is StarterRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const normal = (value: unknown) => String(value ?? '').trim().toLowerCase();
const active = (row: StarterRecord) => row.is_active === true && row.deleted_at == null && row.archived_at == null;

/** Strict, bounded, canonical intent. Unknown keys never silently change the plan. */
export function parseCatalogStarterSelections(value: unknown): CatalogStarterSelection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) throw new CatalogStarterError('Choose between one and seven starter groups.');
  const seen = new Set<string>();
  const selections = value.map(item => {
    if (!record(item) || Object.keys(item).some(key => !['templateId', 'categoryId'].includes(key)) ||
      typeof item.templateId !== 'string' || !CATALOG_STARTER_TEMPLATES.some(t => t.id === item.templateId) ||
      (item.categoryId !== undefined && !stableId(item.categoryId))) throw new CatalogStarterError('Send a valid starter group and optional category ID.');
    if (seen.has(item.templateId)) throw new CatalogStarterError('Choose each starter group only once.');
    seen.add(item.templateId);
    return { templateId: item.templateId, ...(item.categoryId === undefined ? {} : { categoryId: item.categoryId as string }) };
  });
  return selections.sort((a, b) => compare(a.templateId, b.templateId));
}
export function parseCatalogStarterRequest(value: unknown, apply = false): { selections: CatalogStarterSelection[]; fingerprint?: string } {
  if (!record(value) || Object.keys(value).some(key => !['selections', ...(apply ? ['fingerprint'] : [])].includes(key))) throw new CatalogStarterError('Send a starter setup object.');
  const selections = parseCatalogStarterSelections(value.selections);
  if (apply && (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint))) throw new CatalogStarterError('A fresh preview fingerprint is required.');
  return { selections, ...(apply ? { fingerprint: value.fingerprint as string } : {}) };
}
/** Canonical object encoding; the server supplies hashing, never this client module. */
export function catalogStarterCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(catalogStarterCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${catalogStarterCanonical(item)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function planCatalogStarterSetup(snapshot: CatalogStarterSnapshot, input: CatalogStarterSelection[]): CatalogStarterPlan {
  const selections = parseCatalogStarterSelections(input);
  const rows: CatalogStarterRow[] = [];
  const inserts: CatalogStarterInserts = { types: [], attributes: [], mappings: [] };
  const attributeResults = new Map<string, Omit<CatalogStarterRow, 'templateId' | 'kind'>>();
  const unitCompatible = (unit: StarterRecord) => normal(unit.code) === 'w' && Number(unit.factor) === 1 &&
    (unit.base_code == null || normal(unit.base_code) === 'w') && unit.deleted_at == null && unit.is_active !== false;
  for (const selection of selections) {
    const template = CATALOG_STARTER_TEMPLATES.find(t => t.id === selection.templateId)!;
    const categoryCandidates = snapshot.categories.filter(c => selection.categoryId ? c.id === selection.categoryId : c.slug === template.categorySlug && active(c));
    const category = categoryCandidates.length === 1 ? categoryCandidates[0] : undefined;
    if (!category || !active(category)) {
      rows.push({ templateId: template.id, kind: 'category', id: selection.categoryId ?? null, label: template.categorySlug,
        status: categoryCandidates.length > 1 ? 'conflict' : 'missing', message: 'Select an existing active category; setup never creates or reactivates categories.' });
      continue;
    }
    const categoryId = String(category.id);
    rows.push({ templateId: template.id, kind: 'category', id: categoryId, categoryId, label: String(category.name ?? template.categorySlug), status: 'reuse', message: 'Use this active category.' });
    const savedById = snapshot.types.find(t => t.id === template.id);
    const byName = snapshot.types.filter(t => t.category_id === categoryId && normal(t.name) === normal(template.name));
    const savedType = savedById ?? (byName.length === 1 ? byName[0] : undefined);
    const typeConflict = byName.length > 1 || (savedById && byName.some(t => t.id !== savedById.id)) ||
      (savedType && (!active(savedType) || savedType.category_id !== categoryId || normal(savedType.name) !== normal(template.name) || savedType.requires_compatibility !== template.requiresCompatibility));
    const typeId = String(savedType?.id ?? template.id);
    const typeStatus: CatalogStarterStatus = typeConflict ? 'conflict' : savedType ? 'reuse' : 'create';
    rows.push({ templateId: template.id, kind: 'type', id: typeId, categoryId, label: template.name, status: typeStatus,
      message: typeConflict ? 'An existing type conflicts with this suggestion; it will not be overwritten or reactivated.' : savedType ? 'Retain the existing compatible type and its settings.' : 'Create an active product type; no products are assigned.' });
    if (typeStatus === 'create') inserts.types.push({ id: typeId, category_id: categoryId, name: template.name, requires_compatibility: template.requiresCompatibility, sort_order: CATALOG_STARTER_TEMPLATES.indexOf(template), is_active: true });
    for (const [index, suggestion] of template.attributes.entries()) {
      let result = attributeResults.get(suggestion.key);
      if (!result) {
        const desiredId = `attr_${suggestion.key}`;
        const candidates = snapshot.attributes.filter(a => a.key === suggestion.key);
        const attribute = candidates.length === 1 ? candidates[0] : undefined;
        const idCollision = !attribute && snapshot.attributes.some(a => a.id === desiredId);
        const options = attribute ? snapshot.options.filter(o => o.attribute_id === attribute.id).map(o => String(o.value)).sort(compare) : [];
        const unit = attribute?.unit_id == null ? undefined : snapshot.units.find(u => u.id === attribute.unit_id);
        const compatible = attribute && active(attribute) && (suggestion.dataType === 'text'
          ? (attribute.data_type === 'text' || attribute.data_type === 'enum' && options.length > 0) && attribute.unit_id == null
          : attribute.data_type === 'number' && (attribute.unit_id == null || unit !== undefined && unitCompatible(unit)));
        const wattUnits = snapshot.units.filter(unitCompatible).sort((a, b) => compare(String(a.id), String(b.id)));
        const conflict = candidates.length > 1 || idCollision || attribute !== undefined && !compatible || !attribute && suggestion.key === 'wattage' && wattUnits.length > 1;
        const unitId = attribute ? (attribute.unit_id == null ? null : String(attribute.unit_id)) : suggestion.key === 'wattage' && wattUnits.length === 1 ? String(wattUnits[0].id) : null;
        result = { id: String(attribute?.id ?? desiredId), label: attribute ? String(attribute.label) : suggestion.label,
          status: conflict ? 'conflict' : attribute ? 'reuse' : 'create', dataType: String(attribute?.data_type ?? suggestion.dataType), unitId, options,
          message: conflict ? 'The saved definition, unit, or stable ID is incompatible; no overwrite or reactivation is allowed.' : attribute ? 'Retain this active definition, unit, and all existing options.' : 'Create a reusable detail definition without values or options.' };
        if (suggestion.key === 'wattage' && unitId !== null && result.status !== 'conflict') {
          const selectedUnit = snapshot.units.find(u => u.id === unitId);
          result.message += ` Unit: ${String(selectedUnit?.label ?? selectedUnit?.code ?? unitId)} (${String(selectedUnit?.code ?? unitId)}).`;
        }
        attributeResults.set(suggestion.key, result);
        if (result.status === 'create') inserts.attributes.push({ id: result.id, key: suggestion.key, label: suggestion.label, data_type: suggestion.dataType, unit_id: unitId, is_filterable: false, is_variant_option: false, sort_order: ['material', 'wattage', 'connector', 'driver', 'type'].indexOf(suggestion.key), is_active: true });
      }
      rows.push({ templateId: template.id, kind: 'attribute', categoryId, ...result });
      const attributeId = result.id!;
      const saved = snapshot.mappings.find(m => m.product_type_id === typeId && m.attribute_id === attributeId);
      const dependencyConflict = typeStatus === 'conflict' || result.status === 'conflict';
      const status: CatalogStarterStatus = dependencyConflict || saved && !active(saved) ? 'conflict' : saved ? 'reuse' : 'create';
      rows.push({ templateId: template.id, kind: 'mapping', id: `${typeId}:${attributeId}`, categoryId, label: `${template.name} / ${result.label}`, status,
        message: dependencyConflict ? 'Resolve the type or detail conflict before setup.' : saved && !active(saved) ? 'An inactive mapping is retained, not reactivated.' : saved ? 'Retain all existing mapping settings, including required and display flags.' : 'Add an optional detail: specifications on; filters and search off.' });
      if (status === 'create') inserts.mappings.push({ product_type_id: typeId, attribute_id: attributeId, is_required: false, sort_order: index, show_in_specs: true, show_in_filters: false, show_in_search: false, is_active: true });
    }
  }
  for (const key of ['types', 'attributes', 'mappings'] as const) inserts[key].sort((a, b) => compare(catalogStarterCanonical(a), catalogStarterCanonical(b)));
  const summary: CatalogStarterSummary = { create: 0, reuse: 0, conflict: 0, missing: 0, types: inserts.types.length, attributes: inserts.attributes.length, mappings: inserts.mappings.length };
  for (const row of rows) summary[row.status]++;
  const schema = { missing: [...snapshot.schema.missing].sort(compare), rlsDisabled: [...snapshot.schema.rlsDisabled].sort(compare) };
  return { preview: { selections, rows, summary, schema, canApply: !summary.conflict && !summary.missing && !schema.missing.length && !schema.rlsDisabled.length }, inserts };
}

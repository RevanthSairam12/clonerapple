import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import {
  CatalogStarterError, catalogStarterCanonical, parseCatalogStarterSelections, planCatalogStarterSetup,
  type CatalogStarterSnapshot, type CatalogStarterSelection, type CatalogStarterPreview, type StarterRecord,
} from '@/lib/catalog/catalog-starter-rules';
import { metadataGate, metadataReferencesUsing, productMetadataUsing, strictMetadataAudit } from './product-metadata';
export { CatalogStarterError } from '@/lib/catalog/catalog-starter-rules';

if (typeof window !== 'undefined') throw new Error('Catalogue starter setup is server-only.');

// Schema inspection is read-only. Missing migrations are never installed here.
const REQUIRED: Record<string, readonly string[]> = {
  categories: ['id', 'slug', 'name', 'is_active', 'deleted_at'],
  product_types: ['id', 'category_id', 'name', 'requires_compatibility', 'sort_order', 'is_active'],
  attributes: ['id', 'key', 'label', 'data_type', 'unit_id', 'is_active', 'deleted_at', 'sort_order', 'is_filterable', 'is_variant_option'],
  product_type_attributes: ['product_type_id', 'attribute_id', 'is_required', 'sort_order', 'show_in_specs', 'show_in_filters', 'show_in_search', 'is_active'],
  units: ['id', 'code', 'label', 'dimension', 'base_code', 'factor'],
  attribute_options: ['attribute_id', 'value', 'sort_order'],
  products: ['id', 'category_id', 'product_type_id', 'is_active', 'deleted_at', 'compatibility_reviewed_at', 'inventory_mode'],
  product_attribute_values: ['product_id', 'attribute_id', 'value_text', 'value_number', 'value_bool', 'option_value', 'archived_at'],
  product_variants: ['id', 'product_id', 'device_model_id', 'is_active', 'is_purchasable', 'retired_at'],
  device_brands: ['id', 'name', 'sort_order', 'is_active'],
  device_models: ['id', 'brand_id', 'name', 'sort_order', 'is_active'],
  product_device_models: ['product_id', 'device_model_id', 'sort_order', 'archived_at'],
  store_admin_audit: ['actor_id', 'action', 'entity', 'entity_id', 'before', 'after'],
};
async function schemaUsing(tx: TransactionSql): Promise<CatalogStarterSnapshot['schema']> {
  const columns = await tx`select table_name,column_name from information_schema.columns where table_schema=current_schema() and table_name in ${tx(Object.keys(REQUIRED))}`;
  const missing: string[] = [];
  for (const [table, names] of Object.entries(REQUIRED)) for (const name of names) if (!columns.some(c => c.table_name === table && c.column_name === name)) missing.push(`${table}.${name}`);
  const security = await tx`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=current_schema() and c.relname in ${tx(Object.keys(REQUIRED))}`;
  const rlsDisabled = security.filter(row => !row.relrowsecurity).map(row => String(row.relname));
  const constraints = await tx`select c.conname from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname=current_schema() and t.relname='products' and c.conname='products_type_category_fk' and c.convalidated`;
  if (!constraints.length) missing.push('products.products_type_category_fk');
  const triggers = await tx`select g.tgname from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname=current_schema() and ((t.relname='product_attribute_values' and g.tgname='retain_product_attribute_value') or (t.relname='store_admin_audit' and g.tgname='store_admin_audit_immutable')) and g.tgenabled in ('O','A')`;
  for (const [table, trigger] of [['product_attribute_values', 'retain_product_attribute_value'], ['store_admin_audit', 'store_admin_audit_immutable']]) if (!triggers.some(t => t.tgname === trigger)) missing.push(`${table}.${trigger}`);
  return { missing, rlsDisabled };
}
export async function catalogStarterSnapshotUsing(tx: TransactionSql): Promise<CatalogStarterSnapshot> {
  const schema = await schemaUsing(tx);
  if (schema.missing.length || schema.rlsDisabled.length) return { schema, categories: [], types: [], attributes: [], mappings: [], units: [], options: [] };
  // Deliberately no active/deleted filters: archived conflicts must remain visible.
  const categories = [...await tx`select id,slug,name,is_active,deleted_at from categories order by id`];
  const types = [...await tx`select id,category_id,name,requires_compatibility,sort_order,is_active from product_types order by id`];
  const attributes = [...await tx`select id,key,label,data_type,unit_id,is_active,deleted_at,sort_order,is_filterable,is_variant_option from attributes order by id`];
  const mappings = [...await tx`select product_type_id,attribute_id,is_required,sort_order,show_in_specs,show_in_filters,show_in_search,is_active from product_type_attributes order by product_type_id,attribute_id`];
  const units = [...await tx`select id,code,label,dimension,base_code,factor from units order by id`];
  const options = [...await tx`select attribute_id,value,sort_order from attribute_options order by attribute_id,value`];
  return { schema, categories, types, attributes, mappings, units, options };
}
async function planUsing(tx: TransactionSql, selections: CatalogStarterSelection[]) {
  const snapshot = await catalogStarterSnapshotUsing(tx);
  const plan = planCatalogStarterSetup(snapshot, selections);
  const [target] = await tx`select current_database() as database,current_schema() as schema,current_user as role`;
  const fingerprint = createHash('sha256').update(catalogStarterCanonical({ version: 1, target, snapshot, plan })).digest('hex');
  const preview: CatalogStarterPreview = { ...plan.preview, fingerprint };
  return { ...plan, preview };
}
export async function previewCatalogStarterSetup(input: CatalogStarterSelection[]): Promise<CatalogStarterPreview> {
  const selections = parseCatalogStarterSelections(input);
  const sql = getSql();
  if (!sql) throw new CatalogStarterError('The catalogue database is unavailable.', 503);
  return sql.begin('isolation level repeatable read read only', async tx => (await planUsing(tx, selections)).preview);
}
const INSERT_COLUMNS = {
  types: ['id', 'category_id', 'name', 'requires_compatibility', 'sort_order', 'is_active'],
  attributes: ['id', 'key', 'label', 'data_type', 'unit_id', 'is_filterable', 'is_variant_option', 'sort_order', 'is_active'],
  mappings: ['product_type_id', 'attribute_id', 'is_required', 'sort_order', 'show_in_specs', 'show_in_filters', 'show_in_search', 'is_active'],
};
export interface CatalogStarterApplyResult {
  preview: CatalogStarterPreview; applied: { types: number; attributes: number; mappings: number }; noop: boolean;
}
export async function applyCatalogStarterSetup(input: CatalogStarterSelection[], fingerprint: string, staffId: string, request?: Request): Promise<CatalogStarterApplyResult> {
  const selections = parseCatalogStarterSelections(input);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new CatalogStarterError('A fresh preview fingerprint is required.');
  const sql = getSql();
  if (!sql) throw new CatalogStarterError('The catalogue database is unavailable.', 503);
  try {
    return await sql.begin('isolation level read committed read write', async tx => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '15s'`;
      await metadataGate(tx);
      const schema = await schemaUsing(tx);
      if (schema.missing.length || schema.rlsDisabled.length) throw new CatalogStarterError('Catalogue metadata schema is not ready. Apply its migrations separately before setup.', 503);
      // These locks also cover writers that do not participate in metadataGate.
      // Acquired before the READ COMMITTED reload; no concurrent dependency edit
      // can slip between planning, publication validation, and audited commit.
      // Keep product/value/variant/device locks: publication helpers issue several
      // READ COMMITTED queries, so reference-only locks would allow a non-gated
      // writer to change the checked dependencies mid-validation. This briefly
      // blocks catalogue/checkout writes; lock waits are capped at five seconds.
      await tx`lock table categories,product_types,attributes,product_type_attributes,units,attribute_options,products,product_attribute_values,product_variants,device_brands,device_models,product_device_models in share row exclusive mode`;
      const [actor] = await tx`select id from store_admins where id=${staffId} and is_active and role='store_owner' for share`;
      if (!actor) throw new CatalogStarterError('An active store owner is required to apply setup.', 409);
      const plan = await planUsing(tx, selections);
      // Always reject stale approval, including already-applied plans. A newly
      // previewed equivalent intent may safely apply as a no-op instead.
      if (plan.preview.fingerprint !== fingerprint) throw new CatalogStarterError('The catalogue changed. Generate a fresh preview before applying.', 409);
      if (!plan.preview.canApply) throw new CatalogStarterError('Resolve the missing categories or reference conflicts before applying setup.', 409);
      const applied = { types: plan.inserts.types.length, attributes: plan.inserts.attributes.length, mappings: plan.inserts.mappings.length };
      const noop = Object.values(applied).every(count => count === 0);
      if (noop) return { preview: plan.preview, applied, noop };
      // INSERT ONLY: unique violations roll back rather than overwriting a race.
      const insert = async (table: 'product_types' | 'attributes' | 'product_type_attributes', records: StarterRecord[], columns: string[]) => {
        if (records.length) await tx`insert into ${tx(table)} ${tx(records, ...columns)}`;
      };
      await insert('product_types', plan.inserts.types, INSERT_COLUMNS.types);
      await insert('attributes', plan.inserts.attributes, INSERT_COLUMNS.attributes);
      await insert('product_type_attributes', plan.inserts.mappings, INSERT_COLUMNS.mappings);
      const invalidVariants = await tx`select v.id from product_variants v join products p on p.id=v.product_id left join device_models dm on dm.id=v.device_model_id left join device_brands db on db.id=dm.brand_id where v.is_purchasable and v.is_active and p.deleted_at is null and (v.retired_at is not null or (v.device_model_id is not null and (dm.id is null or db.id is null or not exists(select 1 from product_device_models pm where pm.product_id=v.product_id and pm.device_model_id=v.device_model_id and pm.archived_at is null) or (p.inventory_mode<>'variant' and (not coalesce(dm.is_active,false) or not coalesce(db.is_active,false)))))) limit 1`;
      if (invalidVariants.length) throw new CatalogStarterError('Published catalogue dependencies require review; setup was rolled back.', 409);
      const refs = await metadataReferencesUsing(tx);
      const products = await tx`select id from products where deleted_at is null and is_active and product_type_id is not null order by id`;
      for (const product of products) {
        const state = await productMetadataUsing(tx, String(product.id), refs);
        if (state.problems.length) throw new CatalogStarterError('Published product metadata requires review; setup was rolled back.', 409);
      }
      await strictMetadataAudit(tx, { actorId: staffId, action: 'catalog.starter.setup', entity: 'catalog',
        after: { templateIds: selections.map(s => s.templateId), counts: applied, fingerprint }, request });
      return { preview: plan.preview, applied, noop };
    });
  } catch (error) {
    if (error instanceof CatalogStarterError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (['23505', '23503', '40001', '40P01', '55P03', '57014'].includes(String(code))) throw new CatalogStarterError('The catalogue changed or is busy. Generate a fresh preview and retry.', 409);
    // Never surface driver, connection, audit, or database exception messages.
    throw new CatalogStarterError('Could not apply starter setup. No changes were committed.', 503);
  }
}

/** Enforce the actual streamed byte count too, not only a spoofable Content-Length. */
export async function readCatalogStarterBody(request: Request): Promise<unknown> {
  const limit = 8192;
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new CatalogStarterError('The setup request is too large.');
  if (!request.body) throw new CatalogStarterError('Send a setup request body.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new CatalogStarterError('The setup request is too large.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof CatalogStarterError) throw error;
    throw new CatalogStarterError('Send valid JSON for starter setup.');
  } finally { reader.releaseLock(); }
}

import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { writeAudit, type AuditInput } from './audit';
import { validateAttributeValue } from './catalog-rules';
import {
  MetadataError, parseMetadataInput, publicationProblems, validateScopedValue,
  type AttributePrimitive, type DeviceBrand, type DeviceModel, type MetadataInput, type MetadataReferences,
} from '@/lib/catalog/product-metadata-rules';
export { MetadataError, parseMetadataInput } from '@/lib/catalog/product-metadata-rules';
type Client = NonNullable<ReturnType<typeof getSql>> | TransactionSql;
type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '');
const n = (v: unknown) => Number(v ?? 0);

export async function metadataReferencesUsing(sql: Client): Promise<MetadataReferences> {
  // A consistent lock order is shared by reference edits and product mutations.
  const types = await sql`select * from product_types order by id`;
  const mappings = await sql`select m.*,a.key,a.label,a.data_type from product_type_attributes m join attributes a on a.id=m.attribute_id where m.is_active and a.is_active and a.deleted_at is null and a.key <> 'model' order by m.sort_order,a.key`;
  const options = await sql`select attribute_id,value from attribute_options order by sort_order,value`;
  const brands = await sql`select * from device_brands order by sort_order,name`;
  const models = await sql`select d.*,b.name as brand_name,b.is_active as brand_active from device_models d join device_brands b on b.id=d.brand_id order by b.sort_order,b.name,d.sort_order,d.name`;
  return {
    types: types.map(row => ({ id:s(row.id),categoryId:s(row.category_id),name:s(row.name),requiresCompatibility:Boolean(row.requires_compatibility),isActive:Boolean(row.is_active),sortOrder:n(row.sort_order),attributes:mappings.filter(m=>m.product_type_id===row.id).map(m=>({attributeId:s(m.attribute_id),key:s(m.key),label:s(m.label),dataType:s(m.data_type),options:options.filter(o=>o.attribute_id===m.attribute_id).map(o=>s(o.value)),isRequired:Boolean(m.is_required),sortOrder:n(m.sort_order),showInSpecs:Boolean(m.show_in_specs),showInFilters:Boolean(m.show_in_filters),showInSearch:Boolean(m.show_in_search)})) })),
    brands: brands.map(row=>({id:s(row.id),name:s(row.name),isActive:Boolean(row.is_active),sortOrder:n(row.sort_order)})),
    models: models.map(row=>({id:s(row.id),brandId:s(row.brand_id),brandName:s(row.brand_name),name:s(row.name),isActive:Boolean(row.is_active)&&Boolean(row.brand_active),sortOrder:n(row.sort_order)})),
  };
}
export interface ManagementMapping {
  productTypeId: string; attributeId: string; label: string; isActive: boolean;
  attributeActive: boolean; isRequired: boolean; sortOrder: number;
  showInSpecs: boolean; showInFilters: boolean; showInSearch: boolean;
}
export interface MetadataManagement {
  references: MetadataReferences;
  mappings: ManagementMapping[];
  modelStatus: Array<{ id: string; modelActive: boolean; brandActive: boolean }>;
}
/** Management sees inactive records; product eligibility continues to use the active-only loader. */
export async function loadMetadataManagement(): Promise<MetadataManagement> {
  const sql = getSql();
  if (!sql) throw new MetadataError('Catalogue database is unavailable.');
  return sql.begin('isolation level repeatable read read only', async tx => {
    const references = await metadataReferencesUsing(tx);
    const mappings = await tx`select m.*,a.label,a.is_active as attribute_active,a.deleted_at from product_type_attributes m join attributes a on a.id=m.attribute_id order by m.sort_order,a.label`;
    const models = await tx`select d.id,d.is_active as model_active,b.is_active as brand_active from device_models d join device_brands b on b.id=d.brand_id`;
    return {
      references,
      mappings: mappings.map(row => ({ productTypeId:s(row.product_type_id),attributeId:s(row.attribute_id),label:s(row.label),isActive:Boolean(row.is_active),attributeActive:Boolean(row.attribute_active)&&row.deleted_at==null,isRequired:Boolean(row.is_required),sortOrder:n(row.sort_order),showInSpecs:Boolean(row.show_in_specs),showInFilters:Boolean(row.show_in_filters),showInSearch:Boolean(row.show_in_search) })),
      modelStatus: models.map(row => ({id:s(row.id),modelActive:Boolean(row.model_active),brandActive:Boolean(row.brand_active)})),
    };
  });
}

export async function metadataGate(tx: Client): Promise<void> { await tx`select pg_advisory_xact_lock(513031,3)`; }
export interface SavedAttribute { attributeId: string; key: string; label: string; value: AttributePrimitive; archived: boolean; applicable: boolean }
export interface ProductMetadataState {
  productTypeId: string | null; deviceModelIds: string[]; attributes: SavedAttribute[];
  reviewed: boolean; needsCompatibilityReview: boolean; problems: string[];
}
function primitive(row: Row): AttributePrimitive {
  if (row.value_bool !== null && row.value_bool !== undefined) return Boolean(row.value_bool);
  if (row.value_number !== null && row.value_number !== undefined) return Number(row.value_number);
  return row.option_value !== null && row.option_value !== undefined ? s(row.option_value) : row.value_text == null ? null : s(row.value_text);
}
export async function productMetadataUsing(sql: Client, productId: string, refs?: MetadataReferences): Promise<ProductMetadataState> {
  const references = refs ?? await metadataReferencesUsing(sql);
  const [product] = await sql`select category_id,product_type_id,compatibility_reviewed_at from products where id=${productId}`;
  if (!product) throw new MetadataError('Product not found.');
  const type = references.types.find(t=>t.id===product.product_type_id && t.categoryId===product.category_id && t.isActive);
  const rows = await sql`select v.*,a.key,a.label from product_attribute_values v join attributes a on a.id=v.attribute_id where v.product_id=${productId} order by a.sort_order,a.key`;
  const joins = await sql`select device_model_id from product_device_models where product_id=${productId} and archived_at is null order by sort_order,device_model_id`;
  const attributes: SavedAttribute[] = rows.map(row=>({attributeId:s(row.attribute_id),key:s(row.key),label:s(row.label),value:primitive(row),archived:row.archived_at!=null,applicable:Boolean(type?.attributes.some(a=>a.attributeId===row.attribute_id))}));
  const deviceModelIds = joins.map(row=>s(row.device_model_id));
  const values = Object.fromEntries(attributes.filter(a=>a.applicable&&!a.archived).map(a=>[a.attributeId,a.value]));
  const active = deviceModelIds.filter(id=>references.models.some(m=>m.id===id&&m.isActive));
  const productTypeId = product.product_type_id == null ? null : s(product.product_type_id);
  return {productTypeId,deviceModelIds,attributes,reviewed:product.compatibility_reviewed_at!=null,needsCompatibilityReview:(productTypeId !== null && !type) || Boolean(type?.requiresCompatibility && (product.compatibility_reviewed_at==null || active.length===0)) || active.length!==deviceModelIds.length,problems:publicationProblems(type,s(product.category_id),values,active,productTypeId)};
}
export async function strictMetadataAudit(tx: Client, input: AuditInput): Promise<void> {
  if (!await writeAudit(input,tx)) throw new MetadataError('The change was rolled back because its audit could not be saved.');
}
/** All callers use their existing transaction; no pool/cache/network side effects. */
export async function saveProductMetadataUsing(tx: Client, productId: string, input: MetadataInput, staffId: string, options: { enforcePublication?: boolean; request?: Request } = {}): Promise<void> {
  await metadataGate(tx);
  const [product] = await tx`select category_id,product_type_id,is_active from products where id=${productId} and deleted_at is null for update`;
  if (!product) throw new MetadataError('Product not found.');
  const refs = await metadataReferencesUsing(tx);
  const nextTypeId = input.productTypeId === undefined ? product.product_type_id : input.productTypeId;
  const type = refs.types.find(t=>t.id===nextTypeId&&t.categoryId===product.category_id&&t.isActive);
  const retainedInactiveType = nextTypeId === product.product_type_id && !product.is_active && Object.keys(input.attributeValues ?? {}).length === 0;
  if (nextTypeId && !type && !retainedInactiveType) throw new MetadataError('Select an active type belonging to this category.');
  if (input.productTypeId !== undefined) await tx`update products set product_type_id=${input.productTypeId},updated_at=now(),updated_by=${staffId} where id=${productId}`;
  if (input.deviceModelIds !== undefined) {
    for (const id of input.deviceModelIds) if (!refs.models.some(m=>m.id===id&&m.isActive)) {
      // Already saved inactive references can be retained for draft review.
      const existing = await tx`select 1 from product_device_models where product_id=${productId} and device_model_id=${id} and archived_at is null`;
      if (!existing.length) throw new MetadataError('A selected device model is unknown or inactive.');
    }
    const liveVariants=await tx`select device_model_id from product_variants where product_id=${productId} and is_active and is_purchasable and device_model_id is not null`;
    if(liveVariants.some(v=>!input.deviceModelIds!.includes(s(v.device_model_id)))) throw new MetadataError('Cannot remove compatibility used by an active purchasable variant. Archive the combination first.');
    await tx`update product_device_models set archived_at=now(),updated_at=now() where product_id=${productId} and archived_at is null`;
    for (const [index,id] of input.deviceModelIds.entries()) await tx`insert into product_device_models(product_id,device_model_id,sort_order) values(${productId},${id},${index}) on conflict(product_id,device_model_id) do update set archived_at=null,sort_order=excluded.sort_order,updated_at=now()`;
    await tx`update products set compatibility_reviewed_at=now(),updated_at=now(),updated_by=${staffId} where id=${productId}`;
  }
  for (const [id,value] of Object.entries(input.attributeValues ?? {})) {
    const attribute = type?.attributes.find(a=>a.attributeId===id);
    if (!attribute) throw new MetadataError('This attribute is not applicable to the selected product type.');
    if (value === null) {
      await tx`update product_attribute_values set archived_at=now(),updated_at=now() where product_id=${productId} and attribute_id=${id} and archived_at is null`;
    } else {
      validateScopedValue(attribute,value);
      const checked = validateAttributeValue(attribute.dataType as Parameters<typeof validateAttributeValue>[0],value);
      if (!checked.ok) throw new MetadataError(checked.error);
      const v=checked.value;
      await tx`insert into product_attribute_values(product_id,attribute_id,value_text,value_number,value_bool,option_value) values(${productId},${id},${v.value_text},${v.value_number},${v.value_bool},${v.option_value}) on conflict(product_id,attribute_id) do update set value_text=excluded.value_text,value_number=excluded.value_number,value_bool=excluded.value_bool,option_value=excluded.option_value,archived_at=null,updated_at=now()`;
    }
  }
  const changed = input.productTypeId !== undefined || input.deviceModelIds !== undefined || Object.keys(input.attributeValues ?? {}).length>0;
  if (product.is_active && (options.enforcePublication || changed)) {
    const state = await productMetadataUsing(tx,productId,refs);
    if (state.problems.length) throw new MetadataError(state.problems.join(' '));
  }
  if (changed) await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.product.metadata',entity:'product',entityId:productId,after:{productTypeId:nextTypeId,deviceModelIds:input.deviceModelIds,attributeIds:Object.keys(input.attributeValues??{})},request:options.request});
}
export async function loadMetadataEditor(productId?: string) {
  const sql=getSql();
  if (!sql) throw new MetadataError('Catalogue database is unavailable.');
  const references=await metadataReferencesUsing(sql);
  return { references, state:productId?await productMetadataUsing(sql,productId,references):null };
}
export async function updateProductMetadata(productId:string,input:MetadataInput,staffId:string,request?:Request, productPatch: {categoryId?:string; isActive?:boolean} = {}) {
  const sql=getSql(); if(!sql) throw new MetadataError('Catalogue database is unavailable.');
  await sql.begin(async tx=>{
    await metadataGate(tx);
    const [before]=await tx`select category_id,product_type_id,is_active from products where id=${productId} and deleted_at is null for update`;
    if(!before) throw new MetadataError('Product not found.');
    if(productPatch.categoryId!==undefined || productPatch.isActive!==undefined){
      const category=productPatch.categoryId??s(before.category_id);
      const type=input.productTypeId===undefined?before.product_type_id:input.productTypeId;
      const [exists]=await tx`select 1 from categories where id=${category} and deleted_at is null`;
      if(!exists) throw new MetadataError('Select a valid category.');
      if (type) {
        const retainingDraftType = !Boolean(productPatch.isActive ?? before.is_active)
          && category === before.category_id && type === before.product_type_id
          && Object.keys(input.attributeValues ?? {}).length === 0;
        const [valid] = await tx`select 1 from product_types where id=${s(type)} and category_id=${category} and (is_active or ${retainingDraftType})`;
        if (!valid) throw new MetadataError('Select an active type belonging to the new category.');
      }
      await tx`update products set category_id=${category},product_type_id=${type==null?null:s(type)},is_active=${productPatch.isActive??Boolean(before.is_active)},updated_at=now(),updated_by=${staffId} where id=${productId}`;
      await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.product.classification',entity:'product',entityId:productId,before:{categoryId:before.category_id,isActive:before.is_active},after:{categoryId:category,isActive:productPatch.isActive??before.is_active},request});
    }
    await saveProductMetadataUsing(tx,productId,input,staffId,{request,enforcePublication:productPatch.isActive===true || productPatch.categoryId!==undefined});
  });
}

export class MetadataConflictError extends MetadataError {}
function referenceConflict(error: unknown, kind: string): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    throw new MetadataConflictError(kind === 'brands' ? 'A device brand with this name already exists.' : kind === 'models' ? 'A device model with this name already exists for this brand.' : 'This metadata reference already exists.');
  }
  throw error;
}

/** Plain creation only: never accepts client IDs, mappings or product associations. */
export async function createMetadataReferenceUsing(tx: Client, kind: string, raw: unknown, staffId: string, request?: Request): Promise<DeviceBrand | DeviceModel> {
  if (kind !== 'brands' && kind !== 'models') throw new MetadataError('Only device brands and models can be created here.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MetadataError('Send a reference object.');
  const input = raw as Record<string, unknown>;
  const allowed = new Set(['name', 'sortOrder', 'isActive', ...(kind === 'models' ? ['brandId'] : [])]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new MetadataError('Only name, sortOrder, isActive and (for models) brandId are accepted.');
  const max = kind === 'brands' ? 100 : 120;
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > max || /[\u0000-\u001f\u007f]/.test(input.name)) throw new MetadataError(`Device ${kind === 'brands' ? 'brand' : 'model'} name is required (maximum ${max} characters).`);
  const name = input.name.trim();
  const sortOrder = input.sortOrder === undefined ? 0 : input.sortOrder;
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new MetadataError('Sort order must be 0–9999.');
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') throw new MetadataError('isActive must be true or false.');
  const isActive = input.isActive !== false;
  if (kind === 'models' && (typeof input.brandId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.brandId))) throw new MetadataError('Select an active device brand.');
  await metadataGate(tx);
  const id = randomUUID();
  let reference: DeviceBrand | DeviceModel;
  try {
    if (kind === 'brands') {
      await tx`insert into device_brands(id,name,is_active,sort_order) values(${id},${name},${isActive},${sortOrder})`;
      reference = { id, name, isActive, sortOrder };
    } else {
      const brandId = input.brandId as string;
      const [brand] = await tx`select name from device_brands where id=${brandId} and is_active for share`;
      if (!brand) throw new MetadataError('Select an active device brand.');
      await tx`insert into device_models(id,brand_id,name,is_active,sort_order) values(${id},${brandId},${name},${isActive},${sortOrder})`;
      reference = { id, brandId, brandName: s(brand.name), name, isActive, sortOrder };
    }
  } catch (error) { referenceConflict(error, kind); }
  await strictMetadataAudit(tx, { actorId: staffId, action: `catalog.metadata.${kind}.create`, entity: kind, entityId: id, after: { id, isActive, ...(kind === 'models' ? { brandId: input.brandId } : {}) }, request });
  return reference;
}
export async function createMetadataReference(kind: string, raw: unknown, staffId: string, request?: Request): Promise<DeviceBrand | DeviceModel> {
  const sql = getSql();
  if (!sql) throw new Error('Catalogue database is unavailable.');
  return sql.begin(tx => createMetadataReferenceUsing(tx, kind, raw, staffId, request));
}

/** Owner reference edits share the publication gate and roll back if they invalidate active classified products. */
export async function saveMetadataReference(kind:string, raw:Record<string,unknown>, staffId:string, request:Request):Promise<void> {
  const sql=getSql(); if(!sql) throw new MetadataError('Catalogue database is unavailable.');
  await sql.begin(tx => saveMetadataReferenceUsing(tx, kind, raw, staffId, request));
}
/** Injectable transaction helper; the caller owns commit/rollback. */
export async function saveMetadataReferenceUsing(tx: Client, kind:string, raw:Record<string,unknown>, staffId:string, request?:Request):Promise<void> {
  const id=s(raw.id); const name=s(raw.name).trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) throw new MetadataError('Use a stable ID containing letters, numbers, dashes or underscores.');
  const order=Number(raw.sortOrder??0);
  if(!Number.isInteger(order)||order<0||order>9999) throw new MetadataError('Sort order must be 0–9999.');
  for(const key of ['isActive','requiresCompatibility','isRequired','showInSpecs','showInFilters','showInSearch']) if(raw[key]!==undefined&&typeof raw[key]!=='boolean') throw new MetadataError(`${key} must be true or false.`);
  const active=raw.isActive!==false;
  await metadataGate(tx);
  try {
    if(kind==='types') {
      if(!name||name.length>120||!s(raw.categoryId)) throw new MetadataError('Type name and category are required.');
      const [existing]=await tx`select category_id from product_types where id=${id}`;
      if(existing&&existing.category_id!==raw.categoryId) throw new MetadataError('A saved type cannot move categories; create a new type.');
      await tx`insert into product_types(id,category_id,name,requires_compatibility,is_active,sort_order) values(${id},${s(raw.categoryId)},${name},${raw.requiresCompatibility===true},${active},${order}) on conflict(id) do update set name=excluded.name,requires_compatibility=excluded.requires_compatibility,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now()`;
    } else if(kind==='brands') {
      if(!name||name.length>100) throw new MetadataError('Brand name is required (maximum 100 characters).');
      await tx`insert into device_brands(id,name,is_active,sort_order) values(${id},${name},${active},${order}) on conflict(id) do update set name=excluded.name,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now()`;
    } else if(kind==='models') {
      if(!name||name.length>120||!s(raw.brandId)) throw new MetadataError('Model name and device brand are required.');
      const [existing]=await tx`select brand_id from device_models where id=${id}`;
      if(existing && existing.brand_id !== raw.brandId) throw new MetadataError('A saved device model cannot move brands; create a new model.');
      const [brand]=await tx`select is_active from device_brands where id=${s(raw.brandId)} for share`;
      if(!brand || (active && !brand.is_active)) throw new MetadataError('Select an active device brand for an active model.');
      await tx`insert into device_models(id,brand_id,name,is_active,sort_order) values(${id},${s(raw.brandId)},${name},${active},${order}) on conflict(id) do update set name=excluded.name,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now()`;
    } else if(kind==='attributes') {
      const typeId=s(raw.productTypeId); const attributeId=s(raw.attributeId);
      const [a]=await tx`select key from attributes where id=${attributeId} and is_active and deleted_at is null`;
      if(!a||a.key==='model') throw new MetadataError('Select an active non-model attribute; compatibility has its own picker.');
      await tx`insert into product_type_attributes(product_type_id,attribute_id,is_required,sort_order,show_in_specs,show_in_filters,show_in_search,is_active) values(${typeId},${attributeId},${raw.isRequired===true},${order},${raw.showInSpecs!==false},${raw.showInFilters===true},${raw.showInSearch===true},${active}) on conflict(product_type_id,attribute_id) do update set is_required=excluded.is_required,sort_order=excluded.sort_order,show_in_specs=excluded.show_in_specs,show_in_filters=excluded.show_in_filters,show_in_search=excluded.show_in_search,is_active=excluded.is_active,updated_at=now()`;
    } else throw new MetadataError('Unknown reference kind.');
  } catch (error) { referenceConflict(error, kind); }
    const invalidVariants=await tx`select v.id from product_variants v join products p on p.id=v.product_id left join device_models dm on dm.id=v.device_model_id left join device_brands db on db.id=dm.brand_id where v.is_purchasable and v.is_active and p.deleted_at is null and v.device_model_id is not null and (not coalesce(dm.is_active,false) or not coalesce(db.is_active,false)) limit 1`;
    if(invalidVariants.length) throw new MetadataError('Cannot deactivate a model or brand used by an active purchasable variant.');
    const refs=await metadataReferencesUsing(tx);
    const products=await tx`select id from products where deleted_at is null and is_active and product_type_id is not null order by id`;
    for(const p of products){const state=await productMetadataUsing(tx,s(p.id),refs);if(state.problems.length) throw new MetadataError(`This reference change would invalidate published product ${s(p.id)}. Save affected products as drafts or complete their metadata first.`);}
    await strictMetadataAudit(tx,{actorId:staffId,action:`catalog.metadata.${kind}.save`,entity:kind,entityId:id,after:{id,isActive:active},request});
}

import { randomBytes } from 'node:crypto';
import type { TransactionSql, Sql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { metadataGate, MetadataError, saveProductMetadataUsing, strictMetadataAudit } from './product-metadata';
import { checkPricePair, checkSalePrice } from './catalog-crud-rules';
import { adjustVariantInventoryUsing, activateVariantInventoryUsing } from './variant-inventory';
import { draftMoney, parseProductDraft, type ProductDraft } from './product-draft-rules';
import { writeProductContentUsing } from './product-content';
import { assertCatalogRevision, readCatalogRevision } from './catalog-revision';
import { saveVariantIdentityUsing } from './variant-identity';

const newId=(prefix:string)=>`${prefix}_${randomBytes(8).toString('hex')}`;
export class ProductDraftError extends Error {
  constructor(message:string,public status=400){super(message);}
}
/** Price-only helper deliberately has no description-schema gate. Caller owns rollback. */
export async function updateVariantPricingUsing(tx:TransactionSql,productId:string,variantId:string,patch:{pricePaise?:number|null;salePricePaise?:number|null},staffId:string,request?:Request){
  const [parent]=await tx`select price_paise,cost_paise from products where id=${productId} and deleted_at is null for update`;
  if(!parent)throw new ProductDraftError('Product not found.',404);
  const [variant]=await tx`select * from product_variants where id=${variantId} and product_id=${productId} for update`;
  if(!variant)throw new ProductDraftError('Option not found.',404);
  const oldPrice=variant.price_paise_override==null?null:Number(variant.price_paise_override),oldSale=variant.sale_price_paise==null?null:Number(variant.sale_price_paise);
  const price=patch.pricePaise===undefined?oldPrice:draftMoney(patch.pricePaise),sale=patch.salePricePaise===undefined?oldSale:draftMoney(patch.salePricePaise);
  const checked=checkSalePrice({salePaise:sale,regularPaise:price??Number(parent.price_paise),costPaise:parent.cost_paise==null?null:Number(parent.cost_paise)});
  if(checked.error)throw new ProductDraftError(checked.error);
  if(price!==oldPrice||sale!==oldSale){
    await tx`update product_variants set price_paise_override=${price},sale_price_paise=${sale} where id=${variantId} and product_id=${productId}`;
    for(const [before,after,kind] of [[oldPrice,price,'regular'],[oldSale,sale,'sale']] as const){
      if(before===after)continue;
      await tx`insert into price_history(product_id,variant_id,old_price_paise,new_price_paise,currency,reason,source,changed_by,price_kind) values(${productId},${variantId},${before},${after??(kind==='regular'?Number(parent.price_paise):0)},'INR',${after===null?`option_${kind}_cleared`:'option_price'},'store_admin',${staffId},${kind==='sale'&&after===null?'sale_cleared':kind})`;
    }
    await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.variant.price',entity:'product',entityId:productId,before:{variantId,pricePaise:oldPrice,salePricePaise:oldSale},after:{variantId,pricePaise:price,salePricePaise:sale},request});
  }
  return {warnings:checked.warning?[checked.warning]:[]};
}

export async function saveProductDraft(raw:unknown,staffId:string,request?:Request){
  let draft:ProductDraft;
  try { draft=parseProductDraft(raw); }
  catch(error) { throw new ProductDraftError(error instanceof Error?error.message:'Invalid product draft.'); }
  const sql=getSql();
  if(!sql)throw new ProductDraftError('Catalogue unavailable.',503);
  return saveProductDraftUsing(sql,draft,staffId,request);
}
/** Sole transaction boundary: any validation, history or audit failure aborts the whole draft. */
export async function saveProductDraftUsing(sql:Sql,draft:ProductDraft,staffId:string,request?:Request){
  return sql.begin(tx=>saveProductDraftInTransaction(tx,draft,staffId,request));
}
export async function saveProductDraftInTransaction(tx:TransactionSql,draft:ProductDraft,staffId:string,request?:Request){
  await metadataGate(tx);
  const p=draft.product.value,id=draft.id??p.id,created=!draft.id;
  const [before]=await tx`select * from products where id=${id} and deleted_at is null for update`;
  if(!created&&!before)throw new ProductDraftError('Product not found.',404);
  if(created&&before)throw new ProductDraftError('That product identity already exists.',409);
  if(draft.expectedRevision!==undefined){if(!before)throw new ProductDraftError('An edit revision cannot be supplied for a new product.');assertCatalogRevision(before as {catalog_revision:unknown},draft.expectedRevision);}
  const [category]=await tx`select id from categories where id=${p.categoryId} and deleted_at is null`;
  if(!category)throw new ProductDraftError('Select a valid category.');
  if(p.brandId){const [brand]=await tx`select id from brands where id=${p.brandId} and deleted_at is null`;if(!brand)throw new ProductDraftError('Select a valid brand.');}
  if(p.conditionId){const [condition]=await tx`select id from conditions where id=${p.conditionId} and is_active`;if(!condition)throw new ProductDraftError('Select an active condition.');}
  const sale=draft.salePricePaise===undefined?(before?.sale_price_paise==null?null:Number(before.sale_price_paise)):draft.salePricePaise;
  const pair=checkPricePair(p.pricePaise,p.compareAtPaise);if(pair)throw new ProductDraftError(pair);
  const saleCheck=checkSalePrice({salePaise:sale,regularPaise:p.pricePaise,costPaise:draft.costPaise===undefined?(before?.cost_paise==null?null:Number(before.cost_paise)):draft.costPaise});if(saleCheck.error)throw new ProductDraftError(saleCheck.error);
  // Insert as a draft first; publication is checked only after every staged field exists.
  if(created)await tx`insert into products(id,category_id,slug,name,price_paise,currency,is_active,updated_by) values(${id},${p.categoryId},${p.slug},${p.name},${p.pricePaise},'INR',false,${staffId})`;
  const effectiveType=draft.metadata.productTypeId===undefined?(before?.product_type_id??null):draft.metadata.productTypeId;
  if(effectiveType){const retainInactive=!p.isActive&&before?.product_type_id===effectiveType&&before?.category_id===p.categoryId;const [type]=await tx`select id from product_types where id=${effectiveType} and category_id=${p.categoryId} and (is_active or ${retainInactive})`;if(!type)throw new ProductDraftError('Select a product type belonging to the selected category, or clear the type.');}
  if(draft.shortDescription!==undefined||draft.descriptionSections!==undefined)await writeProductContentUsing(tx,id,{shortDescription:draft.shortDescription,descriptionSections:draft.descriptionSections},staffId,{source:'product_draft',request});
  await tx`update products set category_id=${p.categoryId},product_type_id=${effectiveType},slug=${p.slug},name=${p.name},subtitle=${p.subtitle},price_paise=${p.pricePaise},compare_at_paise=${p.compareAtPaise},sale_price_paise=${sale},brand=${p.brand},brand_id=${p.brandId},condition_id=${p.conditionId},material=${p.material},description=${p.description},badge=${p.badge||null},seo_title=${p.seoTitle},seo_description=${p.seoDescription},is_active=false,updated_at=now(),updated_by=${staffId} where id=${id}`;
  if(draft.costPaise!==undefined)await tx`update products set cost_paise=${draft.costPaise} where id=${id}`;
  if(draft.sortOrder!==undefined)await tx`update products set sort_order=${draft.sortOrder} where id=${id}`;
  if(draft.inStock!==undefined)await tx`update products set in_stock=${draft.inStock} where id=${id}`;
  for(const [old,value,kind] of [[before?.price_paise==null?null:Number(before.price_paise),p.pricePaise,'regular'],[before?.sale_price_paise==null?null:Number(before.sale_price_paise),sale,'sale']] as const){
    if(old===value)continue;
    await tx`insert into price_history(product_id,variant_id,old_price_paise,new_price_paise,currency,reason,source,changed_by,price_kind) values(${id},null,${old},${value??0},'INR','product_draft','store_admin',${staffId},${kind==='sale'&&value===null?'sale_cleared':kind})`;
  }
  // Archive combinations before changing compatibility, never delete commerce identities.
  for(const option of draft.options??[]){
    const archivedId=option.input.replacesVariantId??(!option.input.isActive?option.input.id:undefined);
    if(archivedId)await tx`update product_variants set is_active=false where id=${archivedId} and product_id=${id} and retired_at is null`;
  }
  await saveProductMetadataUsing(tx,id,draft.metadata,staffId,{request});
  if(draft.gallery!==undefined){
    const existing=await tx`select id from product_images where product_id=${id} and deleted_at is null for update`;
    for(const image of draft.gallery)if(image.id&&!existing.some(r=>r.id===image.id))throw new ProductDraftError('Image does not belong to this product.');
    await tx`update product_images set role='gallery',deleted_at=now() where product_id=${id} and deleted_at is null`;
    for(const image of draft.gallery){if(image.id)await tx`update product_images set url=${image.url},alt=${image.alt},role=${image.role},sort_order=${image.sort_order},is_active=coalesce(${image.isActive??null}::boolean,is_active),deleted_at=null where id=${image.id} and product_id=${id}`;else await tx`insert into product_images(id,product_id,url,alt,role,sort_order,is_active) values(${newId('img')},${id},${image.url},${image.alt},${image.role},${image.sort_order},${image.isActive??true})`;}
  }
  const optionIds:Record<string,string>={},warnings=saleCheck.warning?[saleCheck.warning]:[];
  // Sources are processed before replacements regardless of submitted order.
  for(const option of [...(draft.options??[])].sort((a,b)=>Number(Boolean(a.input.replacesVariantId))-Number(Boolean(b.input.replacesVariantId)))){
    const v=option.input,variantId=v.id??newId('var');
    const [old]=await tx`select * from product_variants where id=${variantId} and product_id=${id} for update`;
    if(v.id&&!old)throw new ProductDraftError('Option not found.',404);
    if((option.pricePaise!==undefined&&option.pricePaise!==(old?.price_paise_override==null?null:Number(old.price_paise_override)))||(option.salePricePaise!==undefined&&option.salePricePaise!==(old?.sale_price_paise==null?null:Number(old.sale_price_paise))))throw new ProductDraftError('Option price writes remain disabled until the authoritative checkout price gate is approved.',409);
    const saved=await saveVariantIdentityUsing(tx,id,v,staffId,request);
    if(!saved.before?.retired_at)warnings.push(...(await updateVariantPricingUsing(tx,id,saved.id,{pricePaise:option.pricePaise,salePricePaise:option.salePricePaise},staffId,request)).warnings);
    if(option.clientKey)optionIds[option.clientKey]=saved.id;
    if(option.stock){if(saved.before?.retired_at)throw new ProductDraftError('Retired options cannot receive stock adjustments.');await adjustVariantInventoryUsing(tx,{...option.stock,productId:id,variantId:saved.id},staffId,request);}
  }
  // A parent price change must not invalidate retained option sale prices.
  const retained=await tx`select price_paise_override,sale_price_paise from product_variants where product_id=${id} and is_active and sale_price_paise is not null`;
  for(const row of retained){const checked=checkSalePrice({salePaise:Number(row.sale_price_paise),regularPaise:row.price_paise_override==null?p.pricePaise:Number(row.price_paise_override),costPaise:null});if(checked.error)throw new ProductDraftError(checked.error);}
  if(draft.stock)await adjustVariantInventoryUsing(tx,{...draft.stock,productId:id,variantId:null},staffId,request);
  else if(created)await adjustVariantInventoryUsing(tx,{productId:id,variantId:null,onHand:p.initialOnHand,trackInventory:p.trackInventory,confirmTracking:true,reason:'receipt',note:'Opening stock'},staffId,request);
  if(draft.activateVariantInventory)await activateVariantInventoryUsing(tx,id,{...draft.activateVariantInventory,allocations:draft.activateVariantInventory.allocations.map(r=>({...r,variantId:optionIds[r.variantId]??r.variantId}))},staffId,request);
  if(p.isActive){
    const invalid=await tx`select v.id from product_variants v left join product_device_models pm on pm.product_id=v.product_id and pm.device_model_id=v.device_model_id and pm.archived_at is null left join device_models dm on dm.id=v.device_model_id left join device_brands db on db.id=dm.brand_id where v.product_id=${id} and v.is_active and v.is_purchasable and (v.sku is null or v.combination_key is null or (v.device_model_id is not null and (pm.device_model_id is null or not coalesce(dm.is_active,false) or not coalesce(db.is_active,false)))) limit 1`;
    if(invalid.length)throw new ProductDraftError('An active purchasable option has an invalid SKU, combination key or compatible device. Review Price and options before publishing.');
  }
  await tx`update products set is_active=${p.isActive} where id=${id}`;
  await saveProductMetadataUsing(tx,id,{},staffId,{request,enforcePublication:true});
  await strictMetadataAudit(tx,{actorId:staffId,action:created?'catalog.product.draft.create':'catalog.product.draft.save',entity:'product',entityId:id,before:before?{pricePaise:before.price_paise,salePricePaise:before.sale_price_paise,isActive:before.is_active}:null,after:{pricePaise:p.pricePaise,salePricePaise:sale,isActive:p.isActive,galleryCount:draft.gallery?.length,optionCount:draft.options?.length},request});
  const [savedProduct]=await tx`select catalog_revision from products where id=${id}`;
  const catalogRevision=readCatalogRevision(savedProduct?.catalog_revision);
  return {ok:true as const,product:{id,slug:p.slug,name:p.name,created,catalogRevision},optionIds,warnings:[...new Set(warnings)]};
}

import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { MetadataError, metadataGate, strictMetadataAudit } from './product-metadata';

/**
 * Copies the product itself, its chosen models and colours, and its photos.
 *
 * A duplicate is always a draft with zero stock and no price history: it
 * copies prices as settings, never past changes, and never copies units,
 * reservations, orders or saved option identities. Every copied option gets a
 * new SKU and a new combination key, so the original stays immutable.
 */
export async function duplicateProductUsing(tx:TransactionSql,sourceId:string,input:{name:string;slug:string},staffId:string,request?:Request):Promise<string>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)||input.slug.length>80||!input.name.trim()||input.name.trim().length>140) throw new MetadataError('Enter a new lowercase slug and a product name (maximum 140 characters).');
  await metadataGate(tx);
  const [source]=await tx`select id,sell_by,sku_pattern from products where id=${sourceId} and deleted_at is null for update`;
  if(!source) throw new MetadataError('Product not found.');
  const [collision]=await tx`select 1 from products where id=${input.slug} or slug=${input.slug}`;
  if(collision) throw new MetadataError('That product ID or slug already exists.');
  await tx`insert into products(id,slug,name,category_id,product_type_id,subtitle,price_paise,compare_at_paise,sale_price_paise,currency,material,brand,brand_id,condition_id,description,short_description,description_sections,badge,highlights,in_the_box,seo_title,seo_description,sell_by,sku_pattern,in_stock,is_active,updated_by,compatibility_reviewed_at)
    select ${input.slug},${input.slug},${input.name.trim()},category_id,product_type_id,subtitle,price_paise,compare_at_paise,sale_price_paise,currency,material,brand,brand_id,condition_id,description,short_description,description_sections,badge,highlights,in_the_box,seo_title,seo_description,sell_by,sku_pattern,true,false,${staffId},case when compatibility_reviewed_at is not null then now() else null end from products where id=${sourceId}`;
  await tx`insert into product_attribute_values(product_id,attribute_id,value_text,value_number,value_bool,option_value,archived_at) select ${input.slug},attribute_id,value_text,value_number,value_bool,option_value,archived_at from product_attribute_values where product_id=${sourceId}`;
  await tx`insert into product_device_models(product_id,device_model_id,sort_order,archived_at) select ${input.slug},device_model_id,sort_order,archived_at from product_device_models where product_id=${sourceId}`;
  // Colour photos and the default gallery travel with the copy. Archived
  // photos and unsold (retired) options do not.
  await tx`insert into product_images(id,product_id,url,alt,role,sort_order,colour_id,is_active)
    select 'img_'||substr(md5(${input.slug}||i.id),1,24),${input.slug},i.url,i.alt,i.role,i.sort_order,i.colour_id,i.is_active
    from product_images i where i.product_id=${sourceId} and i.deleted_at is null`;
  // New identity for every option: deterministic ids let the immutable colour
  // links below point at the copies without a second lookup.
  await tx`insert into product_variants(id,product_id,sku,option_name,option_value,option_hex,is_purchasable,device_model_id,combination_key,option_identity,price_paise_override,sale_price_paise,is_active,sort_order)
    select 'var_'||substr(md5(${input.slug}||v.id),1,24),${input.slug},
           left(coalesce(nullif(btrim(v.sku),''),'OPT'),40)||'-'||substr(md5(${input.slug}||v.id),1,6),
           v.option_name,v.option_value,v.option_hex,v.is_purchasable,v.device_model_id,
           'dup_'||substr(md5(${input.slug}||v.id),1,20),v.option_identity,
           v.price_paise_override,v.sale_price_paise,v.is_active,v.sort_order
    from product_variants v where v.product_id=${sourceId} and v.retired_at is null`;
  await tx`insert into product_variant_colours(variant_id,product_id,colour_id)
    select 'var_'||substr(md5(${input.slug}||vc.variant_id),1,24),${input.slug},vc.colour_id
    from product_variant_colours vc join product_variants v on v.id=vc.variant_id and v.product_id=vc.product_id
    where vc.product_id=${sourceId} and v.retired_at is null`;
  await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.product.duplicate',entity:'product',entityId:input.slug,after:{sourceId,draft:true,stockCopied:false,priceHistoryCopied:false},request});
  return input.slug;
}
export async function duplicateProduct(sourceId:string,input:{name:string;slug:string},staffId:string,request?:Request):Promise<string>{
  const sql=getSql();if(!sql)throw new MetadataError('Catalogue database is unavailable.');
  return sql.begin(tx=>duplicateProductUsing(tx,sourceId,input,staffId,request));
}

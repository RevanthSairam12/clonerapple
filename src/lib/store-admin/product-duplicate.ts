import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { MetadataError, metadataGate, strictMetadataAudit } from './product-metadata';

/** Copies catalogue metadata only; always draft, never stock or reservations. */
export async function duplicateProductUsing(tx:TransactionSql,sourceId:string,input:{name:string;slug:string},staffId:string,request?:Request):Promise<string>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)||input.slug.length>80||!input.name.trim()||input.name.trim().length>140) throw new MetadataError('Enter a new lowercase slug and a product name (maximum 140 characters).');
  await metadataGate(tx);
  const [source]=await tx`select id from products where id=${sourceId} and deleted_at is null for update`;
  if(!source) throw new MetadataError('Product not found.');
  const [collision]=await tx`select 1 from products where id=${input.slug} or slug=${input.slug}`;
  if(collision) throw new MetadataError('That product ID or slug already exists.');
  await tx`insert into products(id,slug,name,category_id,product_type_id,subtitle,price_paise,compare_at_paise,sale_price_paise,currency,material,brand,brand_id,condition_id,description,short_description,description_sections,badge,highlights,in_the_box,seo_title,seo_description,in_stock,is_active,updated_by,compatibility_reviewed_at)
    select ${input.slug},${input.slug},${input.name.trim()},category_id,product_type_id,subtitle,price_paise,compare_at_paise,sale_price_paise,currency,material,brand,brand_id,condition_id,description,short_description,description_sections,badge,highlights,in_the_box,seo_title,seo_description,true,false,${staffId},case when compatibility_reviewed_at is not null then now() else null end from products where id=${sourceId}`;
  await tx`insert into product_attribute_values(product_id,attribute_id,value_text,value_number,value_bool,option_value,archived_at) select ${input.slug},attribute_id,value_text,value_number,value_bool,option_value,archived_at from product_attribute_values where product_id=${sourceId}`;
  await tx`insert into product_device_models(product_id,device_model_id,sort_order,archived_at) select ${input.slug},device_model_id,sort_order,archived_at from product_device_models where product_id=${sourceId}`;
  // Append the same opening-price history as ordinary creation. No new edit gate.
  await tx`insert into price_history(product_id,variant_id,old_price_paise,new_price_paise,currency,reason,source,changed_by) select ${input.slug},null,null,price_paise,currency,'product_duplicated','store_admin',${staffId} from products where id=${sourceId}`;
  await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.product.duplicate',entity:'product',entityId:input.slug,after:{sourceId,draft:true,stockCopied:false},request});
  return input.slug;
}
export async function duplicateProduct(sourceId:string,input:{name:string;slug:string},staffId:string,request?:Request):Promise<string>{
  const sql=getSql();if(!sql)throw new MetadataError('Catalogue database is unavailable.');
  return sql.begin(tx=>duplicateProductUsing(tx,sourceId,input,staffId,request));
}

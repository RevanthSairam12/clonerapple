import { randomBytes } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { VariantInput } from './catalog-crud-rules';
import { strictMetadataAudit } from './product-metadata';

export class VariantIdentityError extends Error {
  constructor(message:string, public status=409){super(message);}
}
type Row=Record<string,unknown>;
const nullable=(v:unknown)=>v==null?null:String(v);
export function resolvedVariantIdentity(input:VariantInput, old:Row|null){
  const purchasable=input.isPurchasable??Boolean(old?.is_purchasable);
  const model=input.deviceModelId===undefined?nullable(old?.device_model_id):input.deviceModelId;
  const key=input.combinationKey===undefined?nullable(old?.combination_key):input.combinationKey;
  const semantic=input.optionIdentity===undefined?nullable(old?.option_identity):input.optionIdentity;
  if(old?.retired_at && input.isActive)throw new VariantIdentityError('Retired options cannot be reactivated. Create a replacement instead.');
  if(old?.sku!=null&&input.sku!==old.sku)throw new VariantIdentityError('Saved SKUs are immutable. Create a replacement instead.');
  if(old?.is_purchasable&&(input.sku!==old.sku||model!==nullable(old.device_model_id)||key!==nullable(old.combination_key)||semantic!==nullable(old.option_identity)||input.optionName!==old.option_name||input.optionValue!==old.option_value||!purchasable))throw new VariantIdentityError('Commerce identity is immutable; create an explicit replacement.');
  if(purchasable&&(!input.sku||!key))throw new VariantIdentityError('Purchasable options require a SKU and stable combination key.',400);
  return {purchasable,model,key,semantic};
}
/** Caller holds metadata fence and parent FOR UPDATE; all errors must abort its transaction. */
export async function saveVariantIdentityUsing(tx:TransactionSql,productId:string,input:VariantInput,staffId:string,request?:Request){
  let v=input;
  let source:Row|null=null;
  if(v.replacesVariantId){
    if(v.id)throw new VariantIdentityError('A replacement must create a new identity.',400);
    const [row]=await tx`select * from product_variants where id=${v.replacesVariantId} and product_id=${productId} for update`;
    if(!row)throw new VariantIdentityError('Replacement source does not belong to this product.',404);
    if(row.retired_at)throw new VariantIdentityError('This option has already been retired.');
    source=row;
    // A replacement is always a fresh commerce identity. The source retains all stock/history.
    if(!v.sku||v.sku===row.sku)throw new VariantIdentityError('Supply a new SKU for the replacement.',400);
    v={...v,isPurchasable:true,combinationKey:`replacement_${randomBytes(16).toString('hex')}`};
  }
  const id=v.id??`var_${randomBytes(8).toString('hex')}`;
  const [persisted]=v.id?await tx`select * from product_variants where id=${id} and product_id=${productId} for update`:[];
  const old:Row|null=persisted??null;
  if(v.id&&!old)throw new VariantIdentityError('Option not found.',404);
  const {purchasable,model,key,semantic}=resolvedVariantIdentity(v,old);
  if(!old&&purchasable&&!semantic)throw new VariantIdentityError('New purchasable options require an explicit option identity.',400);
  if(old?.retired_at){
    if(v.sku!==nullable(old.sku)||v.optionName!==old.option_name||v.optionValue!==old.option_value||purchasable!==Boolean(old.is_purchasable)||model!==nullable(old.device_model_id)||key!==nullable(old.combination_key)||semantic!==nullable(old.option_identity)||v.optionHex!==nullable(old.option_hex)||v.sortOrder!==Number(old.sort_order))throw new VariantIdentityError('Retired options are read-only.');
    return {id,before:old,after:old,created:false,retired:false};
  }
  if(model&&(v.isActive||!old||source||model!==nullable(old.device_model_id)||(!old.is_purchasable&&purchasable))){
    // Only the owned, server-loaded live commerce identity may retain an
    // inactive reference. resolvedVariantIdentity already proved its identity
    // unchanged; neither an input ID nor a display-only/inactive option does.
    // A parent still in product inventory is a conversion, not retention.
    const retained = Boolean(!source && old && old.id === id && old.product_id === productId &&
      old.is_active === true && old.is_purchasable === true && !old.retired_at && purchasable &&
      model === nullable(old.device_model_id));
    const mapped=await tx`select 1 from product_device_models pm join device_models dm on dm.id=pm.device_model_id join device_brands db on db.id=dm.brand_id where pm.product_id=${productId} and pm.device_model_id=${model} and pm.archived_at is null and ((dm.is_active and db.is_active) or (${retained} and exists(select 1 from products p where p.id=pm.product_id and p.inventory_mode='variant')))`;
    if(!mapped.length)throw new VariantIdentityError('Select an active model from this product compatibility.',400);
  }
  if(source){
    await tx`update product_variants set is_active=false,retired_at=now() where id=${source.id as string} and product_id=${productId}`;
    await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.variant.retire',entity:'product',entityId:productId,before:{variantId:source.id},after:{variantId:source.id,replacementId:id},request});
  }
  const rows=old
    ?await tx`update product_variants set sku=${v.sku},option_name=${v.optionName},option_value=${v.optionValue},option_hex=${v.optionHex},is_purchasable=${purchasable},device_model_id=${model},combination_key=${key},option_identity=${semantic},is_active=${v.isActive},sort_order=${v.sortOrder} where id=${id} and product_id=${productId} returning *`
    :await tx`insert into product_variants(id,product_id,sku,option_name,option_value,option_hex,is_purchasable,device_model_id,combination_key,option_identity,is_active,sort_order) values(${id},${productId},${v.sku},${v.optionName},${v.optionValue},${v.optionHex},${purchasable},${model},${key},${semantic},${v.isActive},${v.sortOrder}) returning *`;
  if(source){
    await tx`insert into stock(id,product_id,variant_id,on_hand,reserved,track_inventory,low_stock_threshold,updated_by) values(${`stk_${randomBytes(8).toString('hex')}`},${productId},${id},0,0,true,0,${staffId})`;
    await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.stock.exact',entity:'product',entityId:productId,after:{variantId:id,onHand:0,reserved:0,trackInventory:true,source:'replacement'},request});
  }
  return {id,before:old,after:(rows[0]??{}) as Row,created:!old,retired:Boolean(source)};
}

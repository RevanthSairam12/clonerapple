import { randomBytes } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { metadataGate, strictMetadataAudit, MetadataError } from './product-metadata';
import { inventoryDelta, inventoryKey, validateAllocation, validateInventoryChange, type InventoryChange } from './variant-inventory-rules';
export { validateInventoryChange } from './variant-inventory-rules';

/**
 * Re-derive `products.in_stock` for a variant-mode product.
 *
 * The flag is a gate, not a count: it means "at least one option is buyable".
 * Variant mode has no product-level stock pool, so leaving the value product
 * mode wrote behind shows a stale yes/no in the admin list and exports. Call
 * this after anything that can change buyability — stock, option identity or
 * activation. It never runs for product-mode products, where the flag is the
 * real stock answer.
 */
export async function refreshVariantStockGate(tx: TransactionSql, productId: string, staffId: string) {
  await tx`update products set in_stock=exists(
      select 1 from stock s join product_variants v on v.id=s.variant_id and v.product_id=s.product_id
      where s.product_id=${productId} and v.is_active and v.is_purchasable and v.retired_at is null
        and (not s.track_inventory or s.on_hand-s.reserved>0)),updated_at=now(),updated_by=${staffId}
    where id=${productId} and inventory_mode='variant'
      and in_stock is distinct from exists(
        select 1 from stock s join product_variants v on v.id=s.variant_id and v.product_id=s.product_id
        where s.product_id=${productId} and v.is_active and v.is_purchasable and v.retired_at is null
          and (not s.track_inventory or s.on_hand-s.reserved>0))`;
}

/** Caller owns the transaction. Absolute-set deltas are derived only after the exact row lock. */
export async function adjustVariantInventoryUsing(tx: TransactionSql, raw: InventoryChange, staffId: string, request?: Request) {
  const input = validateInventoryChange(raw);
  const [product] = await tx`select id,name,inventory_mode from products where id=${input.productId} and deleted_at is null`;
  if (!product) throw new MetadataError('Product not found.');
  // The option's display label, for a per-option low-stock alert. A product-level
  // row has no option, so the alert names the product alone.
  let variantLabel: string | null = null;
  if (input.variantId) {
    const [variant] = await tx`select v.id,v.option_name,v.option_value from product_variants v where v.id=${input.variantId} and v.product_id=${input.productId} and v.is_purchasable and v.is_active and v.retired_at is null and (v.device_model_id is null or exists(select 1 from product_device_models pm join device_models dm on dm.id=pm.device_model_id join device_brands db on db.id=dm.brand_id where pm.product_id=v.product_id and pm.device_model_id=v.device_model_id and pm.archived_at is null and ((dm.is_active and db.is_active) or ${product.inventory_mode === 'variant'})))`;
    if (!variant) throw new MetadataError('Select an active purchasable variant with a valid model mapping.');
    const name = String(variant.option_name ?? '').trim(), value = String(variant.option_value ?? '').trim();
    variantLabel = name && value ? `${name}: ${value}` : value || name || null;
  }
  const [before] = await tx`select * from stock where product_id=${input.productId} and variant_id is not distinct from ${input.variantId}::text for update`;
  if (!before && (input.onHand === undefined || input.trackInventory === undefined)) throw new MetadataError('A new stock row needs an explicit count and tracking choice.');
  const tracking = input.trackInventory ?? Boolean(before?.track_inventory);
  if (tracking && !before?.track_inventory && !input.confirmTracking) throw new MetadataError('Explicitly confirm enabling tracking.');
  const onHand = Number(before?.on_hand ?? 0), reserved = Number(before?.reserved ?? 0);
  const delta = inventoryDelta(onHand,reserved,input);
  const threshold = input.lowStockThreshold ?? Number(before?.low_stock_threshold ?? 0);
  const id = String(before?.id ?? `stk_${randomBytes(8).toString('hex')}`);
  if (before) await tx`update stock set on_hand=${onHand+delta},track_inventory=${tracking},low_stock_threshold=${threshold},updated_at=now(),updated_by=${staffId} where id=${id}`;
  else await tx`insert into stock(id,product_id,variant_id,on_hand,reserved,track_inventory,low_stock_threshold,updated_by) values(${id},${input.productId},${input.variantId},${onHand+delta},0,${tracking},${threshold},${staffId})`;
  // The ledger row is the movement identity: a crossing notification is keyed on
  // it, so the same adjustment can never alert twice even if it is retried.
  let movementId = 0;
  if (delta !== 0) {
    const movement = await tx`insert into stock_movements(product_id,variant_id,delta,reason,note,created_by) values(${input.productId},${input.variantId},${delta},${input.reason},${input.note ?? ''},${staffId}) returning id`;
    movementId = Number(movement[0]?.id ?? 0);
  }
  if (!input.variantId && product.inventory_mode==='product') await tx`update products set in_stock=${!tracking||onHand+delta-reserved>0},updated_at=now(),updated_by=${staffId} where id=${input.productId} and inventory_mode='product'`;
  // Keep the gate honest after the count moves.
  if (product.inventory_mode==='variant') await refreshVariantStockGate(tx,input.productId,staffId);
  const after = {onHand:onHand+delta,reserved,trackInventory:tracking,lowStockThreshold:threshold,
    // Enough for the caller to raise a crossing alert: the option's own label,
    // the name it is sold under, and the movement that caused the change.
    variantId:input.variantId,variantLabel,productName:String(product.name ?? ''),movementId,
    availableBefore:onHand-reserved,availableAfter:onHand+delta-reserved,
    stockKnown:Boolean(before)};
  await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.stock.exact',entity:'product',entityId:input.productId,before:before?{variantId:input.variantId,onHand,reserved,trackInventory:before.track_inventory,lowStockThreshold:before.low_stock_threshold}:null,after:{variantId:input.variantId,onHand:onHand+delta,reserved,trackInventory:tracking,lowStockThreshold:threshold},reason:input.reason,request});
  return after;
}

export async function adjustVariantInventory(rawRows: unknown, staffId: string, request?: Request) {
  if (!Array.isArray(rawRows) || !rawRows.length || rawRows.length > 100) throw new MetadataError('Supply 1–100 inventory rows.');
  const rows = rawRows.map(validateInventoryChange).sort((a,b)=>inventoryKey(a.productId,a.variantId).localeCompare(inventoryKey(b.productId,b.variantId)));
  if (new Set(rows.map(r=>inventoryKey(r.productId,r.variantId))).size !== rows.length) throw new MetadataError('Duplicate stock identities are not allowed.');
  const sql=getSql(); if(!sql) throw new MetadataError('Catalogue unavailable.');
  return sql.begin(async tx=>{
    await metadataGate(tx);
    const results=[];
    for(const row of rows) results.push(await adjustVariantInventoryUsing(tx,row,staffId,request));
    return results;
  });
}

/** Explicit opt-in. Counts are never inferred, copied, or split automatically. */
export async function activateVariantInventory(productId: string, raw: unknown, staffId: string, request?: Request) {
  const sql=getSql(); if(!sql) throw new MetadataError('Catalogue unavailable.');
  return sql.begin(tx=>activateVariantInventoryUsing(tx,productId,raw,staffId,request));
}

/** Atomic draft saves share this exact activation guard and ledger. */
export async function activateVariantInventoryUsing(tx: TransactionSql, productId: string, raw: unknown, staffId: string, request?: Request) {
  const body=(raw ?? {}) as Record<string,unknown>;
  if (body.confirm !== true) throw new MetadataError('Explicitly confirm variant inventory activation.');
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length>200) throw new MetadataError('An activation reason is required (maximum 200 characters).');
  const allocations=validateAllocation(body.allocations ?? []);
  await metadataGate(tx);
    const [product]=await tx`select id,inventory_mode,product_type_id from products where id=${productId} and deleted_at is null for update`;
    if(!product) throw new MetadataError('Product not found.');
    if(product.inventory_mode==='variant') {
      if(allocations.some(r=>r.quantity>0)) throw new MetadataError('Already activated; allocation cannot be repeated.');
      return {alreadyActive:true};
    }
    const holds=await tx`select o.id from orders o where o.reservation_state='ACTIVE' and (exists(select 1 from order_items oi where oi.order_id=o.id and oi.product_id=${productId} and oi.variant_id is null) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.items::jsonb)='array' then o.items::jsonb else '[]'::jsonb end) i where i->>'id'=${productId} and nullif(i->>'variantId','') is null)) order by o.id for update of o`;
    if(holds.length) throw new MetadataError('Legacy active holds must settle or expire before activation.');
    const outstanding=await tx`select order_id from stock_movements where product_id=${productId} and variant_id is null and order_id is not null group by order_id having coalesce(sum(case when reason='sale' then -delta when reason in ('return','release') then -delta else 0 end),0)>0`;
    if(outstanding.length) throw new MetadataError('Legacy sale obligations remain; review and settle them before activation.');
    const variants=await tx`select v.*,pt.requires_compatibility from product_variants v left join product_types pt on pt.id=${product.product_type_id == null ? null : String(product.product_type_id)} where v.product_id=${productId} and v.is_active and v.is_purchasable order by v.id for update of v`;
    if(!variants.length) throw new MetadataError('Configure at least one active purchasable combination first.');
    const [parent]=await tx`select * from stock where product_id=${productId} and variant_id is null for update`;
    if(Number(parent?.reserved ?? 0)>0) throw new MetadataError('Legacy reserved units must be resolved first.');
    for(const v of variants){
      if(!v.sku || !v.combination_key || (v.requires_compatibility && !v.device_model_id)) throw new MetadataError('Every sellable combination requires a unique SKU, combination key and any required model mapping.');
      if(v.device_model_id){
        const [mapping]=await tx`select 1 from product_device_models pm join device_models dm on dm.id=pm.device_model_id join device_brands db on db.id=dm.brand_id where pm.product_id=${productId} and pm.device_model_id=${String(v.device_model_id)} and pm.archived_at is null and dm.is_active and db.is_active`;
        if(!mapping) throw new MetadataError('A variant model is not in the active product compatibility mapping.');
      }
      const [stock]=await tx`select id from stock where product_id=${productId} and variant_id=${String(v.id)} for update`;
      if(!stock) throw new MetadataError('Save explicit stock settings for every purchasable variant before activation.');
    }
    if(allocations.some(r=>!variants.some(v=>v.id===r.variantId))) throw new MetadataError('Allocation contains an unknown or inactive combination.');
    const transfer=allocations.reduce((s,r)=>s+r.quantity,0);
    if(transfer>Number(parent?.on_hand ?? 0)-Number(parent?.reserved ?? 0)) throw new MetadataError('Allocation exceeds the retained parent balance.');
    for(const row of [...allocations].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
      if(!row.quantity) continue;
      await tx`update stock set on_hand=on_hand-${row.quantity},updated_at=now(),updated_by=${staffId} where id=${String(parent.id)}`;
      await tx`update stock set on_hand=on_hand+${row.quantity},updated_at=now(),updated_by=${staffId} where product_id=${productId} and variant_id=${row.variantId}`;
      // Existing ledger reasons are retained: paired adjustments are a transfer, not a receipt.
      await tx`insert into stock_movements(product_id,variant_id,delta,reason,note,created_by) values(${productId},null,${-row.quantity},'adjustment',${`Allocate to ${row.variantId}: ${body.reason}`.slice(0,200)},${staffId}),(${productId},${row.variantId},${row.quantity},'adjustment',${`Allocate from legacy: ${body.reason}`.slice(0,200)},${staffId})`;
    }
    await tx`update products set inventory_mode='variant',updated_at=now(),updated_by=${staffId} where id=${productId}`;
    // Re-derive the gate from the option rows now that they are the only stock
    // pool. Leaving the legacy product-mode value here is what made an
    // activated product read as sold out while its options were buyable.
    await refreshVariantStockGate(tx,productId,staffId);
    await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.inventory.activate',entity:'product',entityId:productId,before:{inventoryMode:'product',parentOnHand:Number(parent?.on_hand ?? 0)},after:{inventoryMode:'variant',parentOnHand:Number(parent?.on_hand ?? 0)-transfer,allocations},reason:String(body.reason),request});
    return {alreadyActive:false};
}

import type postgres from 'postgres';
import { outstandingClaimQuantity, restoreableQuantity, stockKey, type StockClaimPlan, type StockIdentity, type StockRowSnapshot } from '@/lib/checkout/stock-rules';

if (typeof window !== 'undefined') throw new Error('Stock claims must run on the server only.');
type Tx = postgres.TransactionSql;
export class InsufficientStockError extends Error {
  readonly code = 'insufficient_stock';
  constructor(message: string) { super(message); this.name = 'InsufficientStockError'; }
}

/** Lock ONLY requested identities, in a deterministic order. Missing rows remain missing. */
export async function lockStockIdentities(tx: Tx, lines: readonly StockIdentity[]): Promise<StockRowSnapshot[]> {
  const wanted = [...new Map(lines.map(line => [stockKey(line), line])).values()]
    .sort((a,b) => stockKey(a).localeCompare(stockKey(b)));
  const rows: StockRowSnapshot[] = [];
  for (const line of wanted) {
    rows.push(...await tx<StockRowSnapshot[]>`
      select product_id, variant_id, on_hand, reserved, track_inventory from stock
      where product_id=${line.productId} and variant_id is not distinct from ${line.variantId || null}::text
      for update
    `);
  }
  return rows;
}
/** Compatibility entry point for historical product-only callers. */
export async function lockStockRows(tx: Tx, productIds: readonly string[]): Promise<StockRowSnapshot[]> {
  return lockStockIdentities(tx, productIds.filter(Boolean).map(productId => ({productId})));
}

export async function claimPlannedStock(tx: Tx, orderId: string, claims: readonly StockClaimPlan[]): Promise<void> {
  for (const claim of [...claims].sort((a,b) => stockKey(a).localeCompare(stockKey(b)))) {
    const updated = await tx`
      update stock set on_hand=on_hand-${claim.quantity}, updated_at=now()
      where product_id=${claim.productId} and variant_id is not distinct from ${claim.variantId || null}::text
        and track_inventory and on_hand - reserved >= ${claim.quantity}
      returning product_id
    `;
    if (!updated.length) throw new InsufficientStockError(`Out of stock: ${claim.productName || 'This variant'}. Please review your bag.`);
    await tx`insert into stock_movements(product_id,variant_id,delta,reason,order_id)
      values(${claim.productId},${claim.variantId || null},${-claim.quantity},'sale',${orderId})`;
  }
}

/** Order locking serializes ledger reads even when the stock row is absent/untracked. */
async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx`select id from orders where id=${orderId} for update`;
}
export async function releaseClaimedStock(tx: Tx, orderId: string): Promise<boolean> {
  await lockOrder(tx, orderId);
  const identities = await tx<Array<{product_id:string;variant_id:string|null}>>`
    select distinct product_id,variant_id from stock_movements where order_id=${orderId} and reason='sale'
    order by product_id,variant_id nulls first`;
  await lockStockIdentities(tx, identities.map(row => ({productId:row.product_id,variantId:row.variant_id})));
  let released=false;
  for (const line of identities) {
    const [balance] = await tx`
      select coalesce(sum(case when reason='sale' then -delta else 0 end),0)::int as claimed,
        coalesce(sum(case when reason in ('release','return') then delta else 0 end),0)::int as released
      from stock_movements where order_id=${orderId} and product_id=${line.product_id}
        and variant_id is not distinct from ${line.variant_id}::text`;
    const quantity=outstandingClaimQuantity(balance?.claimed ?? 0,balance?.released ?? 0);
    if (!quantity) continue;
    const rows=await tx`update stock set on_hand=on_hand+${quantity},updated_at=now()
      where product_id=${line.product_id} and variant_id is not distinct from ${line.variant_id}::text returning id`;
    if (!rows.length) continue;
    await tx`insert into stock_movements(product_id,variant_id,delta,reason,order_id)
      values(${line.product_id},${line.variant_id},${quantity},'release',${orderId})`;
    released=true;
  }
  return released;
}

export interface SoldStockLine extends StockIdentity { quantity:number }
function aggregate(lines:readonly SoldStockLine[]): SoldStockLine[] {
  const wanted=new Map<string,SoldStockLine>();
  for (const line of lines) {
    if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity<=0) continue;
    const key=stockKey(line), old=wanted.get(key);
    wanted.set(key,{productId:line.productId,...(line.variantId ? {variantId:line.variantId}:{}),quantity:(old?.quantity || 0)+line.quantity});
  }
  return [...wanted.values()].sort((a,b)=>stockKey(a).localeCompare(stockKey(b)));
}
export async function restoreSoldStock(tx:Tx,orderId:string,lines:readonly SoldStockLine[],options:{createdBy?:string|null}={}):Promise<SoldStockLine[]> {
  await lockOrder(tx,orderId);
  const wanted=aggregate(lines);
  const rows=await lockStockIdentities(tx,wanted);
  const byKey=new Map(rows.map(row=>[stockKey({productId:row.product_id,variantId:row.variant_id}),row]));
  const restored:SoldStockLine[]=[];
  for (const line of wanted) {
    const [balance]=await tx`
      select coalesce(sum(case when reason='sale' then -delta else 0 end),0)::int as claimed,
        coalesce(sum(case when reason in ('return', 'release') then delta else 0 end),0)::int as restored
      from stock_movements where order_id=${orderId} and product_id=${line.productId}
        and variant_id is not distinct from ${line.variantId || null}::text`;
    const quantity=restoreableQuantity(line.quantity,balance?.claimed ?? 0,balance?.restored ?? 0);
    if (!quantity) continue;
    if (byKey.get(stockKey(line))?.track_inventory) {
      await tx`update stock set on_hand=on_hand+${quantity},updated_at=now(),updated_by=${options.createdBy ?? null}
        where product_id=${line.productId} and variant_id is not distinct from ${line.variantId || null}::text`;
    }
    await tx`insert into stock_movements(product_id,variant_id,delta,reason,order_id,created_by)
      values(${line.productId},${line.variantId || null},${quantity},'return',${orderId},${options.createdBy ?? null})`;
    restored.push({...line,quantity});
  }
  return restored;
}
export interface ReleasedClaimLine extends SoldStockLine {}
export async function releasedClaimLines(tx:Tx,orderId:string):Promise<ReleasedClaimLine[]> {
  const rows=await tx<Array<{product_id:string;variant_id:string|null;quantity:number}>>`
    select product_id,variant_id,sum(delta)::int as quantity from stock_movements
    where order_id=${orderId} and reason='release' group by product_id,variant_id
    having sum(delta)>0 order by product_id,variant_id nulls first`;
  return rows.map(row=>({productId:row.product_id,...(row.variant_id?{variantId:row.variant_id}:{}),quantity:Number(row.quantity)}));
}
export type ReclaimResult={ok:true;lines:ReleasedClaimLine[]}|{ok:false;reason:'stock-unavailable';lines:ReleasedClaimLine[]};
export async function reclaimReleasedStock(tx:Tx,orderId:string,lines:readonly ReleasedClaimLine[]):Promise<ReclaimResult> {
  await lockOrder(tx,orderId);
  const wanted=aggregate(lines), rows=await lockStockIdentities(tx,wanted);
  const byKey=new Map(rows.map(row=>[stockKey({productId:row.product_id,variantId:row.variant_id}),row]));
  for(const line of wanted){
    const row=byKey.get(stockKey(line));
    if(!row || Number(row.on_hand)-Number(row.reserved)<line.quantity) return {ok:false,reason:'stock-unavailable',lines:wanted};
  }
  for(const line of wanted){
    const updated=await tx`update stock set on_hand=on_hand-${line.quantity},updated_at=now()
      where product_id=${line.productId} and variant_id is not distinct from ${line.variantId || null}::text
        and on_hand-reserved>=${line.quantity} returning id`;
    if(!updated.length) throw new InsufficientStockError('Out of stock for late payment.');
    await tx`insert into stock_movements(product_id,variant_id,delta,reason,order_id)
      values(${line.productId},${line.variantId || null},${-line.quantity},'sale',${orderId})`;
  }
  return {ok:true,lines:wanted};
}

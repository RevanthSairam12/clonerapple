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
  if (wanted.length === 0) return [];
  if (wanted.length === 1) {
    const line = wanted[0];
    return await tx<StockRowSnapshot[]>`
      select product_id, variant_id, on_hand, reserved, track_inventory from stock
      where product_id=${line.productId} and variant_id is not distinct from ${line.variantId || null}::text
      for update
    `;
  }
  const records = wanted.map(line => ({ product_id: line.productId, variant_id: line.variantId || null }));
  return await tx<StockRowSnapshot[]>`
    select s.product_id, s.variant_id, s.on_hand, s.reserved, s.track_inventory
    from stock s
    where exists (
      select 1 from jsonb_to_recordset(${tx.json(records)}::jsonb) as w(product_id text, variant_id text)
      where s.product_id = w.product_id and s.variant_id is not distinct from w.variant_id
    )
    order by s.product_id asc, coalesce(s.variant_id, '') asc
    for update of s
  `;
}
/** Compatibility entry point for historical product-only callers. */
export async function lockStockRows(tx: Tx, productIds: readonly string[]): Promise<StockRowSnapshot[]> {
  return lockStockIdentities(tx, productIds.filter(Boolean).map(productId => ({productId})));
}

export interface ClaimStockResult {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  availableBefore: number;
  availableAfter: number;
  lowStockThreshold: number;
  movementId: string;
}

export async function claimPlannedStock(
  tx: Tx,
  orderId: string,
  claims: readonly StockClaimPlan[],
): Promise<ClaimStockResult[]> {
  const results: ClaimStockResult[] = [];
  for (const claim of [...claims].sort((a,b) => stockKey(a).localeCompare(stockKey(b)))) {
    const updated = await tx<Array<{
      product_id: string;
      variant_id: string | null;
      on_hand: number;
      reserved: number;
      low_stock_threshold: number;
      movement_id: string | number;
    }>>`
      with claimed as (
        update stock set on_hand=on_hand-${claim.quantity}, updated_at=now()
        where product_id=${claim.productId} and variant_id is not distinct from ${claim.variantId || null}::text
          and track_inventory and on_hand - reserved >= ${claim.quantity}
        returning product_id, variant_id, on_hand, reserved, low_stock_threshold
      ), movement as (
        insert into stock_movements(product_id,variant_id,delta,reason,order_id)
        select ${claim.productId},${claim.variantId || null},${-claim.quantity},'sale',${orderId}
        from claimed
        returning id
      )
      select c.product_id, c.variant_id, c.on_hand, c.reserved, c.low_stock_threshold, m.id as movement_id
      from claimed c cross join movement m
    `;
    if (!updated.length) throw new InsufficientStockError(`Out of stock: ${claim.productName || 'This variant'}. Please review your bag.`);
    const row = updated[0];
    const onHandAfter = Number(row.on_hand);
    const reserved = Number(row.reserved);
    const availableAfter = onHandAfter - reserved;
    const availableBefore = availableAfter + claim.quantity;
    const lowStockThreshold = Number(row.low_stock_threshold);
    results.push({
      productId: row.product_id,
      variantId: row.variant_id,
      productName: claim.productName || '',
      variantLabel: claim.variantLabel || null,
      availableBefore,
      availableAfter,
      lowStockThreshold,
      movementId: String(row.movement_id),
    });
  }
  return results;
}

/** Order locking serializes ledger reads even when the stock row is absent/untracked. */
async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx`select id from orders where id=${orderId} for update`;
}
export async function releaseClaimedStock(
  tx: Tx,
  orderId: string,
  options: { alreadyLocked?: boolean; orderAlreadyLocked?: boolean } = {},
): Promise<boolean> {
  if (!options.alreadyLocked && !options.orderAlreadyLocked) await lockOrder(tx, orderId);
  const balances = await tx<Array<{product_id:string;variant_id:string|null;claimed:number;released:number}>>`
    select product_id, variant_id,
      coalesce(sum(case when reason='sale' then -delta else 0 end),0)::int as claimed,
      coalesce(sum(case when reason in ('release','return') then delta else 0 end),0)::int as released
    from stock_movements where order_id=${orderId}
    group by product_id, variant_id
    having coalesce(sum(case when reason='sale' then -delta else 0 end),0) > 0
    order by product_id, variant_id nulls first`;
  if (!balances.length) return false;
  if (!options.alreadyLocked) {
    await lockStockIdentities(tx, balances.map(row => ({productId:row.product_id,variantId:row.variant_id})));
  }
  let released=false;
  for (const line of balances) {
    const quantity=outstandingClaimQuantity(line.claimed ?? 0,line.released ?? 0);
    if (!quantity) continue;
    const rows=await tx`
      with restored as (
        update stock set on_hand=on_hand+${quantity},updated_at=now()
        where product_id=${line.product_id} and variant_id is not distinct from ${line.variant_id}::text
        returning id
      ), movement as (
        insert into stock_movements(product_id,variant_id,delta,reason,order_id)
        select ${line.product_id},${line.variant_id},${quantity},'release',${orderId}
        from restored
      )
      select id from restored`;
    if (!rows.length) continue;
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

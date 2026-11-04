import { isManualStockReason, type ManualStockReason } from './catalog-crud-rules';

export interface InventoryChange {
  productId: string;
  variantId: string | null;
  onHand?: number;
  delta?: number;
  trackInventory?: boolean;
  lowStockThreshold?: number;
  confirmTracking?: boolean;
  reason: ManualStockReason;
  note?: string;
}
export const inventoryKey = (productId: string, variantId?: string | null) => JSON.stringify([productId, variantId || null]);
export function validateInventoryChange(raw: unknown): InventoryChange {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Send an inventory row.');
  const r = raw as Record<string, unknown>;
  const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value);
  if (!id(r.productId) || (r.variantId != null && !id(r.variantId))) throw new Error('Invalid inventory identity.');
  if (!isManualStockReason(r.reason)) throw new Error('Choose receipt, adjustment or damage as the reason.');
  if (r.onHand !== undefined && r.delta !== undefined) throw new Error('Choose an absolute count or a delta, not both.');
  for (const key of ['onHand', 'delta', 'lowStockThreshold']) {
    if (r[key] !== undefined && (typeof r[key] !== 'number' || !Number.isSafeInteger(r[key]) || Number(r[key]) < (key === 'delta' ? -1_000_000 : 0) || Number(r[key]) > 1_000_000)) throw new Error(`Invalid ${key}: use a whole number within the inventory limit.`);
  }
  for (const key of ['trackInventory', 'confirmTracking']) if (r[key] !== undefined && typeof r[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 200)) throw new Error('The note must be 200 characters or fewer.');
  if (['onHand','delta','trackInventory','lowStockThreshold'].every(k=>r[k]===undefined)) throw new Error('No inventory change supplied.');
  return { productId: r.productId as string, variantId: (r.variantId ?? null) as string | null, reason: r.reason, ...(r.onHand === undefined ? {} : {onHand:r.onHand as number}), ...(r.delta === undefined ? {} : {delta:r.delta as number}), ...(r.trackInventory === undefined ? {} : {trackInventory:r.trackInventory as boolean}), ...(r.lowStockThreshold === undefined ? {} : {lowStockThreshold:r.lowStockThreshold as number}), confirmTracking:r.confirmTracking === true, note:typeof r.note === 'string'?r.note.trim():'' };
}
export function inventoryDelta(onHand: number, reserved: number, input: Pick<InventoryChange,'onHand'|'delta'>): number {
  const next = input.onHand ?? onHand + (input.delta ?? 0);
  if (!Number.isSafeInteger(next) || next < 0 || next > 1_000_000 || next < reserved) throw new Error('The count must be nonnegative and cover all reserved units.');
  return next - onHand;
}
export function validateAllocation(rows: unknown): Array<{variantId:string;quantity:number}> {
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('Supply explicit allocation rows.');
  const seen = new Set<string>();
  return rows.map(r=>{
    if (!r || typeof r.variantId !== 'string' || !r.variantId || seen.has(r.variantId) || !Number.isSafeInteger(r.quantity) || r.quantity < 0 || r.quantity > 1_000_000) throw new Error('Each allocation needs a unique variant and an explicit nonnegative whole count.');
    seen.add(r.variantId); return {variantId:r.variantId,quantity:r.quantity};
  });
}

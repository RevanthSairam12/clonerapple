import { validateNewProductInput, validateVariantInput, PRICE_MAX_PAISE, type VariantInput } from './catalog-crud-rules';
import { validateProductImageInput, type ProductImageInput } from './catalog-rules';
import { parseMetadataInput } from '@/lib/catalog/product-metadata-rules';
import { parseProductDescription } from '@/lib/catalog/product-description';
import { validateInventoryChange, validateAllocation, type InventoryChange } from './variant-inventory-rules';
import { validateExpectedRevision } from './catalog-revision';

export const DRAFT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
export function draftRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Send a JSON object.');
  return raw as Record<string, unknown>;
}
export function draftMoney(value: unknown, nullable = true): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > PRICE_MAX_PAISE) throw new Error('Enter a valid positive price in paise.');
  return value;
}
export type DraftStock = Omit<InventoryChange, 'productId' | 'variantId'>;
export interface DraftOption { input: VariantInput; clientKey?: string; pricePaise?: number|null; salePricePaise?: number|null; stock?: DraftStock }
export interface ProductDraft {
  expectedRevision?: number;
  id?: string; product: {ok:true;value:import('./catalog-crud-rules').NewProductInput};
  metadata: ReturnType<typeof parseMetadataInput>;
  shortDescription?: string|null; descriptionSections?: ReturnType<typeof parseProductDescription>['sections'];
  salePricePaise?: number|null; costPaise?: number|null; sortOrder?: number; inStock?: boolean;
  /** The person confirmed a large price change; never inferred from the UI alone. */
  confirmLargePriceChanges?: boolean;
  gallery?: Array<ProductImageInput & {id?:string;isActive?:boolean}>; options?: DraftOption[]; stock?: DraftStock;
  activateVariantInventory?: {confirm:true;reason:string;allocations:Array<{variantId:string;quantity:number}>};
}
function stock(raw: unknown): DraftStock {
  const {productId: _p,variantId: _v,...change}=validateInventoryChange({...draftRecord(raw),productId:'draft',variantId:null});
  return change;
}
/** Full copy fields on the wire; optional collections preserve existing data when absent. */
export function parseProductDraft(raw: unknown): ProductDraft {
  const body=draftRecord(raw), p=draftRecord(body.product);
  const id=body.id;
  if(id!==undefined && (typeof id!=='string'||!DRAFT_ID.test(id))) throw new Error('Invalid product identity.');
  if(id && p.id!==undefined && p.id!==id) throw new Error('Product identity cannot change.');
  for(const key of ['isActive','isGiftOnly','trackInventory','inStock']) if(p[key]!==undefined && typeof p[key]!=='boolean') throw new Error(`${key} must be true or false.`);
  const product=validateNewProductInput(p);
  if(!product.ok) throw new Error(product.error);
  const metadata=parseMetadataInput(body.metadata??p);
  if(p.id!==undefined && (typeof p.id!=='string'||!DRAFT_ID.test(p.id))) throw new Error('Invalid product identity.');
  product.value.id=(id??p.id??product.value.id) as string;
  const result:ProductDraft={...(id?{id:id as string}:{}),product,metadata};
  if(Object.prototype.hasOwnProperty.call(body,'expectedRevision')) result.expectedRevision=validateExpectedRevision(body.expectedRevision);
  if(body.salePricePaise!==undefined) result.salePricePaise=draftMoney(body.salePricePaise);
  if(body.confirmLargePriceChanges!==undefined){if(typeof body.confirmLargePriceChanges!=='boolean')throw new Error('Price change confirmation must be true or false.');result.confirmLargePriceChanges=body.confirmLargePriceChanges;}
  for(const key of ['costPaise','sortOrder','inStock'] as const){
    const value=p[key]; if(value===undefined) continue;
    if(key==='inStock'){if(typeof value!=='boolean') throw new Error('inStock must be boolean.');result.inStock=value;}
    else if(key==='costPaise') {if(value!==null&&(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>PRICE_MAX_PAISE))throw new Error('Invalid cost in paise.');result.costPaise=value as number|null;}
    else {if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>9999) throw new Error('Invalid sort order.');result.sortOrder=value;}
  }
  if(body.shortDescription!==undefined || body.descriptionSections!==undefined){
    const description=parseProductDescription({shortDescription:body.shortDescription??null,sections:body.descriptionSections??null});
    if(body.shortDescription!==undefined)result.shortDescription=description.shortDescription;
    if(body.descriptionSections!==undefined)result.descriptionSections=description.sections;
  }
  if(body.gallery!==undefined){
    if(!Array.isArray(body.gallery)||body.gallery.length>50)throw new Error('Supply at most 50 gallery images.');
    result.gallery=body.gallery.map((raw,index)=>{const r=draftRecord(raw);const checked=validateProductImageInput({...r,sort_order:r.sortOrder??r.sort_order??index});if(!checked.ok)throw new Error(checked.error);if(r.id!==undefined&&(typeof r.id!=='string'||!DRAFT_ID.test(r.id)))throw new Error('Invalid image identity.');if(r.isActive!==undefined&&typeof r.isActive!=='boolean')throw new Error('Invalid image visibility.');return {...checked.value,...(r.id?{id:r.id as string}:{}),...(r.isActive===undefined?{}:{isActive:r.isActive as boolean})};});
    for(const role of ['primary','hover']){
      if(result.gallery.filter(r=>r.role===role).length>1)throw new Error(`Only one ${role} image is allowed.`);
      if(result.gallery.some(r=>r.role===role&&r.colourId))throw new Error(`A ${role} image belongs to the whole product, not one colour.`);
    }
    const ids=result.gallery.flatMap(r=>r.id?[r.id]:[]);if(new Set(ids).size!==ids.length)throw new Error('Duplicate image identities.');
  }
  if(body.options!==undefined){
    if(!Array.isArray(body.options)||body.options.length>100)throw new Error('Supply at most 100 options.');
    const seen=new Set<string>();
    const labels=new Set<string>();
    const replacementSources=new Set<string>();
    for(const raw of body.options){const row=draftRecord(raw);if(typeof row.replacesVariantId==='string'){if(replacementSources.has(row.replacesVariantId))throw new Error('An option can only be replaced once.');replacementSources.add(row.replacesVariantId);}}
    result.options=body.options.map(raw=>{const r=draftRecord(raw);const checked=validateVariantInput(r);if(!checked.ok)throw new Error(checked.error);
      const label=JSON.stringify([checked.value.optionName,checked.value.optionValue]);
      // Saved rows may be permanently retired. The database validates merged
      // persisted live identities; never trust client-provided retirement flags.
      if(!checked.value.id){
        if(labels.has(label))throw new Error('Each new sub-item needs a unique option type and value.');
        labels.add(label);
      }
      if(checked.value.id&&replacementSources.has(checked.value.id)&&checked.value.isActive)throw new Error('The replacement source must be staged inactive.');
      if(checked.value.replacesVariantId&&r.stock!==undefined){const change=stock(r.stock);if(change.reason!=='receipt'||change.confirmTracking!==true)throw new Error('Replacement stock must be an explicitly confirmed receipt.');}
      const key=r.clientKey??r.id;if(key!==undefined){if(typeof key!=='string'||!DRAFT_ID.test(key)||seen.has(key))throw new Error('Use unique option identities.');seen.add(key);}
      return {input:checked.value,...(r.clientKey?{clientKey:r.clientKey as string}:{}),...(r.pricePaise===undefined? r.priceOverridePaise===undefined?{}:{pricePaise:draftMoney(r.priceOverridePaise)}:{pricePaise:draftMoney(r.pricePaise)}),...(r.salePricePaise===undefined?{}:{salePricePaise:draftMoney(r.salePricePaise)}),...(r.stock===undefined?{}:{stock:stock(r.stock)})};});
  }
  if(body.stock!==undefined)result.stock=stock(body.stock);
  if(body.activateVariantInventory!==undefined){const a=draftRecord(body.activateVariantInventory);if(a.confirm!==true||typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>200)throw new Error('Confirm activation and supply a reason (maximum 200 characters).');result.activateVariantInventory={confirm:true,reason:a.reason.trim(),allocations:validateAllocation(a.allocations??[])};}
  return result;
}

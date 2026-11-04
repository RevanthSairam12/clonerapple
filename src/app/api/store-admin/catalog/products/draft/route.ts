import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { ProductDraftError, saveProductDraft } from '@/lib/store-admin/product-draft';
import { MetadataError } from '@/lib/store-admin/product-metadata';
import { CatalogRevisionError } from '@/lib/store-admin/catalog-revision';
import { VariantIdentityError } from '@/lib/store-admin/variant-identity';
import { ProductContentError } from '@/lib/store-admin/product-content';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export const dynamic = 'force-dynamic';
export async function POST(request:Request){
  const violation=assertSameOrigin(request);if(violation)return violation;
  const guard=await requireStoreRole('store_admin');if(!guard.ok)return guard.response;
  let body:unknown;
  try{body=await request.json();}catch{return NextResponse.json({error:'Invalid request body.'},{status:400});}
  try{
    const result=await saveProductDraft(body,guard.session.adminId,request);
    try { revalidateCatalog(result.product.id); }
    catch { console.warn('[store-admin/catalog] product saved; catalog cache refresh failed'); }
    return NextResponse.json(result,{status:result.product.created?201:200});
  }catch(error){
    if(error instanceof CatalogRevisionError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});
    if(error instanceof VariantIdentityError||error instanceof ProductContentError)return NextResponse.json({error:error.message},{status:error.status});
    if(error instanceof ProductDraftError)return NextResponse.json({error:error.message},{status:error.status});
    if(error instanceof MetadataError)return NextResponse.json({error:error.message},{status:400});
    if((error as {code?:string})?.code==='23505')return NextResponse.json({error:'A product, SKU, combination or slug already uses that identity.'},{status:409});
    console.warn('[store-admin/catalog] atomic product draft rolled back');
    return NextResponse.json({error:'The product could not be saved. No draft changes were committed.'},{status:503});
  }
}

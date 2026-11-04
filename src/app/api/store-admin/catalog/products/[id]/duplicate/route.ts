import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { duplicateProduct } from '@/lib/store-admin/product-duplicate';
import { MetadataError } from '@/lib/store-admin/product-metadata';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const origin=assertSameOrigin(request);if(origin)return origin;
  const guard=await requireStoreRole('store_admin');if(!guard.ok)return guard.response;
  let body:unknown;try{body=await request.json();}catch{return NextResponse.json({error:'Invalid request body.'},{status:400});}
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Enter a name and slug.'},{status:400});
  const input=body as Record<string,unknown>;
  if(typeof input.name!=='string'||typeof input.slug!=='string'||Object.keys(input).some(key=>!['name','slug'].includes(key)))return NextResponse.json({error:'Only a name and slug can be supplied; duplicate prices and metadata are copied server-side.'},{status:400});
  try{
    const {id}=await context.params;
    const created=await duplicateProduct(id,{name:input.name,slug:input.slug},guard.session.adminId,request);
    revalidateCatalog(created);
    return NextResponse.json({id:created},{status:201});
  }catch(error){return NextResponse.json({error:error instanceof MetadataError?error.message:'Could not duplicate this product.'},{status:error instanceof MetadataError?400:503});}
}

import {NextResponse} from 'next/server';
import {assertSameOrigin} from '@/lib/platform/api-guard';
import {requireStoreRole} from '@/lib/store-admin/auth';
import {activateVariantInventory,adjustVariantInventory} from '@/lib/store-admin/variant-inventory';
import {revalidateCatalog} from '@/lib/storefront/revalidate';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const origin=assertSameOrigin(request);if(origin)return origin;
  const guard=await requireStoreRole('store_admin');if(!guard.ok)return guard.response;
  const {id}=await context.params;
  try{
    const body=await request.json();
    if(body.action==='activate') await activateVariantInventory(id,body,guard.session.adminId,request);
    else {
      if(!Array.isArray(body.rows))return NextResponse.json({error:'Supply inventory rows.'},{status:400});
      await adjustVariantInventory(body.rows.map((r:Record<string,unknown>)=>({...r,productId:id})),guard.session.adminId,request);
    }
    revalidateCatalog(id);return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error&&error.name!=='PostgresError'?error.message:'Inventory change failed; no rows were saved.'},{status:400});}
}

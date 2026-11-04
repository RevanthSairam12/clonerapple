import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { sharedKind, loadSharedSnapshot, previewSharedImport, applySharedImport, sharedSessionBinding, saveSharedReference, sharedUses } from '@/lib/store-admin/shared-lists';
import { readSharedBody, sharedFailure, sharedPrivateHeaders, sharedRateLimit } from '@/lib/store-admin/shared-list-http';
import { safeSharedCsv, sharedTemplate } from '@/lib/catalog/shared-list-rules';
import { revalidateCatalog } from '@/lib/storefront/revalidate';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ kind: string }> };
function refresh() { try { revalidateCatalog(); } catch { console.warn('[shared-catalogue] saved; cache refresh pending'); } }

export async function GET(_request:Request,context:Context){
 const guard=await requireStoreRole('store_owner');if(!guard.ok)return guard.response;
 const limit=sharedRateLimit(guard.session.adminId,'download');if(limit)return limit;
 try {const kind=sharedKind((await context.params).kind);
 const snapshot=await loadSharedSnapshot();const csv=kind==='models'?safeSharedCsv([['brand','model','sort_order','active'],...snapshot.models.map(row=>[snapshot.brands.find(b=>b.id===row.brandId)?.name??'',row.name,row.sortOrder,row.isActive?'yes':'no'])]):safeSharedCsv([['name','hex','sort_order','active'],...snapshot.colours.map(row=>[row.name,row.hex,row.sortOrder,row.isActive?'yes':'no'])]);
 return new Response(csv,{headers:{...sharedPrivateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${kind}-export.csv"`,'X-Content-Type-Options':'nosniff'}});
 }catch(error){return sharedFailure(error);}
}

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

export async function GET(request:Request,context:Context){
 const guard=await requireStoreRole('store_owner');if(!guard.ok)return guard.response;
 const limit=sharedRateLimit(guard.session.adminId,'uses');if(limit)return limit;
 try {const kind=sharedKind((await context.params).kind),url=new URL(request.url);return NextResponse.json(await sharedUses(kind,url.searchParams.get('id')??'',url.searchParams.get('cursor')??''),{headers:sharedPrivateHeaders});}catch(error){return sharedFailure(error);}
}

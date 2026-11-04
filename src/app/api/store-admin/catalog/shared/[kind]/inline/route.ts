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

export async function POST(request:Request,context:Context){
 const violation=assertSameOrigin(request);if(violation)return violation;
 const guard=await requireStoreRole('store_admin');if(!guard.ok)return guard.response;
 const limit=sharedRateLimit(guard.session.adminId,'inline');if(limit)return limit;
 try {const kind=sharedKind((await context.params).kind);const reference=await saveSharedReference(kind,await readSharedBody(request),guard.session.adminId,request,true);refresh();return NextResponse.json({reference},{status:201,headers:sharedPrivateHeaders});}catch(error){return sharedFailure(error);}
}

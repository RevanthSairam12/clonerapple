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

export async function GET(_request: Request, context: Context) {
 const guard=await requireStoreRole('store_viewer'); if(!guard.ok)return guard.response;
 try { sharedKind((await context.params).kind); return NextResponse.json({snapshot:await loadSharedSnapshot()},{headers:sharedPrivateHeaders}); } catch(error){return sharedFailure(error);}
}
export async function POST(request:Request,context:Context){
 const violation=assertSameOrigin(request);if(violation)return violation;
 const guard=await requireStoreRole('store_owner');if(!guard.ok)return guard.response;
 const limit=sharedRateLimit(guard.session.adminId,'create');if(limit)return limit;
 try { const kind=sharedKind((await context.params).kind);const raw=await readSharedBody(request);delete raw.id;const reference=await saveSharedReference(kind,raw,guard.session.adminId,request);refresh();return NextResponse.json({reference},{status:201,headers:sharedPrivateHeaders});}catch(error){return sharedFailure(error);}
}
export async function PUT(request:Request,context:Context){
 const violation=assertSameOrigin(request);if(violation)return violation;
 const guard=await requireStoreRole('store_owner');if(!guard.ok)return guard.response;
 const limit=sharedRateLimit(guard.session.adminId,'save');if(limit)return limit;
 try { const kind=sharedKind((await context.params).kind);const raw=await readSharedBody(request);if(typeof raw.id!=='string')return NextResponse.json({error:'Choose a saved reference.'},{status:400,headers:sharedPrivateHeaders});await saveSharedReference(kind,raw,guard.session.adminId,request);refresh();return NextResponse.json({ok:true},{headers:sharedPrivateHeaders});}catch(error){return sharedFailure(error);}
}

import {NextResponse} from 'next/server';
import {assertSameOrigin} from '@/lib/platform/api-guard';
import {queueNotification} from '@/lib/notifications/queue';
import {stockAlertProductName, stockNotificationEvent} from '@/lib/notifications/stock-events';
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
      const rows=await adjustVariantInventory(body.rows.map((r:Record<string,unknown>)=>({...r,productId:id})),guard.session.adminId,request);
      // Only a crossing raises an alert, and each option is judged on its own
      // count: one colour going low must not read as the product going low, and
      // a colour already low must not re-alert on every later adjustment. The
      // movement id keys the message, so a retry cannot send it twice. Queueing
      // happens after the transaction committed, and never blocks the response.
      for(const row of rows){
        if(!row.stockKnown) continue;
        const event=stockNotificationEvent({availableBefore:row.availableBefore,availableAfter:row.availableAfter,threshold:row.lowStockThreshold});
        if(!event) continue;
        queueNotification(event,{type:'product',id},{
          productName:stockAlertProductName(row.productName,row.variantLabel),
          stockAvailable:row.availableAfter,
          staffLink:row.variantId
            ? `/store-admin/stock/${encodeURIComponent(id)}?variant=${encodeURIComponent(row.variantId)}`
            : `/store-admin/stock/${encodeURIComponent(id)}`,
          token:`movement:${row.movementId}`,
        });
      }
    }
    revalidateCatalog(id);return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error&&error.name!=='PostgresError'?error.message:'Inventory change failed; no rows were saved.'},{status:400});}
}

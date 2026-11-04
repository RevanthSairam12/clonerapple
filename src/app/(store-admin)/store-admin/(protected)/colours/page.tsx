import Link from 'next/link';
import { SharedListManager } from '@/components/store-admin/SharedListManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import { loadSharedSnapshot } from '@/lib/store-admin/shared-lists';

export const dynamic = 'force-dynamic';

export default async function StoreAdminColoursPage() {
  const session = await getStoreSession();
  if (!session) return <p className="sa-lock-note">Sign in to view shared colours.</p>;
  const snapshot = await loadSharedSnapshot().catch(() => null);
  return <div>
    <div className="sa-detail-head"><div><h1 className="sa-page-title">Colours</h1><p className="sa-page-sub">Reusable colour names and hex values. Creating a colour never binds it to a product option.</p></div><Link className="sa-btn sa-btn-quiet" href="/store-admin/catalog">Catalogue data</Link></div>
    {snapshot ? <SharedListManager kind="colours" snapshot={snapshot} canManage={session.role === 'store_owner'} /> : <p className="sa-notice" role="status">Shared colours are unavailable. Ask the owner to check catalogue service and schema availability. No setup or migration has been run. <Link href="/store-admin/colours">Retry colours</Link></p>}
  </div>;
}

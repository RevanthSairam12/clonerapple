import Link from 'next/link';
import { MetadataReferenceManager } from '@/components/store-admin/MetadataReferenceManager';
import { SharedListManager } from '@/components/store-admin/SharedListManager';
import { loadSharedSnapshot } from '@/lib/store-admin/shared-lists';
import { getStoreSession } from '@/lib/store-admin/auth';
import { loadMetadataManagement } from '@/lib/store-admin/product-metadata';

export const dynamic = 'force-dynamic';

/** Shared metadata only: browsing never creates records or applies migrations. */
export default async function StoreAdminDeviceModelsPage() {
  const session = await getStoreSession();
  if (!session) return <p className="sa-lock-note">Sign in to view device models.</p>;
  const [metadata, snapshot] = await Promise.all([loadMetadataManagement().catch(() => null), loadSharedSnapshot().catch(() => null)]);
  const canEdit = session.role === 'store_owner';
  return <div>
    <div className="sa-detail-head"><div><h1 className="sa-page-title">Device models</h1><p className="sa-page-sub">Manage exact compatible device brands and models. These are separate from product manufacturers; creating a device never selects it for a product.</p></div><Link className="sa-btn sa-btn-quiet" href="/store-admin/catalog">Catalogue data</Link></div>
    {!metadata ? <p className="sa-notice" role="status">Device references are unavailable. Retry the page or ask the owner to check catalogue service and schema availability. No setup or migration has been run. <Link href="/store-admin/device-models">Retry device models</Link></p> : <>
      {!canEdit && <p className="sa-lock-note">All staff can browse device references. Only owners manage them here; admins can create models inline in the product editor, but cannot create brands.</p>}
      <MetadataReferenceManager group="brands" references={metadata.references} management={metadata} categories={[]} attributes={[]} canEdit={canEdit} />
      <MetadataReferenceManager group="models" references={metadata.references} management={metadata} categories={[]} attributes={[]} canEdit={canEdit} />
    </>}
    {snapshot ? <SharedListManager kind="models" snapshot={snapshot} canManage={canEdit} /> : <p className="sa-notice" role="status">Shared model imports and deactivation review are unavailable. No setup has been run.</p>}
  </div>;
}

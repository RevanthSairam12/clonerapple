import { MediaLibrary } from '@/components/store-admin/MediaLibrary';
import { storageConfigured } from '@/lib/admin/storage';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listMedia } from '@/lib/store-admin/media';

export const dynamic = 'force-dynamic';

/**
 * Shared media library. Product images and brand logos point at the same
 * `/api/media/<id>` URLs, so a file that is still in use cannot be deleted.
 */
export default async function StoreAdminMediaPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const result = await listMedia();

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Media library</h1>
        <p className="sa-notice">
          The media library is not available yet. Apply migration 0025, then
          reload this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="sa-page-title">Media library</h1>
      <p className="sa-page-sub">
        {result.data.length} {result.data.length === 1 ? 'file' : 'files'} shared
        by product galleries and brand logos. Paste a file URL into any image
        field.
      </p>
      <MediaLibrary
        items={result.data}
        canEdit={canEdit}
        storageReady={storageConfigured()}
      />
    </div>
  );
}

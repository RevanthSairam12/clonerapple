import Link from 'next/link';

import { CollectionManager } from '@/components/store-admin/CollectionManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import {
  listCollectionProductOptions,
  listStoreCollections,
} from '@/lib/store-admin/collections';

export const dynamic = 'force-dynamic';

/**
 * Merchandising collections under Catalog.
 *
 * This screen only chooses and orders products. The product records themselves
 * are edited on the Products screen, and the legacy CMS cannot write here.
 */
export default async function StoreAdminCollectionsPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const [collections, products] = await Promise.all([
    listStoreCollections(),
    listCollectionProductOptions(),
  ]);

  if (!collections.ok || !products.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Storefront collections</h1>
        <p className="sa-notice">
          The collection tables are not available yet. Apply migration 0033,
          then reload this page.
        </p>
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/catalog">
          Back to catalogue data
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Storefront collections</h1>
          <p className="sa-page-sub">
            Named, ordered product lists consumed by storefront rails and
            carousels. Prices, images and stock remain on the Products screen;
            the legacy content editor cannot change membership.
          </p>
        </div>
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/catalog">
          Catalogue data
        </Link>
      </div>

      <CollectionManager
        initialCollections={collections.data}
        productOptions={products.data}
        canEdit={canEdit}
      />
    </div>
  );
}

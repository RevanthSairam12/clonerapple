import { CatalogTransfer } from '@/components/store-admin/CatalogTransfer';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listCatalogOverview } from '@/lib/store-admin/catalog';

export const dynamic = 'force-dynamic';

/**
 * Bulk catalogue import and export.
 *
 * Imports are all-or-nothing: the whole file lands in one transaction or none
 * of it does, and every rejected file leaves a downloadable row-level report.
 */
export default async function StoreAdminCatalogTransferPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const overview = await listCatalogOverview();
  const categories = overview.ok
    ? overview.data.categories.map((category) => ({ id: category.id, name: category.name }))
    : [];

  return (
    <div>
      <h1 className="sa-page-title">Import &amp; export</h1>
      <p className="sa-page-sub">
        Move the catalogue in and out as CSV. Stock and low-stock reports export
        from the same columns the stock pages show.
      </p>
      <CatalogTransfer categories={categories} canEdit={canEdit} />
    </div>
  );
}

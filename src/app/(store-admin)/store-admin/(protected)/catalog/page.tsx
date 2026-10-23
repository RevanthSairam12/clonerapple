import { AttributeManager } from '@/components/store-admin/AttributeManager';
import { BrandManager } from '@/components/store-admin/BrandManager';
import { UnitManager } from '@/components/store-admin/UnitManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listAttributes, listBrands, listUnits } from '@/lib/store-admin/catalog';

export const dynamic = 'force-dynamic';

/**
 * Reference data that products point at: brands, units and attributes.
 *
 * Editing is owner-only — these rows re-shape every product that uses them —
 * so a viewer or admin sees the same page with the forms hidden.
 */
export default async function StoreAdminCatalogPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role === 'store_owner';

  const [brandsResult, unitsResult, attributesResult] = await Promise.all([
    listBrands(),
    listUnits(),
    listAttributes(),
  ]);

  if (!brandsResult.ok || !unitsResult.ok || !attributesResult.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Catalogue data</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migrations 0011 and
          0012, then run <code>node scripts/seed-store-catalog.mjs</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="sa-page-title">Catalogue data</h1>
      <p className="sa-page-sub">
        Brands, units and attributes that products point at. Product copy and
        images are edited on the product page.
      </p>

      <div className="sa-detail-grid">
        <BrandManager initialBrands={brandsResult.data} canEdit={canEdit} />
        <UnitManager initialUnits={unitsResult.data} canEdit={canEdit} />
      </div>

      <AttributeManager
        initialAttributes={attributesResult.data}
        units={unitsResult.data}
        canEdit={canEdit}
      />
    </div>
  );
}

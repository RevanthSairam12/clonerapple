import Link from 'next/link';

import { AttributeManager } from '@/components/store-admin/AttributeManager';
import { BrandManager } from '@/components/store-admin/BrandManager';
import { ConditionManager } from '@/components/store-admin/ConditionManager';
import { UnitManager } from '@/components/store-admin/UnitManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listAttributes, listBrands, listUnits } from '@/lib/store-admin/catalog';
import { listConditions } from '@/lib/store-admin/catalog-crud';

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

  const [brandsResult, unitsResult, attributesResult, conditionsResult] =
    await Promise.all([listBrands(), listUnits(), listAttributes(), listConditions()]);

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
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Catalogue data</h1>
          <p className="sa-page-sub">
            Brands, conditions, units and attributes that products point at.
            Product copy, price and images are edited on the product page.
          </p>
        </div>
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/categories">
          Category tree
        </Link>
      </div>

      <div className="sa-detail-grid">
        <BrandManager initialBrands={brandsResult.data} canEdit={canEdit} />
        <ConditionManager
          initialConditions={conditionsResult.ok ? conditionsResult.data : []}
          canEdit={canEdit}
        />
      </div>

      <div className="sa-detail-grid">
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

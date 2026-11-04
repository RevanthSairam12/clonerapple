import Link from 'next/link';
import { AttributeManager } from '@/components/store-admin/AttributeManager';
import { BrandManager } from '@/components/store-admin/BrandManager';
import { ConditionManager } from '@/components/store-admin/ConditionManager';
import { UnitManager } from '@/components/store-admin/UnitManager';
import { CatalogueDataWorkspace } from '@/components/store-admin/CatalogueDataWorkspace';
import { CatalogStarterSetup } from '@/components/store-admin/CatalogStarterSetup';
import { MetadataReferenceManager } from '@/components/store-admin/MetadataReferenceManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listAttributes, listBrands, listCategoryOptions, listUnits } from '@/lib/store-admin/catalog';
import { loadMetadataManagement } from '@/lib/store-admin/product-metadata';
import { listConditions } from '@/lib/store-admin/catalog-crud';

export const dynamic = 'force-dynamic';
function Unavailable({ label, missingSchema = false }: { label: string; missingSchema?: boolean }) {
  return <p className="sa-notice" role="status">{label} could not be loaded. {missingSchema ? 'The required metadata tables are missing. An owner must arrange migration 0051 before setup.' : 'Retry the page. If this continues, ask the owner to check the catalogue service.'} <Link href="/store-admin/catalog">Retry catalogue data</Link></p>;
}
function missingTable(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === '42P01';
}
/** Owner-managed shared references. Each section can fail independently. */
export default async function StoreAdminCatalogPage({ searchParams }: { searchParams?: Promise<{ category?: string }> }) {
  const session = await getStoreSession();
  if (!session) return <p className="sa-lock-note">Sign in to view catalogue data.</p>;
  const canEdit = session.role === 'store_owner';
  const query = await searchParams;
  const [metadataResult, categories, brands, units, attributes, conditions] = await Promise.all([
    loadMetadataManagement().then(data => ({ data, missing: false })).catch((error: unknown) => ({ data: null, missing: missingTable(error) })),
    listCategoryOptions(), listBrands(), listUnits(), listAttributes(), listConditions(),
  ]);
  const metadata = metadataResult.data;
  const refsReady = !!metadata && categories.ok && attributes.ok;
  const reference = (group: 'types' | 'attributes' | 'brands' | 'models') => metadata && (group !== 'types' || categories.ok) && (group !== 'attributes' || (categories.ok && attributes.ok))
    ? <MetadataReferenceManager group={group} references={metadata.references} management={metadata} categories={categories.ok ? categories.data : []} attributes={attributes.ok ? attributes.data : []} canEdit={canEdit} initialCategory={query?.category} />
    : <Unavailable label="Product type and device references" missingSchema={metadataResult.missing} />;
  return <div>
    <div className="sa-detail-head"><div><h1 className="sa-page-title">Catalogue data</h1><p className="sa-page-sub">Manage reusable choices for your products. Edit individual product values, copy and photos on the product page.</p></div><div className="sa-inline-actions"><Link className="sa-btn sa-btn-quiet" href="/store-admin/collections">Collections</Link><Link className="sa-btn sa-btn-quiet" href="/store-admin/categories">Category tree</Link></div></div>
    <CatalogueDataWorkspace canEdit={canEdit}
      starter={canEdit ? <CatalogStarterSetup categories={categories.ok ? categories.data : []} available={refsReady && units.ok} /> : null}
      types={reference('types')}
      details={<><div className="sa-catalog-section-head"><h2 className="sa-section-title">Field definitions</h2><p className="sa-hint">Create reusable fields first. Then assign them to a type below; a product only shows its type’s assigned fields.</p></div>{attributes.ok && units.ok ? <AttributeManager initialAttributes={attributes.data} units={units.data} canEdit={canEdit} /> : <Unavailable label="Detail field definitions and units" />}{reference('attributes')}</>}
      devices={<>{reference('brands')}{reference('models')}</>}
      other={<><h2 className="sa-section-title">Product brands</h2><p className="sa-hint">Who makes the product — not the brand of a compatible device.</p>{brands.ok ? <BrandManager initialBrands={brands.data} canEdit={canEdit} /> : <Unavailable label="Product brands" />}{conditions.ok ? <ConditionManager initialConditions={conditions.data} canEdit={canEdit} /> : <Unavailable label="Conditions" />}{units.ok ? <UnitManager initialUnits={units.data} canEdit={canEdit} /> : <Unavailable label="Units" />}</>}
    />
  </div>;
}

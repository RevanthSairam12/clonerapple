import Link from 'next/link';
import { ProductHelp } from '@/components/store-admin/ProductHelp';

import { ProductCreateForm } from '@/components/store-admin/ProductCreateForm';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listBrands, listCategoryOptions, listColourOptions } from '@/lib/store-admin/catalog';
import { listConditions } from '@/lib/store-admin/catalog-crud';
import { loadMetadataEditor } from '@/lib/store-admin/product-metadata';

export const dynamic = 'force-dynamic';

export default async function StoreAdminNewProductPage() {
  const session = await getStoreSession();
  if (session === null || session.role === 'store_viewer') {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/products">
          ← Products
        </Link>
        <h1 className="sa-page-title">New product</h1>
        <p className="sa-lock-note">A viewer cannot create products.</p>
      </div>
    );
  }

  const metadata = await loadMetadataEditor().catch(() => null);
  const [categoriesResult, brandsResult, conditionsResult, coloursResult] = await Promise.all([
    listCategoryOptions(),
    listBrands(),
    listConditions(),
    listColourOptions(),
  ]);

  if (!categoriesResult.ok || !brandsResult.ok || !conditionsResult.ok || !metadata) {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/products">
          ← Products
        </Link>
        <h1 className="sa-page-title">New product</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migrations 0011,
          0012, 0024 and 0051. Product metadata must be ready before creation; no global-attribute fallback is used.
        </p>
      </div>
    );
  }

  const categories = categoriesResult.data
    .filter((category) => category.isActive)
    .map((category) => ({ id: category.id, name: category.name }));
  const brands = brandsResult.data
    .filter((brand) => !brand.deletedAt)
    .map((brand) => ({ id: brand.id, name: brand.name }));
  const conditions = conditionsResult.data
    .filter((condition) => condition.isActive)
    .map((condition) => ({ id: condition.id, name: condition.label }));

  if (categories.length === 0) {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/products">
          ← Products
        </Link>
        <h1 className="sa-page-title">New product</h1>
        <p className="sa-notice">
          Create a category first — every product belongs to one.
        </p>
        <Link className="sa-btn sa-btn-primary" href="/store-admin/categories">
          Go to categories
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link className="sa-back" href="/store-admin/products">
        ← Products
      </Link>
      <ProductHelp label="Back to products">Return to the product list. Unsaved changes prompt you before leaving.</ProductHelp>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">New product</h1>
          <p className="sa-page-sub">
            Follow six simple steps to add photos, options, stock and a description.
            Save everything together as a draft, or review and publish.
          </p>
        </div>
      </div>

      <ProductCreateForm categories={categories} brands={brands} conditions={conditions} colours={coloursResult.ok ? coloursResult.data : []} metadataReferences={metadata.references} canManageDevices={session.role === 'store_owner'} canCreateShared={session.role === 'store_owner' || session.role === 'store_admin'} />
    </div>
  );
}

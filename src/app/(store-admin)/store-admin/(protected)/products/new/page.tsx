import Link from 'next/link';

import { ProductCreateForm } from '@/components/store-admin/ProductCreateForm';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listBrands, listCategoryOptions } from '@/lib/store-admin/catalog';
import { listConditions } from '@/lib/store-admin/catalog-crud';

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

  const [categoriesResult, brandsResult, conditionsResult] = await Promise.all([
    listCategoryOptions(),
    listBrands(),
    listConditions(),
  ]);

  if (!categoriesResult.ok || !brandsResult.ok || !conditionsResult.ok) {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/products">
          ← Products
        </Link>
        <h1 className="sa-page-title">New product</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migrations 0011,
          0012 and 0024, then reload this page.
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
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">New product</h1>
          <p className="sa-page-sub">
            Saved with an opening price history row and a stock row, so the
            product is sellable the moment it is created.
          </p>
        </div>
      </div>

      <ProductCreateForm categories={categories} brands={brands} conditions={conditions} />
    </div>
  );
}

import Link from 'next/link';

import { CategoryManager } from '@/components/store-admin/CategoryManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listCategoryTree } from '@/lib/store-admin/catalog-crud';

export const dynamic = 'force-dynamic';

export default async function StoreAdminCategoriesPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role === 'store_owner';
  const result = await listCategoryTree();

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Categories</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migration 0024, then
          reload this page.
        </p>
      </div>
    );
  }

  const products = result.data.reduce((sum, category) => sum + category.productCount, 0);

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Categories</h1>
          <p className="sa-page-sub">
            {result.data.length} categories · {products} products grouped.
          </p>
        </div>
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/products">
          Products
        </Link>
      </div>

      <CategoryManager initialCategories={result.data} canEdit={canEdit} />
    </div>
  );
}

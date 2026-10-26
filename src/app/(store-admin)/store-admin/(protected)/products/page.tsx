import Link from 'next/link';

import {
  formatDate,
  formatINR,
  listCatalogOverview,
} from '@/lib/store-admin/catalog';

export const dynamic = 'force-dynamic';

export default async function StoreAdminProductsPage() {
  const result = await listCatalogOverview();

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Products</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migrations 0011 and
          0012, then run <code>node scripts/seed-store-catalog.mjs</code>.
        </p>
      </div>
    );
  }

  const { categories, products } = result.data;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Products</h1>
          <p className="sa-page-sub">
            {products.length} products across {categories.length} categories.
          </p>
        </div>
        <Link className="sa-btn sa-btn-primary" href="/store-admin/products/new">
          New product
        </Link>
      </div>

      <div className="sa-category-strip">
        {categories.map((category) => (
          <span key={category.id} className="sa-chip">
            {category.name}
            <span className="sa-chip-count">{category.productCount}</span>
          </span>
        ))}
      </div>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th className="sa-num">Price</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <Link
                    className="sa-product-link"
                    href={`/store-admin/products/${encodeURIComponent(product.id)}`}
                  >
                    {product.name}
                  </Link>
                  <span className="sa-row-sub">
                    {product.id}
                    {product.subtitle ? ` · ${product.subtitle}` : ''}
                  </span>
                </td>
                <td>{product.categoryName}</td>
                <td className="sa-num">
                  <span className="sa-price">{formatINR(product.pricePaise)}</span>
                </td>
                <td>
                  <span
                    className={
                      product.isActive ? 'sa-status sa-status-on' : 'sa-status'
                    }
                  >
                    {product.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="sa-date">{formatDate(product.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {products.length === 0 ? (
        <p className="sa-empty">
          No products are seeded yet. Run{' '}
          <code>node scripts/seed-store-catalog.mjs</code>.
        </p>
      ) : null}
    </div>
  );
}

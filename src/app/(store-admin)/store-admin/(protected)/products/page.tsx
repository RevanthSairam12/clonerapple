import Link from 'next/link';
import { ProductGuide, ProductHelp } from '@/components/store-admin/ProductHelp';
import { getStoreSession } from '@/lib/store-admin/auth';
import { loadMetadataEditor } from '@/lib/store-admin/product-metadata';

import {
  catalogStockLabel,
  formatDate,
  formatINR,
  listCatalogOverview,
} from '@/lib/store-admin/catalog';

export const dynamic = 'force-dynamic';

export default async function StoreAdminProductsPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const session = await getStoreSession();
  if (!session) return <p className="sa-lock-note">Sign in to view products.</p>;
  const { review } = await searchParams;
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
  // Sequential reads avoid competing with the dev server's limited session pool.
  const metadataStates = new Map<string, Awaited<ReturnType<typeof loadMetadataEditor>>['state']>();
  let metadataReady = true;
  if (products.length === 0) {
    try { await loadMetadataEditor(); } catch { metadataReady = false; }
  }
  for (const product of products) {
    try { metadataStates.set(product.id, (await loadMetadataEditor(product.id)).state); }
    catch { metadataReady = false; break; }
  }
  const needsReview = (id: string) => { const state = metadataStates.get(id); return !state || !state.reviewed || state.problems.length > 0; };
  const visibleProducts = metadataReady && review === 'compatibility'
    ? products.filter(product => metadataStates.get(product.id)?.needsCompatibilityReview)
    : review === 'needed' && metadataReady ? products.filter(product => needsReview(product.id)) : products;
  const oversellable = products.filter(
    (product) => product.isActive && product.inStock &&
      (product.stockStatus === 'unlimited' || product.stockStatus === 'mixed'),
  );

  return (
    <ProductGuide><div className="sa-products-page">
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Products</h1>
          <p className="sa-page-sub">
            {products.length} products across {categories.length} categories.
          </p>
        </div>
        {session.role !== "store_viewer" ? <div className="sa-product-guided-action"><Link className="sa-btn sa-btn-primary" href="/store-admin/products/new">New product</Link><ProductHelp label="New product">Start with the name and category, then follow six steps. You can save as a draft before publishing.</ProductHelp></div> : null}
      </div>

      <div className="sa-product-intro"><h2>Find a product, then choose what to update</h2><p>Open a product to edit its details. Use colors/models for individual choices, or Set stock to update quantities.</p></div>
      <nav className="sa-inline-actions" aria-label="Product review filters">{[
        { label: 'All products', value: undefined, href: '/store-admin/products', help: 'Show every product, including drafts.' },
        { label: 'Check device compatibility', value: 'compatibility', href: '/store-admin/products?review=compatibility', help: 'Show products whose compatible devices need checking. This filter does not change any selections.' },
        { label: 'Check product details', value: 'needed', href: '/store-admin/products?review=needed', help: 'Show products with unreviewed or incomplete required details. Open a product to see what needs attention.' },
      ].map(filter => <div className="sa-product-guided-action" key={filter.href}><Link className={`sa-filter-chip ${(review === filter.value || (!['compatibility', 'needed'].includes(review ?? '') && !filter.value)) ? 'is-active' : ''}`} aria-current={review === filter.value || (!['compatibility', 'needed'].includes(review ?? '') && !filter.value) ? 'page' : undefined} href={filter.href}>{filter.label}</Link><ProductHelp label={filter.label}>{filter.help}</ProductHelp></div>)}</nav>
      {!metadataReady ? <p className="sa-notice">Metadata readiness could not be checked. Apply migration 0051 and reload. Review filtering is unavailable; all products are shown.</p> : null}

      <div className="sa-product-category-summary"><div className="sa-product-guided-action"><strong>Products per category</strong><ProductHelp label="Products per category">These are totals across the catalogue, not filters. Use the review buttons above to change this view.</ProductHelp></div><div className="sa-category-strip">
        {categories.map((category) => (
          <span key={category.id} className="sa-chip">
            {category.name}
            <span className="sa-chip-count">{category.productCount}</span>
          </span>
        ))}
      </div></div>

      {oversellable.length > 0 ? (
        <p className="sa-notice">
          {oversellable.length} active product{oversellable.length === 1 ? '' : 's'}{' '}
          have no stock limit and can be oversold. Open a product to enable
          “Limit my stock”.
        </p>
      ) : null}

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th className="sa-num">Price</th>
              <th className="sa-num">Sale price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product) => (
              <tr key={product.id}>
                <td>
                  <Link
                    className="sa-product-link"
                    href={`/store-admin/products/${encodeURIComponent(product.id)}`}
                  >
                    {product.name}
                  </Link>
                  <span className="sa-row-sub">
                    ID: {product.id}
                    {product.subtitle ? ` · ${product.subtitle}` : ''}
                  </span>
                  <div className="sa-product-guided-action"><Link className="sa-btn sa-btn-small" href={`/store-admin/products/${encodeURIComponent(product.id)}`}>{session.role === 'store_viewer' ? 'View product' : 'Edit product'}</Link><ProductHelp label={`Product ${product.name}`}>Open the six product sections. The ID is a stable internal reference; the name is what customers see.</ProductHelp></div>
                  <div className="sa-product-guided-action"><Link
                    className="sa-row-sub sa-product-link"
                    href={`/store-admin/products/${encodeURIComponent(product.id)}#product-step-2`}
                  >
                    {product.optionCount ?? 0} sub-items • {session.role === 'store_viewer' ? 'View' : 'Edit'} colors/models
                  </Link><ProductHelp label={`Options for ${product.name}`}>Open individual choices such as Black / Phone A. Each sellable choice keeps its own stock and history.</ProductHelp></div>
                </td>
                <td>{product.categoryName}</td>
                <td className="sa-num">
                  <span className="sa-price">{formatINR(product.pricePaise)}</span>
                </td>
                <td className="sa-num">
                  {product.salePricePaise === null ? (
                    <span className="sa-muted">—</span>
                  ) : (
                    <span className="sa-price">
                      {formatINR(product.salePricePaise)}
                    </span>
                  )}
                </td>
                <td>
                  <span className={
                    product.stockStatus === 'missing' ? 'sa-status sa-status-warn'
                      : !product.inStock ? 'sa-status sa-status-danger'
                      : product.stockStatus === 'mixed' ? 'sa-status sa-status-warn'
                      : product.stockStatus === 'limited' ? 'sa-status sa-status-on'
                      : 'sa-status'
                  }>
                    {catalogStockLabel(product)}
                  </span>
                  <ProductHelp label={`Stock for ${product.name}`}>Limited stock shows the available units across sellable choices. Not limited means no quantity cap; Mixed means only some choices have a cap. Stock setup needed means a stock row is missing. Set stock opens the quantity section without changing anything.</ProductHelp>
                  {session.role !== 'store_viewer' ? (
                    <Link className="sa-row-sub sa-product-link" href={`/store-admin/products/${encodeURIComponent(product.id)}#product-step-3`}>
                      Set stock
                    </Link>
                  ) : null}
                </td>
                <td>
                  <span
                    className={
                      product.isActive ? 'sa-status sa-status-on' : 'sa-status'
                    }
                  >
                    {product.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <span className="sa-row-sub">{metadataReady ? needsReview(product.id) ? "Product details need review" : "Product details checked" : "Details check unavailable"}</span><ProductHelp label={`Visibility for ${product.name}`}>Active means publication is on, but stock and required checks still apply. Inactive means publication is off. Details review checks required product information and compatible devices.</ProductHelp>
                </td>
                <td className="sa-date">{formatDate(product.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visibleProducts.length === 0 ? (
        <p className="sa-empty">
          No products match this view.
        </p>
      ) : null}
    </div></ProductGuide>
  );
}

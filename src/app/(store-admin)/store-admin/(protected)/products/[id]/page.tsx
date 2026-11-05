import Link from 'next/link';
import { ProductGuide, ProductHelp } from '@/components/store-admin/ProductHelp';
import { notFound } from 'next/navigation';

import { ProductWorkflow } from '@/components/store-admin/ProductWorkflow';
import { PriceHistoryTable } from '@/components/store-admin/PriceHistoryTable';
import { loadMetadataEditor } from '@/lib/store-admin/product-metadata';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate, getCatalogProduct, listBrands, listCategoryOptions } from '@/lib/store-admin/catalog';
import { listConditions } from '@/lib/store-admin/catalog-crud';

export const dynamic = 'force-dynamic';

export default async function StoreAdminProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getStoreSession();
  if (!session) return <p className="sa-lock-note">Sign in to view products.</p>;
  const result = await getCatalogProduct(id);
  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return <div><Link className="sa-back" href="/store-admin/products">← Products</Link><h1 className="sa-page-title">Product</h1><p className="sa-notice">The catalogue is not available. Check the catalogue migrations and reload.</p></div>;
  }
  const product = result.data;
  const [metadata, categoriesResult, brandsResult, conditionsResult] = await Promise.all([
    loadMetadataEditor(id).catch(() => null), listCategoryOptions(), listBrands(), listConditions(),
  ]);
  const ready = !!metadata?.state && categoriesResult.ok && brandsResult.ok && conditionsResult.ok;
  const categories = categoriesResult.ok ? categoriesResult.data.filter(category => category.isActive || category.id === product.categoryId).map(category => ({ id: category.id, name: category.name })) : [];
  const brands = brandsResult.ok ? brandsResult.data.filter(brand => !brand.deletedAt || brand.id === product.brandId).map(brand => ({ id: brand.id, name: brand.name })) : [];
  const conditions = conditionsResult.ok ? conditionsResult.data.filter(condition => condition.isActive || condition.id === product.conditionId).map(condition => ({ id: condition.id, name: condition.label })) : [];

  return <div className="sa-products-page">
    <Link className="sa-back" href="/store-admin/products">← Products</Link><ProductHelp label="Back to products">Return to the product list. Unsaved edits prompt you before leaving.</ProductHelp>
    <div className="sa-detail-head"><div><h1 className="sa-page-title">{product.name}</h1><p className="sa-page-sub">{product.subtitle || 'No subtitle'} · {product.categoryName}</p></div><span className={product.isActive ? 'sa-status sa-status-on sa-status-large' : 'sa-status sa-status-large'}>{product.isActive ? 'Active' : 'Draft'}</span></div>
    {ready && metadata ? <ProductWorkflow key={`${product.id}:${product.catalogRevision}`} product={product} categories={categories} brands={brands} conditions={conditions} metadataReferences={metadata.references} metadataState={metadata.state} canEdit={session.role !== 'store_viewer'} canManageDevices={session.role === 'store_owner'} canCreateShared={session.role === 'store_owner' || session.role === 'store_admin'} /> : <p className="sa-notice">Product references or metadata are unavailable. Apply the catalogue metadata and description migrations, then reload. Editing is paused to preserve the complete product.</p>}
    <ProductGuide><details className="sa-detail-section"><summary>Product record and price history</summary><ProductHelp label="Product record and price history">Read-only reference information and past price changes. Editing the form does not rewrite these records.</ProductHelp>
      <dl className="sa-meta"><div><dt>Product ID</dt><dd className="sa-mono">{product.id}</dd></div><div><dt>Created</dt><dd>{formatDate(product.createdAt)}</dd></div><div><dt>Updated</dt><dd>{formatDate(product.updatedAt)}</dd></div><div><dt>Currency</dt><dd>{product.currency}</dd></div></dl>
      <PriceHistoryTable rows={product.priceHistory} />
    </details></ProductGuide>
  </div>;
}

import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  formatDate,
  formatINR,
  getCatalogProduct,
} from '@/lib/store-admin/catalog';

export const dynamic = 'force-dynamic';

export default async function StoreAdminProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getCatalogProduct(id);

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();

    return (
      <div>
        <Link className="sa-back" href="/store-admin/products">
          ← Products
        </Link>
        <h1 className="sa-page-title">Product</h1>
        <p className="sa-notice">
          The catalogue tables are not available yet. Apply migrations 0011 and
          0012, then run <code>node scripts/seed-store-catalog.mjs</code>.
        </p>
      </div>
    );
  }

  const product = result.data;

  const facetGroups = new Map<string, string[]>();
  for (const facet of product.facets) {
    const values = facetGroups.get(facet.key) ?? [];
    values.push(facet.value);
    facetGroups.set(facet.key, values);
  }

  const availableStock = product.stock
    ? product.stock.onHand - product.stock.reserved
    : null;

  return (
    <div>
      <Link className="sa-back" href="/store-admin/products">
        ← Products
      </Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">{product.name}</h1>
          <p className="sa-page-sub">
            {product.subtitle || 'No subtitle'} · {product.categoryName}
          </p>
        </div>
        <span
          className={
            product.isActive
              ? 'sa-status sa-status-on sa-status-large'
              : 'sa-status sa-status-large'
          }
        >
          {product.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="sa-detail-grid">
        <section className="sa-detail-card sa-price-card">
          <h2 className="sa-card-title">Price</h2>
          <label className="sa-label" htmlFor="product-price">
            Selling price
          </label>
          <input
            id="product-price"
            className="sa-input sa-input-readonly"
            value={formatINR(product.pricePaise)}
            readOnly
            disabled
          />
          <p className="sa-lock-note">
            Locked until checkout reads the database.
          </p>
          <dl className="sa-meta">
            <div>
              <dt>Stored value</dt>
              <dd>{product.pricePaise.toLocaleString('en-IN')} paise</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{product.currency}</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{product.inStock ? 'In stock' : 'Out of stock'}</dd>
            </div>
          </dl>
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Record</h2>
          <dl className="sa-meta">
            <div>
              <dt>Product id</dt>
              <dd className="sa-mono">{product.id}</dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd className="sa-mono">{product.slug}</dd>
            </div>
            <div>
              <dt>Brand</dt>
              <dd>{product.brand || '—'}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>{product.material || '—'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(product.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(product.updatedAt)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Description</h2>
        <p className="sa-copy">{product.description || 'No description.'}</p>
      </section>

      {product.highlights.length > 0 ? (
        <section className="sa-detail-section">
          <h2 className="sa-section-title">Highlights</h2>
          <ul className="sa-highlights">
            {product.highlights.map((highlight) => (
              <li key={highlight.title}>
                <strong>{highlight.title}</strong>
                <span>{highlight.desc}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Facets</h2>
        {facetGroups.size === 0 ? (
          <p className="sa-empty">No facets recorded.</p>
        ) : (
          <dl className="sa-meta">
            {[...facetGroups.entries()].map(([key, values]) => (
              <div key={key}>
                <dt className="sa-mono">{key}</dt>
                <dd>{values.join(', ')}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Specifications</h2>
        {product.specs.length === 0 ? (
          <p className="sa-empty">No specifications recorded.</p>
        ) : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {product.specs.map((spec) => (
                  <tr key={spec.label}>
                    <td>{spec.label}</td>
                    <td>{spec.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Images</h2>
        {product.images.length === 0 ? (
          <p className="sa-empty">No images recorded.</p>
        ) : (
          <div className="sa-image-grid">
            {product.images.map((image) => (
              <figure key={image.id} className="sa-image-card">
                {/* Local static asset; no remote image optimisation needed. */}
                <img src={image.url} alt={image.alt || product.name} />
                <figcaption>
                  <span className="sa-chip">{image.role}</span>
                  <span className="sa-mono sa-break">{image.url}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Colours / variants</h2>
        {product.variants.length === 0 ? (
          <p className="sa-empty">No variants recorded.</p>
        ) : (
          <>
            <p className="sa-note">
              Display only — colour does not price the item, change stock, or
              create a separate cart line yet.
            </p>
            <div className="sa-variant-row">
              {product.variants.map((variant) => (
                <span key={variant.id} className="sa-variant">
                  <span
                    className="sa-swatch"
                    style={{ background: variant.optionHex ?? 'transparent' }}
                    aria-hidden="true"
                  />
                  {variant.optionValue}
                  {variant.isActive ? '' : ' (inactive)'}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="sa-detail-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Stock</h2>
          {product.stock ? (
            <dl className="sa-meta">
              <div>
                <dt>On hand</dt>
                <dd>{product.stock.onHand}</dd>
              </div>
              <div>
                <dt>Reserved</dt>
                <dd>{product.stock.reserved}</dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>{availableStock}</dd>
              </div>
              <div>
                <dt>Tracking</dt>
                <dd>
                  {product.stock.trackInventory
                    ? 'Enabled'
                    : 'Off — checkout ignores stock'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="sa-empty">No stock row.</p>
          )}
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">In the box</h2>
          {product.inTheBox.length === 0 ? (
            <p className="sa-empty">Nothing recorded.</p>
          ) : (
            <ul className="sa-plain-list">
              {product.inTheBox.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Price history</h2>
        {product.priceHistory.length === 0 ? (
          <p className="sa-empty">No price history.</p>
        ) : (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Changed</th>
                  <th className="sa-num">Old</th>
                  <th className="sa-num">New</th>
                  <th>Source</th>
                  <th>Reason</th>
                  <th>Changed by</th>
                </tr>
              </thead>
              <tbody>
                {product.priceHistory.map((row) => (
                  <tr key={row.id}>
                    <td className="sa-date">{formatDate(row.changedAt)}</td>
                    <td className="sa-num">
                      {row.oldPricePaise === null
                        ? '—'
                        : formatINR(row.oldPricePaise)}
                    </td>
                    <td className="sa-num">{formatINR(row.newPricePaise)}</td>
                    <td>
                      <span className="sa-chip">{row.source}</span>
                    </td>
                    <td>{row.reason || '—'}</td>
                    <td>{row.changedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="sa-readonly-foot">
        This page is read-only. Search, filters and editing are not enabled in
        this release.
      </p>
    </div>
  );
}

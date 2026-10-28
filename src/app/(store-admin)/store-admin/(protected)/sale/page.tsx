import Link from 'next/link';

import { SaleBulkActions } from '@/components/store-admin/SaleBulkActions';
import { SaleProductRow } from '@/components/store-admin/SaleProductRow';
import { SaleSettingsForm } from '@/components/store-admin/SaleSettingsForm';
import { SaleStatusBadge } from '@/components/store-admin/SaleStatusBadge';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate, formatINR } from '@/lib/store-admin/catalog';
import { getSaleAdminData } from '@/lib/store-admin/sale';
import {
  salePreflight,
  toLocalDateTimeInput,
  type SalePreflightWarning,
} from '@/lib/store-admin/sale-admin-rules';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'all', label: 'All products' },
  { key: 'has-sale', label: 'Has sale price' },
  { key: 'no-sale', label: 'No sale price' },
  { key: 'tracking-off', label: 'Tracking off' },
  { key: 'low-stock', label: 'Low or zero stock' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function parseFilter(value: unknown): FilterKey {
  return FILTERS.some((entry) => entry.key === value) ? (value as FilterKey) : 'all';
}

const WARNING_TEXT: Record<SalePreflightWarning['key'], string> = {
  'tracking-off':
    'have a sale price but stock tracking is off — they can be oversold while the sale is live.',
  'zero-stock':
    'have a sale price but no available units — the sale cannot sell them.',
  'below-cost':
    'have a sale price below cost.',
};

export default async function StoreAdminSalePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = parseFilter(params.filter);

  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const result = await getSaleAdminData();
  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Sale</h1>
        <p className="sa-notice">
          The sale settings table is not available. Apply migration 0039 and try again.
        </p>
      </div>
    );
  }

  const { state, timezone, products } = result.data;
  const preflight = salePreflight(products);
  const startLocal = toLocalDateTimeInput(state.startsAt, timezone);
  const endLocal = toLocalDateTimeInput(state.endsAt, timezone);

  const isLowStock = (available: number | null, threshold: number | null) =>
    available !== null && available <= (threshold ?? 0);

  const matches = (row: (typeof products)[number]): boolean => {
    switch (filter) {
      case 'has-sale':
        return row.salePricePaise !== null;
      case 'no-sale':
        return row.salePricePaise === null;
      case 'tracking-off':
        return !row.tracked;
      case 'low-stock':
        return row.tracked && isLowStock(row.available, row.lowStockThreshold);
      default:
        return true;
    }
  };

  const counts: Record<FilterKey, number> = {
    all: products.length,
    'has-sale': products.filter((row) => row.salePricePaise !== null).length,
    'no-sale': products.filter((row) => row.salePricePaise === null).length,
    'tracking-off': products.filter((row) => !row.tracked).length,
    'low-stock': products.filter(
      (row) => row.tracked && isLowStock(row.available, row.lowStockThreshold),
    ).length,
  };

  const visible = products.filter(matches);

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Sale</h1>
          <p className="sa-page-sub">
            Sale prices are stored per product and apply only while sale mode is live.
          </p>
        </div>
        <SaleStatusBadge status={state.status} />
      </div>

      <div className="sa-detail-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Sale mode</h2>
          <dl className="sa-meta">
            <div>
              <dt>Status</dt>
              <dd>
                <SaleStatusBadge status={state.status} />{' '}
                <span className="sa-hint">
                  decided by the database clock, {timezone}
                </span>
              </dd>
            </div>
            <div>
              <dt>Database time</dt>
              <dd>{formatDate(state.databaseNow)}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>
                {state.startsAt === null && state.endsAt === null
                  ? 'No window — the switch decides'
                  : `${startLocal ? startLocal.replace('T', ' ') : '—'} → ${endLocal ? endLocal.replace('T', ' ') : '—'}`}
              </dd>
            </div>
          </dl>

          <SaleSettingsForm
            enabled={state.enabled}
            startsAt={startLocal}
            endsAt={endLocal}
            timezone={timezone}
            canEdit={canEdit}
          />
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Before you switch on</h2>
          {preflight.withSalePrice === 0 ? (
            <p className="sa-notice">
              No products have a sale price. Setting the mode on changes nothing until
              prices are set below.
            </p>
          ) : (
            <>
              <p className="sa-card-note">
                {preflight.withSalePrice} product
                {preflight.withSalePrice === 1 ? '' : 's'} carry a sale price.
              </p>
              {preflight.warnings.length === 0 ? (
                <p className="sa-notice">No stock or cost warnings for these products.</p>
              ) : (
                <ul className="sa-plain-list">
                  {preflight.warnings.map((entry) => (
                    <li key={entry.key}>
                      <strong>{entry.count}</strong> product
                      {entry.count === 1 ? '' : 's'} {WARNING_TEXT[entry.key]}
                      <span className="sa-row-sub">{entry.names.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      <section className="sa-detail-card">
        <h2 className="sa-card-title">How to start a sale</h2>
        <ol className="sa-plain-list">
          <li>Set a regular price above zero on the product.</li>
          <li>
            Enter a sale price below that regular price here, or use Bulk sale
            prices to take a percent off every product.
          </li>
          <li>
            Review the stock and cost notes. A sale price below cost still
            saves; the warning never blocks it.
          </li>
          <li>
            Switch Sale mode on, or set a window, and confirm the badge says
            SALE LIVE.
          </li>
        </ol>
      </section>

      {canEdit ? <SaleBulkActions productCount={products.length} /> : null}

      <nav className="sa-filter-nav" aria-label="Sale product filters">
        {FILTERS.map((entry) => (
          <Link
            key={entry.key}
            className={`sa-chip${filter === entry.key ? ' is-active' : ''}`}
            href={entry.key === 'all' ? '/store-admin/sale' : `/store-admin/sale?filter=${entry.key}`}
          >
            {entry.label}
            <span className="sa-chip-count">{counts[entry.key]}</span>
          </Link>
        ))}
      </nav>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="sa-num">Regular price</th>
              <th className="sa-num">Sale price</th>
              <th className="sa-num">Discount</th>
              <th>Tracked</th>
              <th className="sa-num">Available</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => (
              <SaleProductRow
                key={product.id}
                productId={product.id}
                name={product.name}
                pricePaise={product.pricePaise}
                priceLabel={formatINR(product.pricePaise)}
                salePricePaise={product.salePricePaise}
                regularSaleLabel={
                  product.salePricePaise === null ? null : formatINR(product.salePricePaise)
                }
                tracked={product.tracked}
                availableLabel={product.available === null ? '—' : String(product.available)}
                lowStock={product.tracked && isLowStock(product.available, product.lowStockThreshold)}
                isActive={product.isActive}
                canEdit={canEdit}
              />
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? <p className="sa-empty">No products match this filter.</p> : null}

      <p className="sa-readonly-foot">
        Checkout always re-prices from the database, so the amount charged is the amount
        this screen stores. Turning the mode off never deletes a stored sale price; the
        regular price is charged until it is switched back on.
      </p>
    </div>
  );
}

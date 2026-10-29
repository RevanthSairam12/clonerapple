import Link from 'next/link';

import { formatPaise } from '@/lib/store-admin/amount';
import { couponScopeLabel, couponValueLabel } from '@/lib/store-admin/coupon-rules';
import { listCoupons } from '@/lib/store-admin/coupons';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'expired', label: 'Expired' },
  { value: 'used-up', label: 'Used up' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
] as const;

const TONE: Record<string, string | undefined> = {
  active: undefined,
  scheduled: 'warn',
  paused: 'warn',
  expired: 'danger',
  'used-up': 'danger',
  archived: 'danger',
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function queryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

/**
 * Coupon list. Search and status filters are evaluated on the database clock,
 * so "Active" here is exactly the set checkout will accept right now.
 */
export default async function StoreAdminCouponsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const search = first(raw.search).trim();
  const status = first(raw.status) || 'all';
  const page = Number.parseInt(first(raw.page) || '1', 10) || 1;

  const result = await listCoupons({ search, status, page, pageSize: 25 });
  const data = result.ok ? result.data : null;

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filterParams = { search, status: status === 'all' ? '' : status };
  const exportHref = `/api/store-admin/coupons/export${queryString(filterParams)}`;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Coupons</h1>
          <p className="sa-page-sub">
            Discount codes, their limits and every use. A code is only accepted while it is
            active, inside its dates and below both its limits.
          </p>
        </div>
        <div className="sa-inline-actions">
          <a className="sa-btn sa-btn-quiet sa-btn-small" href={exportHref} download>
            Export CSV
          </a>
          <Link className="sa-btn sa-btn-small" href="/store-admin/coupons/new">
            New coupon
          </Link>
        </div>
      </div>

      <form className="sa-filter-bar" method="get" action="/store-admin/coupons">
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="coupon-search">Search</label>
          <input
            id="coupon-search"
            className="sa-input"
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Code or name"
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="coupon-status">Status</label>
          <select id="coupon-status" className="sa-input" name="status" defaultValue={status}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sa-filter-actions">
          <button className="sa-btn sa-btn-small" type="submit">Apply</button>
        </div>
      </form>

      {!data ? (
        <p className="sa-notice">
          Coupons could not be read. Check the database connection and that migration 0041 is
          applied.
        </p>
      ) : (
        <>
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Uses</th>
                  <th>Minimum order</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td className="sa-empty" colSpan={8}>
                      {search || status !== 'all'
                        ? 'No coupon matches this search and status.'
                        : 'No coupons yet. Create one to offer a discount at checkout.'}
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          className="sa-product-link"
                          href={`/store-admin/coupons/${encodeURIComponent(row.id)}`}
                        >
                          {row.code}
                        </Link>
                        {row.name ? <div className="sa-hint">{row.name}</div> : null}
                      </td>
                      <td>{couponValueLabel(row.type, row.value)}</td>
                      <td>{couponScopeLabel(row.scope)}</td>
                      <td>
                        <span className="sa-status-chip" data-tone={TONE[row.badge.tone]}>
                          {row.badge.label}
                        </span>
                      </td>
                      <td>
                        {row.used}
                        {row.totalRedemptionLimit === null ? '' : ` / ${row.totalRedemptionLimit}`}
                      </td>
                      <td>{row.minOrderPaise === 0 ? '—' : formatPaise(row.minOrderPaise)}</td>
                      <td>
                        <div>{formatDate(row.startsAt)}</div>
                        <div className="sa-hint">{row.endsAt ? formatDate(row.endsAt) : 'No end'}</div>
                      </td>
                      <td>
                        <Link
                          className="sa-btn sa-btn-quiet sa-btn-small"
                          href={`/store-admin/coupons/${encodeURIComponent(row.id)}`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <nav className="sa-pagination" aria-label="Coupon pages">
            {page > 1 ? (
              <Link
                className="sa-nav-step"
                href={`/store-admin/coupons${queryString({ ...filterParams, page: String(page - 1) })}`}
              >
                ← Previous
              </Link>
            ) : (
              <span className="sa-nav-step sa-nav-step-off">← Previous</span>
            )}
            <span className="sa-page-count">
              {data.total === 0
                ? 'No results'
                : `Showing ${(page - 1) * data.pageSize + 1}–${Math.min(
                    page * data.pageSize,
                    data.total,
                  )} of ${data.total} · page ${page} of ${pageCount}`}
            </span>
            {page < pageCount ? (
              <Link
                className="sa-nav-step"
                href={`/store-admin/coupons${queryString({ ...filterParams, page: String(page + 1) })}`}
              >
                Next →
              </Link>
            ) : (
              <span className="sa-nav-step sa-nav-step-off">Next →</span>
            )}
          </nav>
        </>
      )}

      <p className="sa-readonly-foot">
        Coupons are never deleted. Archiving retires a code and keeps its usage history.
      </p>
    </div>
  );
}

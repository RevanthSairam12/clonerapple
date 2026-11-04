import Link from 'next/link';

import {
  CouponSelectAll,
  CouponSelectionCheckbox,
  CouponVisibilityControls,
} from '@/components/store-admin/CouponVisibilityControls';
import { formatPaise } from '@/lib/store-admin/amount';
import { getStoreSession } from '@/lib/store-admin/auth';
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
  const session = await getStoreSession();
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const raw = await searchParams;
  const search = first(raw.search).trim();
  const status = first(raw.status) || 'all';
  const rawVisibility = first(raw.visibility);
  const visibility = rawVisibility === 'public' || rawVisibility === 'hidden' ? rawVisibility : 'all';
  const page = Math.max(1, Number.parseInt(first(raw.page) || '1', 10) || 1);

  const result = await listCoupons({ search, status, visibility, page, pageSize: 25 });
  const data = result.ok ? result.data : null;

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filterParams = {
    search,
    status: status === 'all' ? '' : status,
    visibility: visibility === 'all' ? '' : visibility,
  };
  const exportHref = `/api/store-admin/coupons/export${queryString(filterParams)}`;
  const selectableCouponIds = data?.rows.filter((row) => row.status !== 'archived').map((row) => row.id) ?? [];

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
          {canEdit ? (
            <Link className="sa-btn sa-btn-small" href="/store-admin/coupons/new">
              New coupon
            </Link>
          ) : null}
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
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="coupon-visibility">Visibility</label>
          <select
            id="coupon-visibility"
            className="sa-input"
            name="visibility"
            defaultValue={visibility}
            aria-describedby="coupon-list-visibility-help"
          >
            <option value="all">All visibility</option>
            <option value="public">Public</option>
            <option value="hidden">Hidden (not public)</option>
          </select>
        </div>
        <div className="sa-filter-actions">
          <button className="sa-btn sa-btn-small" type="submit">Apply</button>
        </div>
      </form>
      <p className="sa-hint" id="coupon-list-visibility-help">
        Visibility controls discovery, not redemption. Hidden means not public; assigned
        eligible customers may still see the coupon, and anyone with its code can redeem it
        unless customer restrictions apply. Assignments never override those restrictions.
      </p>

      {!data ? (
        <p className="sa-notice">
          Coupons could not be read. Check the database connection and that the coupon
          visibility migrations are applied.
        </p>
      ) : (
        <>
          <CouponVisibilityControls
            key={JSON.stringify([filterParams, page, selectableCouponIds])}
            canEdit={canEdit}
            couponIds={selectableCouponIds}
          >
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  {canEdit ? <th scope="col"><CouponSelectAll /></th> : null}
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th scope="col">Visibility</th>
                  <th>Uses</th>
                  <th>Minimum order</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td className="sa-empty" colSpan={canEdit ? 10 : 9}>
                      {search || status !== 'all' || visibility !== 'all'
                        ? 'No coupon matches these filters.'
                        : 'No coupons yet. Create one to offer a discount at checkout.'}
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id}>
                      {canEdit ? <td><CouponSelectionCheckbox id={row.id} code={row.code} /></td> : null}
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
                        <span className="sa-status-chip" data-tone={row.showToAllUsers ? undefined : 'warn'}>
                          {row.showToAllUsers ? 'Public' : 'Hidden'}
                        </span>
                        <div className="sa-hint">
                          {row.assignedToEmails.length} email assignments · {row.assignedCustomerGroups.length} group assignments
                        </div>
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
          </CouponVisibilityControls>

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

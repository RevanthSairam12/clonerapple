import Link from 'next/link';

import { formatDate } from '@/lib/store-admin/catalog';
import {
  CUSTOMER_GROUP_LABELS,
  parseCustomerFilters,
  type CustomerFilters,
} from '@/lib/store-admin/customer-rules';
import { listCustomers } from '@/lib/store-admin/customers';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function queryString(filters: CustomerFilters, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.orders !== 'all') params.set('orders', filters.orders);
  if (filters.fromIso) params.set('from', filters.fromIso.slice(0, 10));
  if (filters.toIso) {
    // toIso is the start of the following day; show the day the operator chose.
    const end = new Date(filters.toIso);
    end.setUTCDate(end.getUTCDate() - 1);
    params.set('to', end.toISOString().slice(0, 10));
  }
  if (filters.minSpend !== null) params.set('min', String(filters.minSpend));
  if (filters.maxSpend !== null) params.set('max', String(filters.maxSpend));
  for (const [key, value] of Object.entries(overrides)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

function money(value: number): string {
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default async function StoreAdminCustomersPage({ searchParams }: Props) {
  const rawParams = await searchParams;
  const parsed = parseCustomerFilters(rawParams);

  if (!parsed.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Customers</h1>
        <p className="sa-error">{parsed.error}</p>
        <Link className="sa-back" href="/store-admin/customers">
          ← Reset filters
        </Link>
      </div>
    );
  }

  const filters = parsed.filters;
  const result = await listCustomers(filters);

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Customers</h1>
        <p className="sa-notice">
          Customer records are not available. Check that the database is
          configured and migrations 0008, 0009, 0015 and 0026 are applied.
        </p>
      </div>
    );
  }

  const { customers, total, page, pageCount, pageSize, summary } = result.data;
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const hasFilters =
    filters.query !== '' ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.orders !== 'all' ||
    filters.fromIso !== null ||
    filters.toIso !== null ||
    filters.minSpend !== null ||
    filters.maxSpend !== null;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Customers</h1>
          <p className="sa-page-sub">
            {summary.registered.toLocaleString('en-IN')} registered ·{' '}
            {summary.guests.toLocaleString('en-IN')} guest checkout buyers ·{' '}
            {summary.blocked.toLocaleString('en-IN')} blocked
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/customers/accounts">
            User accounts
          </Link>
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/customers/subscribers">
            Subscribers
          </Link>
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/customers/settings">
            Customer settings
          </Link>
          <a
            className="sa-btn sa-btn-quiet sa-btn-small"
            href={`/api/store-admin/customers/export${queryString(filters)}`}
          >
            Export CSV
          </a>
        </div>
      </div>

      <form
        className="sa-filter-bar"
        method="get"
        action="/store-admin/customers"
        role="search"
      >
        <div className="sa-filter-field sa-filter-wide">
          <label className="sa-label" htmlFor="customer-search">Search</label>
          <input
            id="customer-search"
            className="sa-input"
            type="search"
            name="q"
            defaultValue={filters.query}
            placeholder="Name or email"
            autoComplete="off"
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-type">Type</label>
          <select id="customer-type" name="type" defaultValue={filters.type} className="sa-input">
            <option value="all">All</option>
            <option value="registered">Registered</option>
            <option value="guest">Guest</option>
          </select>
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-status">Status</label>
          <select id="customer-status" name="status" defaultValue={filters.status} className="sa-input">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-orders">Orders</label>
          <select id="customer-orders" name="orders" defaultValue={filters.orders} className="sa-input">
            <option value="all">Any</option>
            <option value="yes">Has orders</option>
            <option value="no">No orders</option>
          </select>
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-from">Joined / first order from</label>
          <input
            id="customer-from"
            className="sa-input"
            type="date"
            name="from"
            defaultValue={filters.fromIso ? filters.fromIso.slice(0, 10) : ''}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-to">to</label>
          <input
            id="customer-to"
            className="sa-input"
            type="date"
            name="to"
            defaultValue={
              filters.toIso
                ? (() => {
                    const end = new Date(filters.toIso);
                    end.setUTCDate(end.getUTCDate() - 1);
                    return end.toISOString().slice(0, 10);
                  })()
                : ''
            }
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-min">Min spend</label>
          <input
            id="customer-min"
            className="sa-input"
            type="text"
            inputMode="decimal"
            name="min"
            defaultValue={filters.minSpend === null ? '' : String(filters.minSpend)}
            placeholder="₹0"
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="customer-max">Max spend</label>
          <input
            id="customer-max"
            className="sa-input"
            type="text"
            inputMode="decimal"
            name="max"
            defaultValue={filters.maxSpend === null ? '' : String(filters.maxSpend)}
            placeholder="No limit"
          />
        </div>
        <div className="sa-filter-actions">
          <button type="submit" className="sa-btn sa-btn-primary sa-btn-small">Apply</button>
          {hasFilters ? (
            <Link className="sa-back sa-back-inline" href="/store-admin/customers">Clear</Link>
          ) : null}
        </div>
      </form>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Type</th>
              <th>Joined</th>
              <th className="sa-num">Orders</th>
              <th className="sa-num">Lifetime value</th>
              <th>Last order</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer, index) => (
              <tr key={customer.id ?? `guest-${index}`}>
                <td>
                  {customer.id ? (
                    <Link
                      className="sa-product-link"
                      href={`/store-admin/customers/${encodeURIComponent(customer.id)}`}
                    >
                      {customer.name}
                    </Link>
                  ) : (
                    <span className="sa-row-strong">Guest buyer</span>
                  )}
                  <span className="sa-row-sub">{customer.emailMasked}</span>
                  <span className="sa-row-sub">{customer.phoneMasked}</span>
                </td>
                <td>
                  {customer.kind === 'guest' ? (
                    <span className="sa-pill">Guest</span>
                  ) : (
                    <span className="sa-pill">
                      {CUSTOMER_GROUP_LABELS[customer.group] ?? 'Retail'}
                    </span>
                  )}
                </td>
                <td className="sa-date">{formatDate(customer.joinedAt)}</td>
                <td className="sa-num">{customer.orderCount}</td>
                <td className="sa-num">{money(customer.lifetimeValue)}</td>
                <td className="sa-date">
                  {customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}
                </td>
                <td>
                  <span
                    className={
                      customer.status === 'blocked'
                        ? 'sa-status sa-status-danger'
                        : 'sa-status sa-status-done'
                    }
                  >
                    {customer.status === 'blocked' ? 'Blocked' : 'Active'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {customers.length === 0 ? (
        <p className="sa-empty">
          {hasFilters
            ? 'No customers match these filters.'
            : 'No customer accounts yet.'}
        </p>
      ) : null}

      {filters.type !== 'registered' && customers.some((row) => row.kind === 'guest') ? (
        <p className="sa-lock-note">
          Guest rows are orders placed without an account, grouped by email.
          They have no account to open; use Sales → Orders for the individual
          orders.
        </p>
      ) : null}

      <nav className="sa-pagination" aria-label="Customer pages">
        {page > 1 ? (
          <Link className="sa-nav-step" href={`/store-admin/customers${queryString(filters, { page: String(page - 1) })}`}>
            ← Previous
          </Link>
        ) : (
          <span className="sa-nav-step sa-nav-step-off">← Previous</span>
        )}

        <span className="sa-page-count">
          {total === 0
            ? 'No results'
            : `Showing ${firstRow}–${lastRow} of ${total} · page ${page} of ${pageCount}`}
        </span>

        {page < pageCount ? (
          <Link className="sa-nav-step" href={`/store-admin/customers${queryString(filters, { page: String(page + 1) })}`}>
            Next →
          </Link>
        ) : (
          <span className="sa-nav-step sa-nav-step-off">Next →</span>
        )}
      </nav>

      <p className="sa-readonly-foot">
        Contacts are masked for every role. Revealing a full email or phone is
        owner-only, needs a reason and is written to the audit log. The CSV
        export is masked too.
      </p>
    </div>
  );
}

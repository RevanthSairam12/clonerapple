import Link from 'next/link';

import { formatDate } from '@/lib/store-admin/catalog';
import {
  CUSTOMERS_PAGE_SIZE,
  listCustomers,
} from '@/lib/store-admin/customers';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>;
}

function pageHref(page: number, query: string): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  const suffix = params.toString();
  return suffix ? `/store-admin/customers?${suffix}` : '/store-admin/customers';
}

export default async function StoreAdminCustomersPage({ searchParams }: Props) {
  const { q, page } = await searchParams;
  const parsedPage = Number.parseInt(page ?? '1', 10);

  const result = await listCustomers({
    query: q ?? '',
    page: Number.isFinite(parsedPage) ? parsedPage : 1,
  });

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Customers</h1>
        <p className="sa-notice">
          Customer records are not available. Check that the database is
          configured and migrations 0008 and 0009 are applied.
        </p>
      </div>
    );
  }

  const { customers, total, page: currentPage, pageCount, query } = result.data;
  const firstRow = total === 0 ? 0 : (currentPage - 1) * CUSTOMERS_PAGE_SIZE + 1;
  const lastRow = Math.min(currentPage * CUSTOMERS_PAGE_SIZE, total);

  return (
    <div>
      <h1 className="sa-page-title">Customers</h1>
      <p className="sa-page-sub">
        Read-only customer directory — {total} {total === 1 ? 'account' : 'accounts'}.
        Contact details are masked for every role.
      </p>

      <form
        className="sa-search"
        method="get"
        action="/store-admin/customers"
        role="search"
      >
        <label className="sa-label" htmlFor="customer-search">
          Search by name or email
        </label>
        <div className="sa-search-row">
          <input
            id="customer-search"
            className="sa-input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Name or email"
            autoComplete="off"
          />
          <button type="submit" className="sa-btn sa-btn-quiet">
            Search
          </button>
          {query ? (
            <Link className="sa-back sa-back-inline" href="/store-admin/customers">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Joined</th>
              <th className="sa-num">Orders</th>
              <th>Last order</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <Link
                    className="sa-product-link"
                    href={`/store-admin/customers/${encodeURIComponent(customer.id)}`}
                  >
                    {customer.name}
                  </Link>
                  <span className="sa-row-sub">{customer.emailMasked}</span>
                  <span className="sa-row-sub">{customer.phoneMasked}</span>
                </td>
                <td className="sa-date">{formatDate(customer.joinedAt)}</td>
                <td className="sa-num">{customer.orderCount}</td>
                <td className="sa-date">
                  {customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {customers.length === 0 ? (
        <p className="sa-empty">
          {query
            ? 'No customers match this search.'
            : 'No customer accounts yet.'}
        </p>
      ) : null}

      <nav className="sa-pagination" aria-label="Customer pages">
        {currentPage > 1 ? (
          <Link className="sa-nav-step" href={pageHref(currentPage - 1, query)}>
            ← Previous
          </Link>
        ) : (
          <span className="sa-nav-step sa-nav-step-off">← Previous</span>
        )}

        <span className="sa-page-count">
          {total === 0
            ? 'No results'
            : `Showing ${firstRow}–${lastRow} of ${total} · page ${currentPage} of ${pageCount}`}
        </span>

        {currentPage < pageCount ? (
          <Link className="sa-nav-step" href={pageHref(currentPage + 1, query)}>
            Next →
          </Link>
        ) : (
          <span className="sa-nav-step sa-nav-step-off">Next →</span>
        )}
      </nav>

      <p className="sa-readonly-foot">
        This page is read-only. Revealing a full email or phone is owner-only and
        is written to the audit log.
      </p>
    </div>
  );
}

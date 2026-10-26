import Link from 'next/link';

import { formatDate } from '@/lib/store-admin/catalog';
import { listAccounts } from '@/lib/store-admin/customer-accounts';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

function pageHref(query: string, status: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status && status !== 'all') params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const suffix = params.toString();
  return suffix ? `/store-admin/customers/accounts?${suffix}` : '/store-admin/customers/accounts';
}

export default async function StoreAdminAccountsPage({ searchParams }: Props) {
  const { q, status: rawStatus, page } = await searchParams;
  const status =
    rawStatus === 'active' || rawStatus === 'blocked' ? rawStatus : 'all';
  const parsedPage = Number.parseInt(page ?? '1', 10);

  const result = await listAccounts({
    query: q ?? '',
    status,
    page: Number.isFinite(parsedPage) ? parsedPage : 1,
  });

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">User accounts</h1>
        <p className="sa-notice">
          Account records are not available. Check that the database is
          configured and migration 0026 is applied.
        </p>
      </div>
    );
  }

  const data = result.data;
  const firstRow = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastRow = Math.min(data.page * data.pageSize, data.total);

  return (
    <div>
      <Link className="sa-back" href="/store-admin/customers">
        ← Customers
      </Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">User accounts</h1>
          <p className="sa-page-sub">
            Sign-in state for registered storefront accounts — sessions, last
            login and account status.
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link
            className="sa-btn sa-btn-quiet sa-btn-small"
            href="/store-admin/customers/subscribers"
          >
            Subscribers
          </Link>
          <Link
            className="sa-btn sa-btn-quiet sa-btn-small"
            href="/store-admin/customers/settings"
          >
            Customer settings
          </Link>
        </div>
      </div>

      <form className="sa-search" method="get" action="/store-admin/customers/accounts" role="search">
        <label className="sa-label" htmlFor="account-search">Search by name or email</label>
        <div className="sa-search-row">
          <input
            id="account-search"
            className="sa-input"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name or email"
            autoComplete="off"
          />
          <select className="sa-input" name="status" defaultValue={status} aria-label="Account status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
          <button type="submit" className="sa-btn sa-btn-quiet">Search</button>
          {q || status !== 'all' ? (
            <Link className="sa-back sa-back-inline" href="/store-admin/customers/accounts">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Joined</th>
              <th>Last login</th>
              <th className="sa-num">Sessions</th>
              <th className="sa-num">Orders</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <Link
                    className="sa-product-link"
                    href={`/store-admin/customers/${encodeURIComponent(account.id)}`}
                  >
                    {account.name}
                  </Link>
                  <span className="sa-row-sub">{account.emailMasked}</span>
                </td>
                <td className="sa-date">{formatDate(account.joinedAt)}</td>
                <td className="sa-date">
                  {account.lastLoginAt ? formatDate(account.lastLoginAt) : 'Never'}
                </td>
                <td className="sa-num">{account.sessionCount}</td>
                <td className="sa-num">{account.orderCount}</td>
                <td>
                  <span
                    className={
                      account.status === 'blocked'
                        ? 'sa-status sa-status-danger'
                        : 'sa-status sa-status-done'
                    }
                  >
                    {account.status === 'blocked' ? 'Blocked' : 'Active'}
                  </span>
                </td>
                <td>
                  <Link
                    className="sa-back sa-back-inline"
                    href={`/store-admin/customers/${encodeURIComponent(account.id)}?tab=security`}
                  >
                    Sessions →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.accounts.length === 0 ? (
        <p className="sa-empty">
          {q || status !== 'all'
            ? 'No accounts match these filters.'
            : 'No registered accounts yet.'}
        </p>
      ) : null}

      <nav className="sa-pagination" aria-label="Account pages">
        {data.page > 1 ? (
          <Link className="sa-nav-step" href={pageHref(data.query, status, data.page - 1)}>
            ← Previous
          </Link>
        ) : (
          <span className="sa-nav-step sa-nav-step-off">← Previous</span>
        )}
        <span className="sa-page-count">
          {data.total === 0
            ? 'No results'
            : `Showing ${firstRow}–${lastRow} of ${data.total} · page ${data.page} of ${data.pageCount}`}
        </span>
        {data.page < data.pageCount ? (
          <Link className="sa-nav-step" href={pageHref(data.query, status, data.page + 1)}>
            Next →
          </Link>
        ) : (
          <span className="sa-nav-step sa-nav-step-off">Next →</span>
        )}
      </nav>

      <p className="sa-readonly-foot">
        Emails are masked. Session ids are a short hash prefix, not a usable
        token. Revoking a session signs that device out immediately.
      </p>
    </div>
  );
}

import Link from 'next/link';

import { AddSubscriberForm } from '@/components/store-admin/AddSubscriberForm';
import { SubscriberRowActions } from '@/components/store-admin/SubscriberRowActions';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate } from '@/lib/store-admin/catalog';
import {
  SUBSCRIBER_SOURCE_LABELS,
  type SubscriberSource,
} from '@/lib/store-admin/customer-rules';
import { isSubscriberStatus, listSubscribers } from '@/lib/store-admin/subscribers';

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
  return suffix ? `/store-admin/customers/subscribers?${suffix}` : '/store-admin/customers/subscribers';
}

export default async function StoreAdminSubscribersPage({ searchParams }: Props) {
  const { q, status: rawStatus, page } = await searchParams;
  const status = isSubscriberStatus(rawStatus) ? rawStatus : 'all';
  const parsedPage = Number.parseInt(page ?? '1', 10);

  const [session, result] = await Promise.all([
    getStoreSession(),
    listSubscribers({
      query: q ?? '',
      status,
      page: Number.isFinite(parsedPage) ? parsedPage : 1,
    }),
  ]);

  const canEdit = session?.role !== 'store_viewer';
  const canExport = session?.role === 'store_owner';

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Subscribers</h1>
        <p className="sa-notice">
          Subscriber records are not available. Check that the database is
          configured and migration 0026 is applied.
        </p>
      </div>
    );
  }

  const data = result.data;
  const firstRow = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastRow = Math.min(data.page * data.pageSize, data.total);
  const exportHref = `/api/store-admin/subscribers/export${status === 'all' ? '' : `?status=${status}`}`;

  return (
    <div>
      <Link className="sa-back" href="/store-admin/customers">
        ← Customers
      </Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Subscribers</h1>
          <p className="sa-page-sub">
            {data.counts.subscribed.toLocaleString('en-IN')} subscribed ·{' '}
            {data.counts.unsubscribed.toLocaleString('en-IN')} unsubscribed.
            Consent is recorded at opt-in.
          </p>
        </div>
        {canExport ? (
          <a className="sa-btn sa-btn-quiet sa-btn-small" href={exportHref}>
            Export full addresses
          </a>
        ) : null}
      </div>

      {canEdit ? <AddSubscriberForm /> : null}

      <div className="sa-chip-row">
        {[
          { key: 'all', label: 'All', count: data.counts.subscribed + data.counts.unsubscribed },
          { key: 'subscribed', label: 'Subscribed', count: data.counts.subscribed },
          { key: 'unsubscribed', label: 'Unsubscribed', count: data.counts.unsubscribed },
        ].map((chip) => (
          <Link
            key={chip.key}
            href={pageHref(data.query, chip.key, 1)}
            className={`sa-chip${status === chip.key ? ' is-active' : ''}`}
          >
            {chip.label}
            <span className="sa-chip-count">{chip.count}</span>
          </Link>
        ))}
      </div>

      <form className="sa-search" method="get" action="/store-admin/customers/subscribers" role="search">
        <label className="sa-label" htmlFor="subscriber-search">Search by email</label>
        <div className="sa-search-row">
          <input
            id="subscriber-search"
            className="sa-input"
            type="search"
            name="q"
            defaultValue={data.query}
            placeholder="Email"
            autoComplete="off"
          />
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" className="sa-btn sa-btn-quiet">Search</button>
          {data.query ? (
            <Link className="sa-back sa-back-inline" href={pageHref('', status, 1)}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Source</th>
              <th>Subscribed</th>
              <th>Status</th>
              {canEdit ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {data.subscribers.map((subscriber) => (
              <tr key={subscriber.id}>
                <td className="sa-mono">{subscriber.emailMasked}</td>
                <td>{SUBSCRIBER_SOURCE_LABELS[subscriber.source as SubscriberSource] ?? subscriber.source}</td>
                <td className="sa-date">{formatDate(subscriber.subscribedAt)}</td>
                <td>
                  <span
                    className={
                      subscriber.unsubscribedAt
                        ? 'sa-status sa-status-danger'
                        : 'sa-status sa-status-done'
                    }
                  >
                    {subscriber.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'}
                  </span>
                </td>
                {canEdit ? (
                  <td>
                    <SubscriberRowActions
                      subscriberId={subscriber.id}
                      subscribed={subscriber.unsubscribedAt === null}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.subscribers.length === 0 ? (
        <p className="sa-empty">
          {data.query ? 'No subscribers match this search.' : 'No subscribers yet.'}
        </p>
      ) : null}

      <nav className="sa-pagination" aria-label="Subscriber pages">
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
        Emails stay masked here. The full-address CSV is owner-only and is
        written to the audit log.
      </p>
    </div>
  );
}

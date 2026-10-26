import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getStoreSession } from '@/lib/store-admin/auth';
import { listAuditFacets, listAuditLog, parseAuditFilters } from '@/lib/store-admin/audit-log';

export const dynamic = 'force-dynamic';

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN');
}

function paramString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function jsonPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default async function StoreAdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');
  if (session.role === 'store_viewer') redirect('/store-admin');

  const params = await searchParams;
  const parsed = parseAuditFilters({
    actor: paramString(params.actor),
    action: paramString(params.action),
    entity: paramString(params.entity),
    entityId: paramString(params.entityId),
    from: paramString(params.from),
    to: paramString(params.to),
    page: paramString(params.page),
  });

  if (!parsed.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Audit log</h1>
        <p className="sa-error" role="alert">{parsed.error}</p>
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/audit-log">Reset filters</Link>
      </div>
    );
  }

  const [result, facets] = await Promise.all([
    listAuditLog(parsed.filters),
    listAuditFacets(),
  ]);
  const filters = parsed.filters;

  const query = new URLSearchParams();
  if (filters.actor) query.set('actor', filters.actor);
  if (filters.action) query.set('action', filters.action);
  if (filters.entity) query.set('entity', filters.entity);
  if (filters.entityId) query.set('entityId', filters.entityId);
  query.set('from', filters.fromDay);
  query.set('to', filters.toDay);

  const exportHref = `/api/store-admin/audit/export?${query.toString()}`;

  function pageHref(page: number): string {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/store-admin/audit-log?${next.toString()}`;
  }

  return (
    <div>
      <h1 className="sa-page-title">Audit log</h1>
      <p className="sa-page-sub">
        Every privileged action, newest first. Rows are append-only: nothing here can be edited or
        deleted, and emails are masked while IP addresses and browsers are stored as hashes.
      </p>

      <form className="sa-filter-bar" method="get" action="/store-admin/audit-log">
        <label className="sa-filter-field">
          <span className="sa-label">From</span>
          <input className="sa-input" type="date" name="from" defaultValue={filters.fromDay} />
        </label>
        <label className="sa-filter-field">
          <span className="sa-label">To</span>
          <input className="sa-input" type="date" name="to" defaultValue={filters.toDay} />
        </label>
        <label className="sa-filter-field">
          <span className="sa-label">Actor</span>
          <input
            className="sa-input"
            name="actor"
            defaultValue={filters.actor}
            placeholder="Staff id or email"
            maxLength={120}
          />
        </label>
        <label className="sa-filter-field">
          <span className="sa-label">Action</span>
          <select className="sa-input" name="action" defaultValue={filters.action}>
            <option value="">All actions</option>
            {facets.ok
              ? facets.data.actions.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.value} ({action.count})
                  </option>
                ))
              : null}
          </select>
        </label>
        <label className="sa-filter-field">
          <span className="sa-label">Entity</span>
          <select className="sa-input" name="entity" defaultValue={filters.entity}>
            <option value="">All entities</option>
            {facets.ok
              ? facets.data.entities.map((entity) => (
                  <option key={entity.value} value={entity.value}>
                    {entity.value} ({entity.count})
                  </option>
                ))
              : null}
          </select>
        </label>
        <label className="sa-filter-field">
          <span className="sa-label">Entity id</span>
          <input
            className="sa-input"
            name="entityId"
            defaultValue={filters.entityId}
            placeholder="Order, product, staff…"
            maxLength={120}
          />
        </label>
        <div className="sa-filter-actions">
          <button className="sa-btn sa-btn-primary" type="submit">Apply</button>
          <Link className="sa-btn sa-btn-quiet" href="/store-admin/audit-log">Reset</Link>
          <a className="sa-btn sa-btn-quiet" href={exportHref}>Export CSV</a>
        </div>
      </form>

      {result.ok ? (
        <>
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.data.rows.map((row) => (
                  <tr key={row.id} className={row.status === 'denied' ? 'sa-row-muted' : undefined}>
                    <td>{formatWhen(row.createdAt)}</td>
                    <td>
                      {row.actorEmail || 'System'}
                      {row.actorId ? <span className="sa-row-sub sa-mono">{row.actorId}</span> : null}
                    </td>
                    <td className="sa-mono">{row.action}</td>
                    <td>
                      {row.entity}
                      {row.entityId ? <span className="sa-row-sub sa-mono">{row.entityId}</span> : null}
                    </td>
                    <td>
                      <span
                        className={
                          row.status === 'ok'
                            ? 'sa-status sa-status-on'
                            : row.status === 'denied'
                              ? 'sa-status sa-status-warn'
                              : 'sa-status'
                        }
                      >
                        {row.status}
                      </span>
                      {row.reason ? <span className="sa-row-sub">{row.reason}</span> : null}
                    </td>
                    <td>
                      <details className="sa-quickview">
                        <summary className="sa-table-link">View</summary>
                        <div className="sa-note-body">
                          <p className="sa-note">
                            Route {row.route || '—'}
                            {row.requestId ? ` · request ${row.requestId}` : ''}
                          </p>
                          <p className="sa-label">Before</p>
                          <pre className="sa-mono sa-note-body">{jsonPreview(row.before)}</pre>
                          <p className="sa-label">After</p>
                          <pre className="sa-mono sa-note-body">{jsonPreview(row.after)}</pre>
                          <p className="sa-note sa-mono">
                            IP hash {row.ipHash ?? '—'}
                            <br />
                            Browser hash {row.userAgentHash ?? '—'}
                          </p>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.data.rows.length === 0 ? (
              <p className="sa-empty">No audit rows match these filters.</p>
            ) : null}
          </div>

          <div className="sa-pagination">
            <span className="sa-page-count">
              {result.data.total.toLocaleString('en-IN')} rows · page {result.data.page} of{' '}
              {result.data.pageCount}
            </span>
            {result.data.page > 1 ? (
              <Link className="sa-btn sa-btn-small sa-btn-quiet" href={pageHref(result.data.page - 1)}>
                ← Newer
              </Link>
            ) : null}
            {result.data.page < result.data.pageCount ? (
              <Link className="sa-btn sa-btn-small sa-btn-quiet" href={pageHref(result.data.page + 1)}>
                Older →
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <p className="sa-notice">
          The audit log is not available. Apply migration 0029 and check the database connection.
        </p>
      )}

      <p className="sa-readonly-foot">
        The export carries at most 5,000 rows and is itself audited. There is no update or delete
        path, by database trigger.
      </p>
    </div>
  );
}

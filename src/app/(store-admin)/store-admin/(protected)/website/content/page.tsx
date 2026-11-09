import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getStoreTimeZone } from '@/lib/store-admin/store-clock';
import { getStoreSession } from '@/lib/store-admin/auth';
import { isEducationStoreEnabled } from '@/lib/storefront/education-store';
import { COLLECTIONS } from '@/lib/website/collections';
import { listContentOverrides } from '@/lib/website/content-store';
import { canEditWebsite, WEBSITE_EDIT_ROLES } from '@/lib/website/permissions';

export const dynamic = 'force-dynamic';

function formatWhen(value: string, timeZone: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Every editable storefront section in one table.
 *
 * "Defaults" means the site renders its coded content; "Edited" means a saved
 * override drives the page. Reset archives the override, it never deletes it.
 */
export default async function StoreAdminWebsiteContentPage() {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  const [overrides, timeZone] = await Promise.all([listContentOverrides(), getStoreTimeZone()]);
  const rows = new Map(
    (overrides.ok ? overrides.data : []).map((row) => [row.key, row] as const),
  );
  const canEdit = canEditWebsite(session.role);
  const visibleCollections = isEducationStoreEnabled()
    ? COLLECTIONS
    : COLLECTIONS.filter((collection) => !collection.key.startsWith('edu.'));

  return (
    <div>
      <Link className="sa-back" href="/store-admin/website">← Website</Link>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Content</h1>
          <p className="sa-page-sub">
            Every section of the storefront that can be edited here. Saved edits are live
            immediately; sections without an edit show the site&rsquo;s built-in content.
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/website/theme">
            Theme &amp; fonts
          </Link>
        </div>
      </div>

      {!canEdit ? (
        <p className="sa-note">
          Only {WEBSITE_EDIT_ROLES.map((role) => role.replace('store_', 'store ')).join(', ')} can
          change the website. You can open any section to read its current values.
        </p>
      ) : null}

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>Page</th>
              <th>Status</th>
              <th>Last edited</th>
              <th>By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleCollections.map((collection) => {
              const row = rows.get(collection.key);
              const edited = Boolean(row && !row.archived);
              return (
                <tr key={collection.key}>
                  <td>
                    <span className="sa-row-strong">{collection.label}</span>
                    <span className="sa-row-sub sa-mono">{collection.key}</span>
                  </td>
                  <td className="sa-mono">{collection.sitePaths[0] ?? '—'}</td>
                  <td>
                    <span className={edited ? 'sa-status sa-status-on' : 'sa-status'}>
                      {edited ? 'Edited' : 'Defaults'}
                    </span>
                  </td>
                  <td>{edited ? formatWhen(row?.updatedAt ?? '', timeZone) : '—'}</td>
                  <td>{edited ? row?.updatedBy ?? '—' : '—'}</td>
                  <td>
                    <Link
                      className="sa-btn sa-btn-small sa-btn-quiet"
                      href={`/store-admin/website/content/${encodeURIComponent(collection.key)}`}
                    >
                      {canEdit ? 'Edit' : 'View'}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!overrides.ok ? (
        <p className="sa-warning">
          Saved edits could not be read from the database, so every section is shown as defaults.
        </p>
      ) : null}

      <p className="sa-readonly-foot">
        A reset archives the saved row and leaves it in the database. Saving the section again
        restores your content without a separate backup.
      </p>
    </div>
  );
}

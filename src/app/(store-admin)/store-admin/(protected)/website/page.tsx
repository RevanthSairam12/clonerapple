import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getStoreTimeZone } from '@/lib/store-admin/store-clock';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getThemeSettings } from '@/lib/content';
import { isEducationStoreEnabled } from '@/lib/storefront/education-store';
import { COLLECTIONS, THEME_FIELDS } from '@/lib/website/collections';
import { listContentOverrides, listThemeOverrides } from '@/lib/website/content-store';
import { canEditWebsite } from '@/lib/website/permissions';

export const dynamic = 'force-dynamic';

const SITE_LABELS: Record<string, string> = {
  '/': 'Gadzio homepage',
  '/android': 'OPPO India (legacy)',
  '/in-edu/store': 'Education Store (deferred)',
  '/in/shop/iphone/accessories/cases-protection': 'Cases & protection',
};

function formatWhen(value: string, timeZone: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-IN', { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Website overview — the entry point for storefront content, theme and media.
 *
 * Reads the same content layer the storefront uses, so the counts and
 * "last edited" values are the truth, not a cached copy.
 */
export default async function StoreAdminWebsitePage() {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  const [overrides, themeOverrides, themeValues, timeZone] = await Promise.all([
    listContentOverrides(),
    listThemeOverrides(),
    getThemeSettings(),
    getStoreTimeZone(),
  ]);

  const editedKeys = new Set(
    overrides.ok ? overrides.data.filter((row) => !row.archived).map((row) => row.key) : [],
  );
  const editedTheme = new Set(themeOverrides.ok ? themeOverrides.data.map((row) => row.key) : []);
  const rows = overrides.ok ? overrides.data : [];
  const lastChange = rows
    .filter((row) => !row.archived)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  const themeSaved = Object.keys(themeValues).length;
  const canEdit = canEditWebsite(session.role);

  const visibleCollections = isEducationStoreEnabled()
    ? COLLECTIONS
    : COLLECTIONS.filter((collection) => !collection.key.startsWith('edu.'));

  const bySite = new Map<string, typeof visibleCollections>();
  for (const collection of visibleCollections) {
    const site = collection.sitePaths[0] ?? 'Other';
    const list = bySite.get(site) ?? [];
    list.push(collection);
    bySite.set(site, list);
  }

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Website</h1>
          <p className="sa-page-sub">
            The text, imagery and theme of the storefront. Every save is live at once and is
            recorded in the audit log; nothing here touches products, prices, stock or orders.
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/">
            View storefront ↗
          </Link>
          {canEdit ? (
            <Link className="sa-btn sa-btn-primary sa-btn-small" href="/store-admin/website/content">
              Edit content
            </Link>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <p className="sa-note">
          You can read every value here. Only the store owner can change what customers see.
        </p>
      ) : null}

      {!overrides.ok ? (
        <p className="sa-warning">
          The database could not be read, so editing is unavailable. Check the database connection
          and try again.
        </p>
      ) : null}

      <div className="sa-stat-grid">
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Content sections</span>
          </div>
          <p className="sa-stat-value">{visibleCollections.length}</p>
          <span className="sa-stat-meta">{editedKeys.size} edited from defaults</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Theme values</span>
          </div>
          <p className="sa-stat-value">{THEME_FIELDS.length}</p>
          <span className="sa-stat-meta">{editedTheme.size} changed from defaults</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Theme rows saved</span>
          </div>
          <p className="sa-stat-value">{themeSaved}</p>
          <span className="sa-stat-meta">fonts, colours, logo and copyright</span>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-top">
            <span className="sa-stat-label">Last content edit</span>
          </div>
          <p className="sa-stat-value">{lastChange ? formatWhen(lastChange.updatedAt, timeZone) : 'Never'}</p>
          <span className="sa-stat-meta">{lastChange?.updatedBy ?? 'No saved overrides yet'}</span>
        </div>
      </div>

      <section className="sa-report-section">
        <div className="sa-report-heading">
          <h2 className="sa-section-title">Content</h2>
          <p className="sa-card-note">
            One card per editable section. A section without a saved edit shows exactly what the
            site renders today; saving creates an override, and Reset returns to the coded default.
          </p>
        </div>

        {[...bySite.entries()].map(([site, collections]) => {
          const edited = collections.filter((collection) => editedKeys.has(collection.key)).length;
          return (
            <div key={site} className="sa-report-section">
              <div className="sa-report-heading">
                <h3 className="sa-section-title">{SITE_LABELS[site] ?? site}</h3>
                <p className="sa-card-note">
                  <span className="sa-mono">{site}</span> · {edited} of {collections.length} edited
                </p>
              </div>
              <div className="sa-report-grid">
                {collections.map((collection) => (
                  <Link
                    className="sa-report-card"
                    key={collection.key}
                    href={`/store-admin/website/content/${encodeURIComponent(collection.key)}`}
                  >
                    <span className="sa-report-kicker">
                      {editedKeys.has(collection.key) ? 'Edited' : 'Defaults'}
                    </span>
                    <h3 className="sa-report-title">{collection.label}</h3>
                    {collection.description ? (
                      <p className="sa-report-desc">{collection.description}</p>
                    ) : null}
                    <span className="sa-report-open">Open section →</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="sa-detail-section">
        <h2 className="sa-section-title">Also part of the website</h2>
        <div className="sa-hub-grid">
          <Link className="sa-hub-card" href="/store-admin/website/theme">
            <h3 className="sa-card-title">Theme &amp; fonts</h3>
            <p className="sa-card-note">
              Site-wide font, colours, logo text and the footer copyright line.
            </p>
          </Link>
          <Link className="sa-hub-card" href="/store-admin/media">
            <h3 className="sa-card-title">Media library</h3>
            <p className="sa-card-note">
              Images and video used by website sections and the catalogue. Uploads are checked by
              content, not by file name.
            </p>
          </Link>
          <Link className="sa-hub-card" href="/store-admin/audit-log">
            <h3 className="sa-card-title">Audit log</h3>
            <p className="sa-card-note">
              Who saved which section and when. Append-only; no secret or customer detail is stored.
            </p>
          </Link>
          <Link className="sa-hub-card" href="/store-admin/settings">
            <h3 className="sa-card-title">Pages &amp; SEO</h3>
            <p className="sa-card-note">
              Static pages and store-wide SEO live with the rest of the store settings.
            </p>
          </Link>
        </div>
      </section>

      <p className="sa-readonly-foot">
        The storefront reads these values directly, so a save is visible immediately. Resetting
        archives the saved row instead of deleting it — saving again restores your content.
      </p>
    </div>
  );
}

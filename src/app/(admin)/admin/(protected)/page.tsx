import Link from 'next/link';

import { COLLECTIONS } from '@/lib/admin/collections';
import { getSql } from '@/lib/admin/db';
import { getSession } from '@/lib/admin/auth';

export const dynamic = 'force-dynamic';

const SITE_LABELS: Record<string, { label: string; icon: string }> = {
  '/': { label: 'Gadzio Homepage', icon: '' },
  '/android': { label: 'OPPO India', icon: '📱' },
  '/in-edu/store': { label: 'Education Store', icon: '🎓' },
  '/in/shop/iphone/accessories/cases-protection': { label: 'Cases & Protection', icon: '🛡️' },
};

export default async function AdminDashboard() {
  const session = await getSession();
  const sql = getSql();
  const dbConfigured = Boolean(sql);

  let editedKeys: Set<string> = new Set();
  if (sql) {
    try {
      const rows = await sql`select key from content_blocks`;
      editedKeys = new Set(rows.map((r) => r.key));
    } catch {
      editedKeys = new Set();
    }
  }

  const bySite = new Map<string, typeof COLLECTIONS>();
  for (const c of COLLECTIONS) {
    const site = c.sitePaths[0] ?? 'Other';
    const list = bySite.get(site) ?? [];
    list.push(c);
    bySite.set(site, list);
  }

  const totalEdited = editedKeys.size;

  return (
    <div>
      <div className="admin-topbar">
        <div>
          <h1 className="admin-topbar-title">Content Overview</h1>
          <p className="admin-topbar-sub">
            {totalEdited} of {COLLECTIONS.length} collections edited
            {!dbConfigured ? ' — ⚠ DATABASE_URL missing; edits cannot be saved' : ''}
          </p>
        </div>
        <div className="admin-topbar-actions">
          <Link href="/admin/theme" className="admin-btn admin-btn-secondary">
            🎨 Theme &amp; Fonts
          </Link>
        </div>
      </div>

      <div className="admin-content">
        {!dbConfigured ? (
          <div className="admin-notice admin-notice-warn">
            <span>⚠️</span>
            <span>No database connection. You can browse the current content, but saving is disabled. Add <code>DATABASE_URL</code> to <code>.env.local</code>.</span>
          </div>
        ) : null}

        {[...bySite.entries()].map(([site, collections]) => {
          const meta = SITE_LABELS[site] ?? { label: site, icon: '📄' };
          const edited = collections.filter((c) => editedKeys.has(c.key)).length;
          return (
            <section key={site} className="admin-dash-section">
              <div className="admin-dash-heading">
                <h2 className="admin-dash-heading-title">
                  {meta.icon} {meta.label}
                </h2>
                <span className="admin-dash-heading-path">{site}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: edited > 0 ? '#0071e3' : '#a1a1a6', fontWeight: 600 }}>
                  {edited}/{collections.length} edited
                </span>
              </div>
              <div className="admin-dash-grid">
                {collections.map((c) => (
                  <Link key={c.key} href={`/admin/content/${c.key}`} className="admin-dash-card">
                    <div className="admin-dash-card-top">
                      <h3 className="admin-dash-card-title">{c.label}</h3>
                      <span className={`admin-badge ${editedKeys.has(c.key) ? 'admin-badge-edited' : 'admin-badge-defaults'}`}>
                        {editedKeys.has(c.key) ? 'Edited' : 'Defaults'}
                      </span>
                    </div>
                    {c.description ? <p className="admin-dash-card-desc">{c.description}</p> : null}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

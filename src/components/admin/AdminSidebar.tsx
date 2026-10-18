'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SidebarCollection {
  key: string;
  label: string;
  edited: boolean;
}

export interface SidebarSite {
  label: string;
  icon: string;
  collections: SidebarCollection[];
}

export function AdminSidebar({
  sites,
  userEmail,
}: {
  sites: SidebarSite[];
  userEmail: string | null;
}) {
  const pathname = usePathname();

  const logout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  };

  return (
    <aside className="admin-sidebar">
      <Link href="/admin" className="admin-sidebar-logo" style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="admin-sidebar-logo-mark">✎</span>
        <span>
          <span className="admin-sidebar-logo-text">Content Admin</span>
          <br />
          <span className="admin-sidebar-logo-sub">Gadzio Content Studio</span>
        </span>
      </Link>

      {userEmail ? <div className="admin-sidebar-user">Signed in as {userEmail}</div> : null}

      <nav>
        {sites.map((site) => {
          const editedCount = site.collections.filter((c) => c.edited).length;
          return (
            <div key={site.label} className="admin-nav-group">
              <div className="admin-nav-heading">
                {site.icon} {site.label}
              </div>
              {site.collections.map((c) => {
                const href = `/admin/content/${c.key}`;
                const active = pathname === href;
                return (
                  <Link
                    key={c.key}
                    href={href}
                    className={`admin-nav-link${active ? ' active' : ''}`}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                    {c.edited ? (
                      <span className="admin-nav-link-badge edited">edited</span>
                    ) : null}
                  </Link>
                );
              })}
              {editedCount > 0 ? (
                <div style={{ padding: '6px 24px 0', fontSize: 11, color: '#6e6e73' }}>
                  {editedCount} of {site.collections.length} edited
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="admin-sidebar-actions">
        <Link href="/admin/theme" className={`admin-nav-link${pathname === '/admin/theme' ? ' active' : ''}`} style={{ borderLeft: '3px solid transparent' }}>
          <span>🎨 Theme &amp; Fonts</span>
        </Link>
        <Link href="/admin/security" className={`admin-nav-link${pathname === '/admin/security' ? ' active' : ''}`} style={{ borderLeft: '3px solid transparent' }}>
          <span>🔐 Security</span>
        </Link>
        <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={logout} style={{ marginTop: 4 }}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { COLLECTIONS } from '@/lib/admin/collections';
import { getSession } from '@/lib/admin/auth';
import { getSql } from '@/lib/admin/db';

export const metadata: Metadata = {
  title: 'Admin — Sign in',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const SITE_META: { label: string; icon: string; prefix: string }[] = [
  { label: 'Apple Homepage', icon: '', prefix: '/' },
  { label: 'OPPO India', icon: '📱', prefix: '/android' },
  { label: 'Education Store', icon: '🎓', prefix: '/in-edu/store' },
  { label: 'Cases & Protection', icon: '🛡️', prefix: '/in/shop/iphone/accessories/cases-protection' },
];

/**
 * Layout for the logged-in admin area: session guard + shared sidebar.
 * Everything under /admin except /admin/login renders through here.
 */
export default async function AdminAreaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/admin/login');

  const sql = getSql();
  let editedKeys: Set<string> = new Set();
  if (sql) {
    try {
      const rows = await sql`select key from content_blocks`;
      editedKeys = new Set(rows.map((r) => r.key));
    } catch {
      editedKeys = new Set();
    }
  }

  const sites = SITE_META.map(({ label, icon, prefix }) => ({
    label,
    icon,
    collections: COLLECTIONS.filter((c) =>
      c.sitePaths.some((p) => (prefix === '/' ? p === '/' : p.startsWith(prefix))),
    ).map((c) => ({ key: c.key, label: c.label, edited: editedKeys.has(c.key) })),
  })).filter((s) => s.collections.length > 0);

  return (
    <div className="admin-body">
      <AdminSidebar sites={sites} userEmail={session?.email ?? null} />
      <div className="admin-main">{children}</div>
    </div>
  );
}

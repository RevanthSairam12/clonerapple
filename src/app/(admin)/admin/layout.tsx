import type { Metadata } from 'next';

import './admin.css';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/** Visual chrome shared by /admin pages (login included). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      {children}
    </div>
  );
}

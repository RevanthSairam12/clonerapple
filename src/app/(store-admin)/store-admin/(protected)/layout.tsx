import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StoreAdminLogoutButton } from '@/components/store-admin/StoreAdminLogoutButton';
import { getStoreSession, type StoreRole } from '@/lib/store-admin/auth';

export const metadata: Metadata = {
  title: 'Store Desk',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<StoreRole, string> = {
  store_owner: 'Owner',
  store_admin: 'Admin',
  store_viewer: 'Viewer',
};

/**
 * Guard for every page under /store-admin except /store-admin/login.
 * The session check is structural: a new page cannot forget it.
 */
export default async function ProtectedStoreAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  return (
    <>
      <header className="sa-topbar">
        <div className="sa-brand">
          <span className="sa-brand-name">Gadzio</span>
          <span className="sa-brand-sub">Store Desk</span>
        </div>
        <nav className="sa-nav" aria-label="Store admin">
          <Link className="sa-nav-link" href="/store-admin">
            Overview
          </Link>
          <Link className="sa-nav-link" href="/store-admin/products">
            Products
          </Link>
          <Link className="sa-nav-link" href="/store-admin/customers">
            Customers
          </Link>
          <Link className="sa-nav-link" href="/store-admin/orders">
            Orders
          </Link>
          <Link className="sa-nav-link" href="/store-admin/requests">
            Requests
          </Link>
          <Link className="sa-nav-link" href="/store-admin/pos">
            Point of sale
          </Link>
          <Link className="sa-nav-link" href="/store-admin/settings">
            Settings
          </Link>
        </nav>
        <div className="sa-identity">
          <span>{session.name || 'Store staff'}</span>
          <span className="sa-role">{ROLE_LABEL[session.role]}</span>
          <StoreAdminLogoutButton />
        </div>
      </header>
      <main className="sa-main">{children}</main>
    </>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StoreSessionMonitor } from '@/components/store-admin/StoreSessionMonitor';
import { StoreAdminShell } from '@/components/store-admin/StoreAdminShell';
import { getStoreSession } from '@/lib/store-admin/auth';

export const metadata: Metadata = {
  title: 'Store Desk',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

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
  if (!session) redirect('/store-admin/login?reason=account-unavailable');

  return (
    <StoreAdminShell
      session={{
        name: session.name,
        email: session.email,
        role: session.role,
        mustChangePassword: session.mustChangePassword,
      }}
    >
      <StoreSessionMonitor role={session.role} />
      {children}
    </StoreAdminShell>
  );
}

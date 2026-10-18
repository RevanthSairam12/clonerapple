import type { Metadata } from 'next';

import './store-admin.css';

export const metadata: Metadata = {
  title: 'Store Desk',
  description: 'Internal store operations panel.',
  robots: { index: false, follow: false },
};

/**
 * Shared shell for /store-admin. The route group keeps this segment separate
 * from the content panel; the protected layout below adds the session guard.
 */
export default function StoreAdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="sa-shell">{children}</div>;
}

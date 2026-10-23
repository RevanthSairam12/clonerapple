import Link from 'next/link';

import { getStoreSession } from '@/lib/store-admin/auth';
import { PosEndOfDay } from '@/components/store-admin/PosEndOfDay';

export const dynamic = 'force-dynamic';

export default async function PosEndOfDayPage() {
  const session = await getStoreSession();
  if (!session) return null;

  return (
    <div>
      <Link className="sa-back" href="/store-admin/pos">← Point of sale</Link>
      <h1 className="sa-page-title">End of day</h1>
      <p className="sa-page-sub">
        Close the shift with the counted cash drawer. Expected cash is the opening float plus
        cash taken in the shift minus cash refunds recorded in it.
      </p>

      {session.role === 'store_viewer' ? (
        <p className="sa-lock-note">Viewer access is read-only. Opening and closing shifts needs store admin or owner access.</p>
      ) : (
        <PosEndOfDay />
      )}
    </div>
  );
}

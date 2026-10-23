import Link from 'next/link';

import { getStoreSession } from '@/lib/store-admin/auth';
import { getPosCatalog, getOpenShiftForStaff } from '@/lib/store-admin/pos';
import { PosTill } from '@/components/store-admin/PosTill';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const session = await getStoreSession();
  if (!session) return null;

  const [catalog, shift] = await Promise.all([
    getPosCatalog(),
    getOpenShiftForStaff(session.adminId),
  ]);

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Point of sale</h1>
          <p className="sa-page-sub">Ring up counter sales. Prices come from the catalogue, never from this screen.</p>
        </div>
        <Link className="sa-back-inline" href="/store-admin/pos/end-of-day">End of day →</Link>
      </div>

      {catalog.ok ? (
        <PosTill
          products={catalog.products}
          canSell={session.role !== 'store_viewer'}
          shiftOpen={Boolean(shift.ok && shift.shift)}
        />
      ) : (
        <p className="sa-notice">
          Catalogue is not available. Apply migration 0011 and check the database connection.
        </p>
      )}
    </div>
  );
}

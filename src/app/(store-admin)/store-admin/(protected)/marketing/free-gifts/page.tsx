import { FreeGiftsAdminConsole } from '@/components/store-admin/FreeGiftsAdminConsole';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getFreeGiftsAdminData } from '@/lib/store-admin/free-gifts';

export const dynamic = 'force-dynamic';

export default async function StoreAdminFreeGiftsPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const result = await getFreeGiftsAdminData();
  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Free gifts</h1>
        <p className="sa-page-sub">Automatic cart spend-threshold gift promotions under Marketing.</p>
        <p className="sa-notice">
          Free gift tables are not available yet. Apply migration 0072 and reload this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="sa-page-title">Free gifts</h1>
      <p className="sa-page-sub">
        Reward shoppers with an automatic ₹0 free gift once eligible cart spend reaches your threshold, and track claims and stock health.
      </p>
      <FreeGiftsAdminConsole initialData={result.data} canEdit={canEdit} />
    </div>
  );
}


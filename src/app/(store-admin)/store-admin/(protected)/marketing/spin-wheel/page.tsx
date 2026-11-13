import { SpinWheelAdminConsole } from '@/components/store-admin/SpinWheelAdminConsole';
import { getStoreSession } from '@/lib/store-admin/auth';
import { toLocalDateTimeInput } from '@/lib/store-admin/sale-admin-rules';
import { getSpinWheelAdminData } from '@/lib/store-admin/spin-wheel';

export const dynamic = 'force-dynamic';

export default async function StoreAdminSpinWheelPage() {
  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const result = await getSpinWheelAdminData();
  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Spin wheel</h1>
        <p className="sa-page-sub">Daily customer prize wheel under Marketing.</p>
        <p className="sa-notice">
          Spin wheel tables are not available yet. Apply migration 0069 and reload this page.
        </p>
      </div>
    );
  }

  const startsAtLocal = toLocalDateTimeInput(result.data.settings.startsAt, result.data.timeZone);
  const endsAtLocal = toLocalDateTimeInput(result.data.settings.endsAt, result.data.timeZone);

  return (
    <div>
      <h1 className="sa-page-title">Spin wheel</h1>
      <p className="sa-page-sub">
        Configure daily customer Spin and Win slices, prize caps, and track live coupon redemptions.
      </p>
      <SpinWheelAdminConsole
        initialData={result.data}
        initialStartsAtLocal={startsAtLocal}
        initialEndsAtLocal={endsAtLocal}
        canEdit={canEdit}
      />
    </div>
  );
}

